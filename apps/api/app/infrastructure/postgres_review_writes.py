"""Atomic review commands for teams, identities, achievements and videos."""

import json
from time import time

from .postgres_queries import payload
from .postgres_writes import PersistenceError, PostgresWriteMixin


class PostgresReviewMixin(PostgresWriteMixin):
    async def review_achievement_atomic(
        self, achievement_id: str, status: str, comment: str,
        points: float | None, review_stage: str, actor_id: str,
    ) -> dict:
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                row = await connection.fetchrow(
                    "SELECT payload FROM lug_achievements WHERE id = $1 FOR UPDATE",
                    achievement_id,
                )
                if not row:
                    raise PersistenceError("Материал не найден.", 404)
                achievement = payload(row["payload"])
                owner_row = await connection.fetchrow(
                    "SELECT payload FROM lug_users WHERE id = $1",
                    achievement.get("userId"),
                )
                owner = payload(owner_row["payload"]) if owner_row else None
                if status == "approved" and owner and owner.get("identityStatus") != "approved":
                    raise PersistenceError("Сначала подтвердите личность участника.", 422)
                achievement.update({
                    "status": status,
                    "reviewComment": comment,
                    "reviewStage": review_stage if status == "pending" else status,
                    "points": points if status == "approved" else None,
                    "reviewedAt": None if status == "pending" else _now_iso(),
                    "stageUpdatedAt": _now_iso(),
                })
                await connection.execute(
                    "UPDATE lug_achievements SET status=$2, payload=$3::jsonb, updated_at=now() WHERE id=$1",
                    achievement_id, status, json.dumps(achievement, ensure_ascii=False),
                )
                await self._audit(connection, actor_id, f"achievement.{status}", "achievement", achievement_id)
                title = "Материал принят" if status == "approved" else "Материал отклонён" if status == "rejected" else "Материал снова на проверке"
                if achievement.get("userId"):
                    await self._notification(connection, achievement["userId"], title, comment or "Материал прошёл проверку.")
                await self._bump_revision(connection)
        return achievement

    async def review_video_atomic(
        self, team_id: str, status: str, comment: str,
        scores: dict[str, float], actor_id: str,
    ) -> dict:
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                row = await connection.fetchrow(
                    "SELECT payload FROM lug_teams WHERE id = $1 FOR UPDATE", team_id
                )
                if not row:
                    raise PersistenceError("Команда не найдена.", 404)
                team = payload(row["payload"])
                video = team.get("videoCard") or {}
                if not video.get("url"):
                    raise PersistenceError("Нельзя принять видео-визитку без загруженного материала.", 422)
                video = {
                    **video,
                    "status": status,
                    "score": sum(scores.values()) if status == "approved" else None,
                    "criteriaScores": scores,
                    "reviewComment": comment,
                    "reviewedAt": None if status == "pending" else _now_iso(),
                }
                team["videoCard"] = video
                await connection.execute(
                    "UPDATE lug_teams SET payload=$2::jsonb, updated_at=now() WHERE id=$1",
                    team_id, json.dumps(team, ensure_ascii=False),
                )
                await self._audit(connection, actor_id, f"video.{status}", "team", team_id)
                if team.get("captainId"):
                    title = "Видео-визитка принята" if status == "approved" else "Видео-визитку нужно уточнить" if status == "rejected" else "Видео-визитка снова на проверке"
                    await self._notification(connection, team["captainId"], title, comment or "Откройте раздел «Видео-визитка», чтобы посмотреть статус.")
                await self._bump_revision(connection)
        return video

    async def create_session_atomic(
        self, user_id: str, ttl_ms: int, actor_id: str | None = None
    ) -> str:
        import secrets
        token = secrets.token_hex(32)
        expires_at = int(time() * 1000) + ttl_ms
        record = {"tokenHash": _hash_token(token), "userId": user_id, "expiresAt": expires_at}
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                await connection.execute("DELETE FROM lug_sessions WHERE expires_at_ms < $1", int(time() * 1000))
                await connection.execute(
                    "INSERT INTO lug_sessions (id, token_hash, user_id, expires_at_ms, payload) VALUES ($1,$2,$3,$4,$5::jsonb)",
                    record["tokenHash"], record["tokenHash"], user_id, expires_at,
                    json.dumps(record, ensure_ascii=False),
                )
                if actor_id:
                    await self._audit(connection, actor_id, "auth.login", "user", actor_id)
                await self._bump_revision(connection)
        return token

    async def remove_session_atomic(self, token_hash: str) -> None:
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                deleted = await connection.execute(
                    "DELETE FROM lug_sessions WHERE token_hash = $1", token_hash
                )
                if deleted != "DELETE 0":
                    await self._bump_revision(connection)


def _hash_token(token: str) -> str:
    from hashlib import sha256

    return sha256(token.encode()).hexdigest()


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
