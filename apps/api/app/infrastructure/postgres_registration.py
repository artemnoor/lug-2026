"""Transactional registration and invitation commands."""

import json
from datetime import datetime, timezone
from hmac import compare_digest
from time import time

from ..security.auth import hash_token
from ..shared import domain
from .postgres_queries import payload
from .postgres_writes import PersistenceError, PostgresWriteMixin


class PostgresRegistrationMixin(PostgresWriteMixin):
    async def increment_verification_attempts(self, verification_id: str) -> None:
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                await connection.execute(
                    """UPDATE lug_email_verifications
                    SET payload = jsonb_set(payload, '{attempts}', to_jsonb(COALESCE((payload->>'attempts')::integer, 0) + 1)),
                        updated_at = now()
                    WHERE id = $1""",
                    verification_id,
                )
                await self._bump_revision(connection)

    async def replace_email_verification(
        self, pending: dict, email_message: dict | None = None
    ) -> list[str]:
        """Upsert one pending flow per email without a lost update."""
        old_urls: list[str] = []
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                await connection.fetchval(
                    "SELECT pg_advisory_xact_lock(hashtextextended(lower($1), 0))",
                    pending["email"],
                )
                existing = await connection.fetchrow(
                    "SELECT id, payload FROM lug_email_verifications WHERE lower(email) = lower($1) FOR UPDATE",
                    pending["email"],
                )
                if existing:
                    old = payload(existing["payload"])
                    old_card = (old.get("studentCard") or {}).get("url", "")
                    if old_card and old_card != (pending.get("studentCard") or {}).get("url", ""):
                        old_urls.append(old_card)
                    pending["id"] = existing["id"]
                    await connection.execute(
                        "UPDATE lug_email_verifications SET email=$2, expires_at_ms=$3, payload=$4::jsonb, updated_at=now() WHERE id=$1",
                        pending["id"], pending["email"], int(pending["expiresAtMs"]), json.dumps(pending, ensure_ascii=False),
                    )
                else:
                    await connection.execute(
                        "INSERT INTO lug_email_verifications (id,email,expires_at_ms,payload) VALUES ($1,$2,$3,$4::jsonb)",
                        pending["id"], pending["email"], int(pending["expiresAtMs"]), json.dumps(pending, ensure_ascii=False),
                    )
                if email_message:
                    await connection.execute(
                        "DELETE FROM lug_email_outbox WHERE recipient = $1 AND purpose = 'verification' AND status IN ('pending', 'failed')",
                        pending["email"],
                    )
                    await self._enqueue_email(
                        connection, pending["email"], "verification", email_message
                    )
                await self._bump_revision(connection)
        return old_urls

    async def resend_email_verification_atomic(
        self, verification_id: str, fields: dict, email_message: dict,
        now_ms: int, cooldown_ms: int,
    ) -> dict:
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                email = await connection.fetchval(
                    "SELECT email FROM lug_email_verifications WHERE id = $1",
                    verification_id,
                )
                if not email:
                    raise PersistenceError("Заявка на подтверждение не найдена или уже обработана.", 404)
                await connection.fetchval(
                    "SELECT pg_advisory_xact_lock(hashtextextended(lower($1), 0))", email
                )
                row = await connection.fetchrow(
                    "SELECT payload FROM lug_email_verifications WHERE id = $1 FOR UPDATE",
                    verification_id,
                )
                if not row:
                    raise PersistenceError("Заявка на подтверждение не найдена или уже обработана.", 404)
                pending = payload(row["payload"])
                if now_ms - int(pending.get("lastSentAtMs", 0)) < cooldown_ms:
                    retry = max(1, (cooldown_ms - (now_ms - int(pending.get("lastSentAtMs", 0)))) // 1000)
                    raise PersistenceError(f"Новый код можно запросить через {retry} сек.", 429)
                pending.update(fields)
                await connection.execute(
                    "UPDATE lug_email_verifications SET expires_at_ms=$2, payload=$3::jsonb, updated_at=now() WHERE id=$1",
                    verification_id, int(pending["expiresAtMs"]), json.dumps(pending, ensure_ascii=False),
                )
                await connection.execute(
                    "DELETE FROM lug_email_outbox WHERE recipient = $1 AND purpose = 'verification' AND status IN ('pending', 'failed')",
                    email,
                )
                await self._enqueue_email(connection, email, "verification", email_message)
                await self._bump_revision(connection)
        return pending

    async def commit_pending_atomic(
        self,
        verification_id: str,
        session_ttl_ms: int,
        expected_code_hash: str | None = None,
        max_attempts: int | None = None,
    ) -> tuple[dict, str]:
        from ..routes.registration_helpers import make_team, make_user

        async with self.pool.acquire() as connection:
            async with connection.transaction():
                pending_email = await connection.fetchval(
                    "SELECT email FROM lug_email_verifications WHERE id = $1",
                    verification_id,
                )
                if not pending_email:
                    raise PersistenceError("Заявка на подтверждение не найдена или уже обработана.", 404)
                await connection.fetchval(
                    "SELECT pg_advisory_xact_lock(hashtextextended(lower($1), 0))",
                    pending_email,
                )
                pending_row = await connection.fetchrow(
                    "SELECT payload FROM lug_email_verifications WHERE id = $1 FOR UPDATE",
                    verification_id,
                )
                if not pending_row:
                    raise PersistenceError("Заявка на подтверждение не найдена или уже обработана.", 404)
                pending = payload(pending_row["payload"])
                now_ms = int(time() * 1000)
                if int(pending.get("expiresAtMs", 0)) <= now_ms:
                    raise PersistenceError("Заявка на подтверждение не найдена или уже обработана.", 404)
                attempts = int(pending.get("attempts", 0))
                if max_attempts is not None and attempts >= max_attempts:
                    raise PersistenceError("Лимит попыток исчерпан. Начните регистрацию заново.", 422)
                if expected_code_hash is not None and not compare_digest(
                    expected_code_hash, str(pending.get("codeHash") or "")
                ):
                    pending["attempts"] = min(max_attempts or attempts + 1, attempts + 1)
                    await connection.execute(
                        "UPDATE lug_email_verifications SET payload=$2::jsonb, updated_at=now() WHERE id=$1",
                        verification_id, json.dumps(pending, ensure_ascii=False),
                    )
                    await self._bump_revision(connection)
                    raise PersistenceError("Неверный код подтверждения.", 422)
                settings = payload(await connection.fetchval("SELECT payload FROM lug_settings WHERE id = 1"))
                if not domain.registration_open(settings):
                    raise PersistenceError("Регистрация завершена или ещё не началась.", 403)
                request_payload = dict(pending.get("payload") or {})
                email = domain.normalize_email(request_payload.get("email"))
                if await connection.fetchval("SELECT 1 FROM lug_users WHERE lower(email) = lower($1) LIMIT 1", email):
                    raise PersistenceError("Этот адрес электронной почты уже зарегистрирован.", 409)
                is_team = pending.get("kind") == "team"
                if is_team:
                    group = str(request_payload.get("group") or "").strip().upper()
                    await connection.fetchval(
                        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", group
                    )
                    if await connection.fetchval("SELECT 1 FROM lug_teams WHERE group_name = $1 LIMIT 1", group):
                        raise PersistenceError("Для этой учебной группы уже создана команда.", 409)
                    team = make_team(request_payload, {"settings": settings})
                else:
                    code = str(request_payload.get("inviteCode") or "").strip().upper()
                    team_row = await connection.fetchrow(
                        "SELECT payload FROM lug_teams WHERE invite_code = $1 AND invite_status = 'active' FOR UPDATE", code
                    )
                    if not team_row:
                        raise PersistenceError("Приглашение неактивно.", 404)
                    team = payload(team_row["payload"])
                    if domain.timestamp(team.get("inviteExpiresAt")) < time() * 1000:
                        raise PersistenceError("Приглашение неактивно.", 404)
                    count = await connection.fetchval("SELECT count(*) FROM lug_users WHERE team_id = $1", team["id"])
                    if int(count or 0) >= int(team.get("totalStudentsInGroup") or 0):
                        raise PersistenceError("В команде уже достигнута заявленная вместимость.", 409)
                card = pending.get("studentCard") or {}
                user = make_user(request_payload, team, card, "captain" if is_team else "participant")
                if is_team:
                    team["captainId"] = user["id"]
                    await connection.execute(
                        "INSERT INTO lug_teams (id,group_name,invite_code,captain_id,invite_status,payload) VALUES ($1,$2,$3,$4,$5,$6::jsonb)",
                        team["id"], team["group"], team["inviteCode"], None,
                        team.get("inviteStatus", "active"), json.dumps(team, ensure_ascii=False),
                    )
                await connection.execute(
                    "INSERT INTO lug_users (id,email,phone,role,team_id,email_verified,payload) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)",
                    user["id"], user["email"], user.get("phone", ""), user["role"], user["teamId"],
                    user.get("emailVerified") is True, json.dumps(user, ensure_ascii=False),
                )
                if is_team:
                    await connection.execute(
                        "UPDATE lug_teams SET captain_id = $2 WHERE id = $1",
                        team["id"], user["id"],
                    )
                await connection.execute(
                    "INSERT INTO lug_uploads (url,user_id,kind,payload) VALUES ($1,$2,'student-card',$3::jsonb)",
                    card["url"], user["id"], json.dumps({**card, "url": card["url"], "userId": user["id"], "kind": "student-card", "createdAt": _now_iso()}, ensure_ascii=False),
                )
                await connection.execute("DELETE FROM lug_email_verifications WHERE id = $1", verification_id)
                await self._audit(connection, user["id"], "team.created" if is_team else "team.joined", "team", team["id"])
                await self._notification(connection, user["id"], "Заявка принята", "Команда создана. Оргкомитет проверит данные капитана." if is_team else "Вы добавлены в состав команды и ожидаете проверки личности.")
                token = _new_session_token()
                expires_at = int(time() * 1000) + session_ttl_ms
                await connection.execute("DELETE FROM lug_sessions WHERE expires_at_ms < $1", int(time() * 1000))
                await connection.execute(
                    "INSERT INTO lug_sessions (id,token_hash,user_id,expires_at_ms,payload) VALUES ($1,$2,$3,$4,$5::jsonb)",
                    hash_token(token), hash_token(token), user["id"], expires_at,
                    json.dumps({"tokenHash": hash_token(token), "userId": user["id"], "expiresAt": expires_at}, ensure_ascii=False),
                )
                await self._bump_revision(connection)
        return user, token


def _new_session_token() -> str:
    import secrets

    return secrets.token_hex(32)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
