"""Transactional PostgreSQL write repositories for critical business commands."""

import json
from datetime import datetime, timezone
from hmac import compare_digest
from typing import Any
from uuid import uuid4

from ..shared import domain
from ..shared.state_machine import ensure_review_transition
from .persistence_errors import PersistenceError
from .postgres_email_outbox import PostgresEmailOutboxMixin
from .postgres_queries import payload


class PostgresWriteMixin(PostgresEmailOutboxMixin):
    async def _audit(
        self,
        connection: Any,
        actor_id: str,
        action: str,
        entity_type: str,
        entity_id: str,
        details: dict | None = None,
    ) -> None:
        item = {
            "id": str(uuid4()),
            "at": _now_iso(),
            "actorId": actor_id,
            "action": action,
            "entityType": entity_type,
            "entityId": entity_id,
        }
        if details:
            item["details"] = details
        await connection.execute(
            """INSERT INTO lug_audit_log
            (id, actor_id, action, entity_type, entity_id, at, payload)
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)""",
            item["id"],
            actor_id,
            action,
            entity_type,
            entity_id,
            _now_datetime(),
            json.dumps(item, ensure_ascii=False),
        )

    async def _notification(
        self, connection: Any, user_id: str, title: str, message: str
    ) -> None:
        item = {
            "id": str(uuid4()),
            "targetType": "user",
            "targetId": user_id,
            "title": title,
            "message": message,
            "kind": "system",
            "createdAt": _now_iso(),
            "readBy": [],
        }
        await connection.execute(
            """INSERT INTO lug_notifications
            (id, target_type, target_id, kind, title, message, payload)
            VALUES ($1, 'user', $2, 'system', $3, $4, $5::jsonb)""",
            item["id"],
            user_id,
            title,
            message,
            json.dumps(item, ensure_ascii=False),
        )
        user_row = await connection.fetchrow(
            "SELECT email, email_verified FROM lug_users WHERE id = $1", user_id
        )
        if user_row and user_row["email_verified"]:
            await self._enqueue_email(
                connection,
                user_row["email"],
                "notification",
                {"title": title, "message": message},
            )

    async def create_password_reset_atomic(
        self,
        email: str,
        reset: dict,
        email_message: dict,
        now_ms: int,
        cooldown_ms: int,
    ) -> bool:
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                await connection.fetchval(
                    "SELECT pg_advisory_xact_lock(hashtextextended(lower($1), 0))",
                    email,
                )
                user = await connection.fetchrow(
                    "SELECT id FROM lug_users WHERE lower(email) = lower($1) AND email_verified IS TRUE LIMIT 1",
                    email,
                )
                if not user:
                    return False
                existing = await connection.fetchrow(
                    "SELECT id, payload FROM lug_password_resets WHERE lower(email) = lower($1) FOR UPDATE",
                    email,
                )
                if existing:
                    previous = payload(existing["payload"])
                    if now_ms - int(previous.get("lastSentAtMs", 0)) < cooldown_ms:
                        return False
                    reset["id"] = existing["id"]
                    await connection.execute(
                        "UPDATE lug_password_resets SET email=$2, expires_at_ms=$3, payload=$4::jsonb, updated_at=now() WHERE id=$1",
                        reset["id"],
                        email,
                        int(reset["expiresAtMs"]),
                        json.dumps(reset, ensure_ascii=False),
                    )
                else:
                    await connection.execute(
                        "INSERT INTO lug_password_resets (id,email,expires_at_ms,payload) VALUES ($1,$2,$3,$4::jsonb)",
                        reset["id"],
                        email,
                        int(reset["expiresAtMs"]),
                        json.dumps(reset, ensure_ascii=False),
                    )
                await connection.execute(
                    "DELETE FROM lug_email_outbox WHERE recipient = $1 AND purpose = 'password-reset' AND status IN ('pending', 'failed')",
                    email,
                )
                await self._enqueue_email(
                    connection, email, "password-reset", email_message
                )
        return True

    async def reset_password_atomic(
        self,
        email: str,
        expected_code_hash: str,
        password_hash: str,
        max_attempts: int,
    ) -> dict:
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                await connection.fetchval(
                    "SELECT pg_advisory_xact_lock(hashtextextended(lower($1), 0))",
                    email,
                )
                row = await connection.fetchrow(
                    "SELECT id, payload FROM lug_password_resets WHERE lower(email) = lower($1) FOR UPDATE",
                    email,
                )
                if not row:
                    raise PersistenceError(
                        "Код восстановления недействителен или истёк. Запросите новый код.",
                        422,
                    )
                reset = payload(row["payload"])
                now_ms = _now_ms()
                if int(reset.get("expiresAtMs", 0)) <= now_ms:
                    await connection.execute(
                        "DELETE FROM lug_password_resets WHERE id = $1", row["id"]
                    )
                    raise PersistenceError(
                        "Код восстановления недействителен или истёк. Запросите новый код.",
                        422,
                    )
                if int(reset.get("attempts", 0)) >= max_attempts:
                    await connection.execute(
                        "DELETE FROM lug_password_resets WHERE id = $1", row["id"]
                    )
                    raise PersistenceError(
                        "Лимит попыток исчерпан. Запросите новый код восстановления.",
                        422,
                    )
                if not compare_digest(
                    expected_code_hash, str(reset.get("codeHash") or "")
                ):
                    reset["attempts"] = int(reset.get("attempts", 0)) + 1
                    await connection.execute(
                        "UPDATE lug_password_resets SET payload=$2::jsonb, updated_at=now() WHERE id=$1",
                        row["id"],
                        json.dumps(reset, ensure_ascii=False),
                    )
                    raise PersistenceError(
                        "Код восстановления недействителен или истёк. Запросите новый код.",
                        422,
                    )
                user_row = await connection.fetchrow(
                    "SELECT id, payload FROM lug_users WHERE lower(email) = lower($1) AND email_verified IS TRUE FOR UPDATE",
                    email,
                )
                if not user_row:
                    raise PersistenceError(
                        "Код восстановления недействителен или истёк. Запросите новый код.",
                        422,
                    )
                user = payload(user_row["payload"])
                user["passwordHash"] = password_hash
                await connection.execute(
                    "UPDATE lug_users SET payload=$2::jsonb, updated_at=now() WHERE id=$1",
                    user_row["id"],
                    json.dumps(user, ensure_ascii=False),
                )
                await connection.execute(
                    "DELETE FROM lug_password_resets WHERE id = $1", row["id"]
                )
                await connection.execute(
                    "DELETE FROM lug_sessions WHERE user_id = $1", user_row["id"]
                )
                await self._audit(
                    connection,
                    user_row["id"],
                    "auth.password_reset",
                    "user",
                    user_row["id"],
                )
        return user

    async def update_settings_atomic(self, patch: dict, actor_id: str) -> dict:
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                row = await connection.fetchrow(
                    "SELECT payload FROM lug_settings WHERE id = 1 FOR UPDATE"
                )
                settings = {**self.defaults, **payload(row["payload"] if row else {})}
                settings["content"] = {
                    **self.defaults.get("content", {}),
                    **settings.get("content", {}),
                }
                changes = dict(patch) if isinstance(patch, dict) else {}
                content = changes.pop("content", None)
                settings.update(changes)
                if isinstance(content, dict):
                    settings["content"].update(content)
                await connection.execute(
                    """INSERT INTO lug_settings (id, payload) VALUES (1, $1::jsonb)
                    ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()""",
                    json.dumps(settings, ensure_ascii=False),
                )
                await self._audit(
                    connection, actor_id, "settings.updated", "settings", "global"
                )
        return settings

    async def update_quota_atomic(
        self, team_id: str, confirmed: bool, actor_id: str
    ) -> dict:
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                row = await connection.fetchrow(
                    "SELECT payload FROM lug_teams WHERE id = $1 FOR UPDATE", team_id
                )
                if not row:
                    raise PersistenceError("Команда не найдена.", 404)
                team = payload(row["payload"])
                team["isQuotaConfirmed"] = confirmed
                await connection.execute(
                    """UPDATE lug_teams SET payload = $2::jsonb, quota_confirmed = $3,
                    name = COALESCE(NULLIF($4, ''), name),
                    member_limit = COALESCE($5, member_limit),
                    flag_url = COALESCE(NULLIF($6, ''), flag_url),
                    video_url = COALESCE(NULLIF($7, ''), video_url),
                    video_status = COALESCE(NULLIF($8, ''), video_status),
                    video_score = COALESCE($9, video_score), updated_at = now()
                    WHERE id = $1""",
                    team_id,
                    json.dumps(team, ensure_ascii=False),
                    confirmed,
                    team.get("name", ""),
                    int(team.get("totalStudentsInGroup") or 0) or None,
                    team.get("flagUrl", ""),
                    (team.get("videoCard") or {}).get("url", ""),
                    (team.get("videoCard") or {}).get("status", ""),
                    float((team.get("videoCard") or {}).get("score") or 0),
                )
                await self._audit(
                    connection, actor_id, "team.quota_updated", "team", team_id
                )
        return team

    async def review_team_atomic(
        self, team_id: str, field: str, status: str, comment: str, actor_id: str
    ) -> tuple[dict, list[dict], dict]:
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                team_row = await connection.fetchrow(
                    "SELECT payload FROM lug_teams WHERE id = $1 FOR UPDATE", team_id
                )
                if not team_row:
                    raise PersistenceError("Команда не найдена.", 404)
                team = payload(team_row["payload"])
                try:
                    ensure_review_transition(
                        (team.get("review", {}).get(field) or {}).get("status"), status
                    )
                except ValueError as exc:
                    raise PersistenceError(
                        str(exc), 409, "REVIEW_TRANSITION_CONFLICT"
                    ) from exc
                member_rows = await connection.fetch(
                    "SELECT payload FROM lug_users WHERE team_id = $1 ORDER BY updated_at",
                    team_id,
                )
                members = [payload(row["payload"]) for row in member_rows]
                settings = payload(
                    await connection.fetchval(
                        "SELECT payload FROM lug_settings WHERE id = 1"
                    )
                )
                team.setdefault("review", {})[field] = {
                    "status": status,
                    "comment": comment,
                    "updatedAt": _now_iso(),
                }
                state = {"settings": settings, "users": members}
                team["isAdmitted"] = domain.team_is_admitted(state, team, members)
                review_column = {
                    "name": "review_name_status",
                    "group": "review_group_status",
                    "flag": "review_flag_status",
                    "description": "review_description_status",
                }[field]
                await connection.execute(
                    f"UPDATE lug_teams SET payload = $2::jsonb, {review_column} = $3, updated_at = now() WHERE id = $1",
                    team_id,
                    json.dumps(team, ensure_ascii=False),
                    status,
                )
                await self._audit(
                    connection, actor_id, f"team.{field}.{status}", "team", team_id
                )
                if team.get("captainId"):
                    title = (
                        "Проверка поля пройдена"
                        if status == "approved"
                        else "Поле требует исправления"
                        if status == "rejected"
                        else "Проверка поля обновлена"
                    )
                    await self._notification(
                        connection,
                        team["captainId"],
                        title,
                        comment or "Оргкомитет обновил решение по карточке команды.",
                    )
        return team, members, settings

    async def review_identity_atomic(
        self, user_id: str, status: str, comment: str, actor_id: str
    ) -> tuple[dict, list[dict], dict]:
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                target_row = await connection.fetchrow(
                    "SELECT team_id FROM lug_users WHERE id = $1 AND role <> 'admin'",
                    user_id,
                )
                if not target_row:
                    raise PersistenceError("Пользователь не найден.", 404)
                team_id = target_row["team_id"]
                if team_id:
                    await connection.fetchrow(
                        "SELECT id FROM lug_teams WHERE id = $1 FOR UPDATE", team_id
                    )
                target_row = await connection.fetchrow(
                    "SELECT payload FROM lug_users WHERE id = $1 FOR UPDATE", user_id
                )
                target = payload(target_row["payload"])
                try:
                    ensure_review_transition(target.get("identityStatus"), status)
                except ValueError as exc:
                    raise PersistenceError(
                        str(exc), 409, "REVIEW_TRANSITION_CONFLICT"
                    ) from exc
                target.update(
                    {
                        "identityStatus": status,
                        "identityComment": comment,
                        "isIdentityConfirmed": status == "approved",
                    }
                )
                await connection.execute(
                    """UPDATE lug_users SET payload = $2::jsonb, identity_status = $3,
                    updated_at = now() WHERE id = $1""",
                    user_id,
                    json.dumps(target, ensure_ascii=False),
                    target.get("identityStatus", ""),
                )
                members, settings = (
                    [],
                    payload(
                        await connection.fetchval(
                            "SELECT payload FROM lug_settings WHERE id = 1"
                        )
                    ),
                )
                if team_id:
                    rows = await connection.fetch(
                        "SELECT payload FROM lug_users WHERE team_id = $1 ORDER BY updated_at",
                        team_id,
                    )
                    members = [payload(row["payload"]) for row in rows]
                    team_row = await connection.fetchrow(
                        "SELECT payload FROM lug_teams WHERE id = $1 FOR UPDATE",
                        team_id,
                    )
                    team = payload(team_row["payload"])
                    team["isAdmitted"] = domain.team_is_admitted(
                        {"settings": settings, "users": members}, team, members
                    )
                    await connection.execute(
                        """UPDATE lug_teams SET payload = $2::jsonb,
                        name = COALESCE(NULLIF($3, ''), name), member_limit = COALESCE($4, member_limit),
                        flag_url = COALESCE(NULLIF($5, ''), flag_url), updated_at = now() WHERE id = $1""",
                        team_id,
                        json.dumps(team, ensure_ascii=False),
                        team.get("name", ""),
                        int(team.get("totalStudentsInGroup") or 0) or None,
                        team.get("flagUrl", ""),
                    )
                await self._audit(
                    connection, actor_id, f"identity.{status}", "user", user_id
                )
                title = (
                    "Личность подтверждена"
                    if status == "approved"
                    else "Нужно уточнить данные"
                    if status == "rejected"
                    else "Проверка личности обновлена"
                )
                await self._notification(
                    connection,
                    user_id,
                    title,
                    comment or "Документы проверены организаторами.",
                )
        return target, members, settings


def _now_datetime() -> datetime:
    return datetime.now(timezone.utc)


def _now_ms() -> int:
    return int(_now_datetime().timestamp() * 1000)


def _now_iso() -> str:
    return _now_datetime().isoformat(timespec="milliseconds").replace("+00:00", "Z")
