"""Small PostgreSQL query repositories used by read-heavy API flows."""

from typing import Any

from .store import DatabaseState, normalize_db


def payload(value: Any) -> dict:
    if isinstance(value, str):
        import json

        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return {}
    return value if isinstance(value, dict) else {}


class PostgresQueryMixin:
    """Read repositories. They intentionally return domain-shaped dictionaries."""

    async def get_settings(self) -> dict:
        value = await self.pool.fetchval("SELECT payload FROM lug_settings WHERE id = 1")
        settings = payload(value)
        merged = {**self.defaults, **settings}
        merged["content"] = {**self.defaults.get("content", {}), **settings.get("content", {})}
        return merged

    async def get_user_by_session(self, token_hash: str) -> dict | None:
        row = await self.pool.fetchrow(
            """SELECT u.payload
            FROM lug_sessions s JOIN lug_users u ON u.id = s.user_id
            WHERE s.token_hash = $1 AND s.expires_at_ms >= $2""",
            token_hash,
            _now_ms(),
        )
        return payload(row["payload"]) if row else None

    async def get_user_by_email(self, email: str) -> dict | None:
        row = await self.pool.fetchrow(
            "SELECT payload FROM lug_users WHERE lower(email) = lower($1) LIMIT 1",
            email,
        )
        return payload(row["payload"]) if row else None

    async def get_invite(self, code: str) -> dict | None:
        row = await self.pool.fetchrow(
            """SELECT payload FROM lug_teams
            WHERE invite_code = $1 AND invite_status = 'active'""",
            code,
        )
        team = payload(row["payload"]) if row else None
        if not team:
            return None
        expires_at = _timestamp(team.get("inviteExpiresAt"))
        if expires_at != expires_at or expires_at < _now_ms():
            return None
        return team

    async def get_email_verification(self, verification_id: str) -> dict | None:
        row = await self.pool.fetchrow(
            "SELECT payload FROM lug_email_verifications WHERE id = $1",
            verification_id,
        )
        return payload(row["payload"]) if row else None

    async def get_password_reset(self, email: str) -> dict | None:
        row = await self.pool.fetchrow(
            "SELECT payload FROM lug_password_resets WHERE lower(email) = lower($1) LIMIT 1",
            email,
        )
        return payload(row["payload"]) if row else None

    async def get_team_snapshot(self, team_id: str) -> tuple[dict, list[dict], dict] | None:
        async with self.pool.acquire() as connection:
            team_row = await connection.fetchrow(
                "SELECT payload FROM lug_teams WHERE id = $1", team_id
            )
            if not team_row:
                return None
            member_rows = await connection.fetch(
                "SELECT payload FROM lug_users WHERE team_id = $1 ORDER BY updated_at", team_id
            )
            settings = payload(
                await connection.fetchval("SELECT payload FROM lug_settings WHERE id = 1")
            )
        return payload(team_row["payload"]), [payload(row["payload"]) for row in member_rows], settings

    async def get_dashboard_state(self, user_id: str) -> DatabaseState | None:
        async with self.pool.acquire() as connection:
            user_row = await connection.fetchrow(
                "SELECT payload FROM lug_users WHERE id = $1", user_id
            )
            if not user_row:
                return None
            user = payload(user_row["payload"])
            team_id = user.get("teamId")
            team_rows = []
            member_rows = []
            if team_id:
                team_row = await connection.fetchrow(
                    "SELECT payload FROM lug_teams WHERE id = $1", team_id
                )
                team_rows = [payload(team_row["payload"])] if team_row else []
                member_rows = await connection.fetch(
                    "SELECT payload FROM lug_users WHERE team_id = $1 ORDER BY updated_at",
                    team_id,
                )
            achievement_rows = await connection.fetch(
                "SELECT payload FROM lug_achievements WHERE user_id = $1 ORDER BY updated_at DESC",
                user_id,
            )
            notifications = await connection.fetch(
                """SELECT payload FROM lug_notifications
                WHERE target_type = 'all'
                   OR (target_type = 'teams' AND $1 IS NOT NULL)
                   OR (target_type = 'team' AND target_id = $1)
                   OR (target_type = 'user' AND target_id = $2)
                   OR (target_type = 'captains' AND EXISTS
                       (SELECT 1 FROM lug_teams WHERE captain_id = $2))
                   OR (target_type = 'captain' AND target_id = $1
                       AND EXISTS (SELECT 1 FROM lug_teams WHERE id = $1 AND captain_id = $2))
                ORDER BY updated_at DESC LIMIT 200""",
                team_id,
                user_id,
            )
            settings = payload(
                await connection.fetchval("SELECT payload FROM lug_settings WHERE id = 1")
            )
        member_users = [payload(row["payload"]) for row in member_rows]
        if not any(item.get("id") == user.get("id") for item in member_users):
            member_users.append(user)
        data = {
            "settings": settings,
            "users": member_users,
            "teams": team_rows,
            "achievements": [payload(row["payload"]) for row in achievement_rows],
            "notifications": [payload(row["payload"]) for row in notifications],
        }
        return normalize_db(data, self.defaults)

    async def get_admin_state(self) -> DatabaseState:
        async with self.pool.acquire() as connection:
            data = {
                "settings": payload(
                    await connection.fetchval("SELECT payload FROM lug_settings WHERE id = 1")
                )
            }
            for key, table in (
                ("users", "lug_users"),
                ("teams", "lug_teams"),
                ("achievements", "lug_achievements"),
                ("notifications", "lug_notifications"),
            ):
                rows = await connection.fetch(f"SELECT payload FROM {table} ORDER BY updated_at DESC")
                data[key] = [payload(row["payload"]) for row in rows]
            rows = await connection.fetch(
                "SELECT payload FROM lug_audit_log ORDER BY at DESC LIMIT 1000"
            )
            data["auditLog"] = [payload(row["payload"]) for row in rows]
        return normalize_db(data, self.defaults)

    async def get_audit_log(self, limit: int = 200) -> list[dict]:
        rows = await self.pool.fetch(
            "SELECT payload FROM lug_audit_log ORDER BY at DESC LIMIT $1", limit
        )
        return [payload(row["payload"]) for row in rows]

    async def get_referenced_upload_urls(self) -> set[str]:
        rows = await self.pool.fetch(
            """SELECT payload->>'studentCardFile' AS url FROM lug_users
            UNION ALL SELECT payload->>'fileUrl' FROM lug_achievements
            UNION ALL SELECT payload->>'flagUrl' FROM lug_teams
            UNION ALL SELECT payload->'videoCard'->>'url' FROM lug_teams
            UNION ALL SELECT payload->'studentCard'->>'url' FROM lug_email_verifications
                WHERE expires_at_ms >= (extract(epoch from now()) * 1000)::bigint
            UNION ALL SELECT url FROM lug_uploads"""
        )
        return {str(row["url"]) for row in rows if row["url"]}


def _now_ms() -> int:
    from time import time

    return int(time() * 1000)


def _timestamp(value: Any) -> float:
    from datetime import datetime

    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp() * 1000
    except (TypeError, ValueError):
        return float("nan")
