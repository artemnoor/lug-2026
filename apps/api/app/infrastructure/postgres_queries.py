"""Small PostgreSQL query repositories used by read-heavy API flows."""

from typing import Any

from .postgres_projection import (
    ACHIEVEMENT_FIELDS,
    NOTIFICATION_FIELDS,
    TEAM_FIELDS,
    UPLOAD_FIELDS,
    USER_FIELDS,
    entity,
    payload,
)

_entity = entity


class PostgresQueryMixin:
    """Read repositories. They intentionally return domain-shaped dictionaries."""

    async def get_settings(self) -> dict:
        value = await self.pool.fetchval(
            "SELECT payload FROM lug_settings WHERE id = 1"
        )
        settings = payload(value)
        merged = {**self.defaults, **settings}
        merged["content"] = {
            **self.defaults.get("content", {}),
            **settings.get("content", {}),
        }
        return merged

    async def get_user_by_session(self, token_hash: str) -> dict | None:
        row = await self.pool.fetchrow(
            """SELECT u.payload, u.id, u.email, u.phone, u.role, u.team_id,
                      u.email_verified, u.fio, u.identity_status, u.avatar_url,
                      u.student_card_file
            FROM lug_sessions s JOIN lug_users u ON u.id = s.user_id
            WHERE s.token_hash = $1 AND s.expires_at_ms >= $2""",
            token_hash,
            _now_ms(),
        )
        return _entity(row, USER_FIELDS) if row else None

    async def get_user_by_email(self, email: str) -> dict | None:
        row = await self.pool.fetchrow(
            """SELECT payload, id, email, phone, role, team_id, email_verified,
                      fio, identity_status, avatar_url, student_card_file
               FROM lug_users WHERE lower(email) = lower($1) LIMIT 1""",
            email,
        )
        return _entity(row, USER_FIELDS) if row else None

    async def get_user_by_id(self, user_id: str) -> dict | None:
        row = await self.pool.fetchrow(
            """SELECT payload, id, email, phone, role, team_id, email_verified,
                      fio, identity_status, avatar_url, student_card_file
               FROM lug_users WHERE id = $1""",
            user_id,
        )
        return _entity(row, USER_FIELDS) if row else None

    async def get_admin_by_identity(self, email: str, phone: str = "") -> dict | None:
        row = await self.pool.fetchrow(
            """SELECT payload, id, email, phone, role, team_id, email_verified,
                      fio, identity_status, avatar_url, student_card_file
               FROM lug_users
               WHERE role = 'admin' AND (lower(email) = lower($1) OR ($2 <> '' AND phone = $2))
               LIMIT 1""",
            email,
            phone,
        )
        return _entity(row, USER_FIELDS) if row else None

    async def has_admin(self) -> bool:
        return bool(
            await self.pool.fetchval(
                "SELECT EXISTS (SELECT 1 FROM lug_users WHERE role = 'admin')"
            )
        )

    async def get_user_notifications(self, user_id: str) -> list[dict]:
        user = await self.pool.fetchrow(
            "SELECT team_id FROM lug_users WHERE id = $1", user_id
        )
        if not user:
            return []
        rows = await self.pool.fetch(
            """SELECT n.payload, n.id, n.target_type, n.target_id, n.kind,
                      n.title, n.message, n.created_at
            FROM lug_notifications n
            WHERE n.target_type = 'all'
               OR (n.target_type = 'teams' AND $1 IS NOT NULL)
               OR (n.target_type = 'team' AND n.target_id = $1)
               OR (n.target_type = 'user' AND n.target_id = $2)
               OR (n.target_type = 'captains' AND EXISTS
                   (SELECT 1 FROM lug_teams t WHERE t.captain_id = $2))
               OR (n.target_type = 'admins' AND EXISTS
                   (SELECT 1 FROM lug_users a WHERE a.id = $2 AND a.role = 'admin'))
               OR (n.target_type = 'captain' AND n.target_id = $1
                   AND EXISTS (SELECT 1 FROM lug_teams t WHERE t.id = $1 AND t.captain_id = $2))
            ORDER BY n.updated_at DESC LIMIT 200""",
            user["team_id"],
            user_id,
        )
        return [_entity(row, NOTIFICATION_FIELDS) for row in rows]

    async def get_user_uploads(self, user_id: str) -> list[dict]:
        rows = await self.pool.fetch(
            """SELECT payload, upload_id, url, user_id, kind, status, scan_status,
                      storage_key, mime_type, size_bytes, created_at
               FROM lug_uploads WHERE user_id = $1 ORDER BY updated_at DESC""",
            user_id,
        )
        return [_entity(row, UPLOAD_FIELDS) for row in rows]

    async def is_phone_in_use(self, phone: str, excluding_user_id: str) -> bool:
        return bool(
            await self.pool.fetchval(
                "SELECT EXISTS (SELECT 1 FROM lug_users WHERE phone = $1 AND id <> $2)",
                phone,
                excluding_user_id,
            )
        )

    async def get_invite(self, code: str) -> dict | None:
        row = await self.pool.fetchrow(
            """SELECT payload, id, group_name, captain_id, invite_code, invite_status,
                      name, member_limit, flag_url, video_url, video_status, video_score
            FROM lug_teams
            WHERE invite_code = $1 AND invite_status = 'active'""",
            code,
        )
        team = _entity(row, TEAM_FIELDS) if row else None
        if not team:
            return None
        expires_at = _timestamp(team.get("inviteExpiresAt"))
        if expires_at != expires_at or expires_at < _now_ms():
            return None
        return team

    async def get_team_by_group(self, group: str) -> dict | None:
        row = await self.pool.fetchrow(
            """SELECT payload, id, group_name, captain_id, invite_code, invite_status,
                      name, member_limit, flag_url, video_url, video_status, video_score
               FROM lug_teams WHERE group_name = $1 LIMIT 1""",
            str(group or "").strip().upper(),
        )
        return _entity(row, TEAM_FIELDS) if row else None

    async def get_email_verification_by_email(self, email: str) -> dict | None:
        row = await self.pool.fetchrow(
            "SELECT payload FROM lug_email_verifications WHERE lower(email) = lower($1) LIMIT 1",
            email,
        )
        return payload(row["payload"]) if row else None

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

    async def get_team_snapshot(
        self, team_id: str
    ) -> tuple[dict, list[dict], dict] | None:
        async with self.pool.acquire() as connection:
            team_row = await connection.fetchrow(
                """SELECT payload, id, group_name, captain_id, invite_code, invite_status,
                          name, member_limit, flag_url, video_url, video_status, video_score
                   FROM lug_teams WHERE id = $1""",
                team_id,
            )
            if not team_row:
                return None
            member_rows = await connection.fetch(
                """SELECT payload, id, email, phone, role, team_id, email_verified,
                          fio, identity_status, avatar_url, student_card_file
                   FROM lug_users WHERE team_id = $1 ORDER BY updated_at""",
                team_id,
            )
            settings = payload(
                await connection.fetchval(
                    "SELECT payload FROM lug_settings WHERE id = 1"
                )
            )
        return (
            _entity(team_row, TEAM_FIELDS),
            [_entity(row, USER_FIELDS) for row in member_rows],
            settings,
        )

    async def get_dashboard_projection(self, user_id: str) -> dict | None:
        async with self.pool.acquire() as connection:
            user_row = await connection.fetchrow(
                """SELECT payload, id, email, phone, role, team_id, email_verified,
                          fio, identity_status, avatar_url, student_card_file
                   FROM lug_users WHERE id = $1""",
                user_id,
            )
            if not user_row:
                return None
            user = _entity(user_row, USER_FIELDS)
            team_id = user.get("teamId")
            team_rows = []
            member_rows = []
            if team_id:
                team_row = await connection.fetchrow(
                    """SELECT payload, id, group_name, captain_id, invite_code, invite_status,
                              name, member_limit, flag_url, video_url, video_status, video_score
                       FROM lug_teams WHERE id = $1""",
                    team_id,
                )
                team_rows = [_entity(team_row, TEAM_FIELDS)] if team_row else []
                member_rows = await connection.fetch(
                    """SELECT payload, id, email, phone, role, team_id, email_verified,
                              fio, identity_status, avatar_url, student_card_file
                       FROM lug_users WHERE team_id = $1 ORDER BY updated_at""",
                    team_id,
                )
            achievement_rows = await connection.fetch(
                """SELECT payload, id, user_id, status, direction, points, file_url, title
                   FROM lug_achievements WHERE user_id = $1 ORDER BY updated_at DESC""",
                user_id,
            )
            notifications = await connection.fetch(
                """SELECT payload, id, target_type, target_id, kind, title, message, created_at
                FROM lug_notifications
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
                await connection.fetchval(
                    "SELECT payload FROM lug_settings WHERE id = 1"
                )
            )
        member_users = [_entity(row, USER_FIELDS) for row in member_rows]
        if not any(item.get("id") == user.get("id") for item in member_users):
            member_users.append(user)
        data = {
            "settings": settings,
            "users": member_users,
            "teams": team_rows,
            "achievements": [
                _entity(row, ACHIEVEMENT_FIELDS) for row in achievement_rows
            ],
            "notifications": [
                _entity(row, NOTIFICATION_FIELDS) for row in notifications
            ],
        }
        return data

    async def get_public_results_data(self) -> dict:
        async with self.pool.acquire() as connection:
            settings = payload(
                await connection.fetchval(
                    "SELECT payload FROM lug_settings WHERE id = 1"
                )
            )
            team_rows = await connection.fetch(
                """SELECT payload, id, group_name, captain_id, invite_code, invite_status,
                          name, member_limit, flag_url, video_url, video_status, video_score
                   FROM lug_teams"""
            )
            user_rows = await connection.fetch(
                """SELECT payload, id, email, phone, role, team_id, email_verified,
                          fio, identity_status, avatar_url, student_card_file
                   FROM lug_users WHERE role <> 'admin'"""
            )
            achievement_rows = await connection.fetch(
                """SELECT payload, id, user_id, status, direction, points, file_url, title
                   FROM lug_achievements WHERE status = 'approved'"""
            )
        return {
            "settings": {**self.defaults, **settings},
            "teams": [_entity(row, TEAM_FIELDS) for row in team_rows],
            "users": [_entity(row, USER_FIELDS) for row in user_rows],
            "achievements": [
                _entity(row, ACHIEVEMENT_FIELDS) for row in achievement_rows
            ],
        }

    async def get_public_results(self) -> dict:
        settings = payload(
            await self.pool.fetchval("SELECT payload FROM lug_settings WHERE id = 1")
        )
        available_from = settings.get("resultsStart")
        if _timestamp(available_from) > _now_ms():
            return {"published": False, "availableFrom": available_from, "teams": []}
        rows = await self.pool.fetch(
            """
            WITH config AS (
                SELECT COALESCE((payload->>'minTeamPercentage')::numeric, 60) AS min_percent
                FROM lug_settings WHERE id = 1
            ), members AS (
                SELECT t.id,
                       count(u.id)::int AS member_count,
                       ceil(t.member_limit * c.min_percent / 100)::int AS required,
                       COALESCE(bool_and(u.identity_status = 'approved'), false) AS members_approved
                FROM lug_teams t
                CROSS JOIN config c
                LEFT JOIN lug_users u ON u.team_id = t.id
                GROUP BY t.id, c.min_percent
            ), scores AS (
                SELECT t.id,
                       COALESCE(sum(CASE WHEN a.status = 'approved' THEN a.points ELSE 0 END), 0)
                         + CASE WHEN t.video_status = 'approved' THEN t.video_score ELSE 0 END AS score
                FROM lug_teams t
                LEFT JOIN lug_users u ON u.team_id = t.id
                LEFT JOIN lug_achievements a ON a.user_id = u.id
                GROUP BY t.id, t.payload
            )
            SELECT t.id, t.name, t.group_name, s.score
            FROM lug_teams t
            JOIN members m ON m.id = t.id
            JOIN scores s ON s.id = t.id
            WHERE t.quota_confirmed
              AND m.member_count >= m.required
              AND m.members_approved
              AND t.review_name_status = 'approved'
              AND t.review_group_status = 'approved'
              AND t.review_flag_status = 'approved'
              AND t.review_description_status = 'approved'
            ORDER BY s.score DESC, t.name ASC
            """
        )
        return {
            "published": True,
            "availableFrom": available_from,
            "teams": [
                {
                    "id": row["id"],
                    "name": row["name"],
                    "group": row["group_name"],
                    "score": row["score"],
                    "admitted": True,
                }
                for row in rows
            ],
        }

    async def get_audit_log(self, limit: int = 200) -> list[dict]:
        rows = await self.pool.fetch(
            "SELECT payload FROM lug_audit_log ORDER BY at DESC LIMIT $1", limit
        )
        return [payload(row["payload"]) for row in rows]

    async def get_referenced_upload_urls(self) -> set[str]:
        rows = await self.pool.fetch(
            """SELECT student_card_file AS url FROM lug_users
            UNION ALL SELECT file_url FROM lug_achievements
            UNION ALL SELECT flag_url FROM lug_teams
            UNION ALL SELECT video_url FROM lug_teams
            UNION ALL SELECT payload->'studentCard'->>'url' FROM lug_email_verifications
                WHERE expires_at_ms >= (extract(epoch from now()) * 1000)::bigint
            UNION ALL SELECT url FROM lug_uploads"""
        )
        return {str(row["url"]) for row in rows if row["url"]}

    async def cleanup_expired_records(self) -> int:
        removed = 0
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                for table in (
                    "lug_sessions",
                    "lug_email_verifications",
                    "lug_password_resets",
                ):
                    column = "expires_at_ms"
                    removed += len(
                        await connection.fetch(
                            f"DELETE FROM {table} WHERE {column} < (extract(epoch from now()) * 1000)::bigint RETURNING 1"
                        )
                    )
        return removed

    async def can_user_read_upload(self, user_id: str, url: str) -> bool:
        return bool(
            await self.pool.fetchval(
                """SELECT EXISTS (SELECT 1 FROM lug_users u
            WHERE u.id = $1 AND (u.role = 'admin' OR u.student_card_file = $2
              OR EXISTS (SELECT 1 FROM lug_uploads up WHERE up.user_id = u.id AND up.url = $2)
              OR EXISTS (SELECT 1 FROM lug_achievements a
                         JOIN lug_uploads achievement_upload ON achievement_upload.upload_id = a.file_upload_id
                         WHERE a.user_id = u.id AND achievement_upload.url = $2)
              OR EXISTS (SELECT 1 FROM lug_teams t WHERE t.id = u.team_id AND t.flag_url = $2)))""",
                user_id,
                url,
            )
        )


def _now_ms() -> int:
    from time import time

    return int(time() * 1000)


def _timestamp(value: Any) -> float:
    from datetime import datetime

    try:
        return (
            datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp() * 1000
        )
    except (TypeError, ValueError):
        return float("nan")
