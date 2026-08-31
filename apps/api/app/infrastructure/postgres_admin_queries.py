"""Bounded PostgreSQL projections used by the admin compatibility API."""

from typing import Any

from .postgres_projection import entity as _entity
from .postgres_queries import (
    ACHIEVEMENT_FIELDS,
    NOTIFICATION_FIELDS,
    TEAM_FIELDS,
    USER_FIELDS,
    payload,
)


class PostgresAdminQueryMixin:
    async def get_broadcast_targets(self) -> dict:
        async with self.pool.acquire() as connection:
            users = [
                {
                    "id": row["id"],
                    "email": row["email"],
                    "role": row["role"],
                    "teamId": row["team_id"],
                    "emailVerified": row["email_verified"],
                }
                for row in await connection.fetch(
                    "SELECT id, email, role, team_id, email_verified FROM lug_users WHERE role <> 'admin'"
                )
            ]
            teams = [
                {"id": row["id"], "captainId": row["captain_id"]}
                for row in await connection.fetch(
                    "SELECT id, captain_id FROM lug_teams"
                )
            ]
        return {"users": users, "teams": teams}

    async def get_admin_overview(self) -> dict:
        from ..shared.projections import admin_snapshot

        async with self.pool.acquire() as connection:
            data = {
                "settings": payload(
                    await connection.fetchval(
                        "SELECT payload FROM lug_settings WHERE id = 1"
                    )
                )
            }
            projections = {
                "users": (
                    "lug_users",
                    "payload, id, email, phone, role, team_id, email_verified, "
                    "fio, identity_status, avatar_url, student_card_file",
                    USER_FIELDS,
                ),
                "teams": (
                    "lug_teams",
                    "payload, id, group_name, captain_id, invite_code, invite_status, "
                    "name, member_limit, flag_url, video_url, video_status, video_score",
                    TEAM_FIELDS,
                ),
                "achievements": (
                    "lug_achievements",
                    "payload, id, user_id, status, direction, points, file_url, title",
                    ACHIEVEMENT_FIELDS,
                ),
                "notifications": (
                    "lug_notifications",
                    "payload, id, target_type, target_id, kind, title, message, created_at",
                    NOTIFICATION_FIELDS,
                ),
            }
            for key, (table, columns, fields) in projections.items():
                rows = await connection.fetch(
                    f"SELECT {columns} FROM {table} ORDER BY updated_at DESC LIMIT 100"
                )
                data[key] = [_entity(row, fields) for row in rows]
            rows = await connection.fetch(
                "SELECT payload FROM lug_audit_log ORDER BY at DESC LIMIT 200"
            )
            data["auditLog"] = [payload(row["payload"]) for row in rows]
            data["_counts"] = {
                "teams": int(
                    await connection.fetchval("SELECT count(*) FROM lug_teams") or 0
                ),
                "users": int(
                    await connection.fetchval(
                        "SELECT count(*) FROM lug_users WHERE role <> 'admin'"
                    )
                    or 0
                ),
                "achievements": int(
                    await connection.fetchval("SELECT count(*) FROM lug_achievements")
                    or 0
                ),
                "notifications": int(
                    await connection.fetchval("SELECT count(*) FROM lug_notifications")
                    or 0
                ),
                "pendingAchievements": int(
                    await connection.fetchval(
                        "SELECT count(*) FROM lug_achievements WHERE status = 'pending'"
                    )
                    or 0
                ),
                "pendingIdentity": int(
                    await connection.fetchval(
                        "SELECT count(*) FROM lug_users WHERE role <> 'admin' AND identity_status = 'pending'"
                    )
                    or 0
                ),
                "pendingVideos": int(
                    await connection.fetchval(
                        "SELECT count(*) FROM lug_teams WHERE video_status = 'pending'"
                    )
                    or 0
                ),
            }
        return admin_snapshot(data)

    async def get_admin_collection(
        self,
        resource: str,
        limit: int = 50,
        offset: int = 0,
        query: str = "",
        status: str = "",
    ) -> dict:
        table_by_resource = {
            "users": (
                "lug_users",
                "role <> 'admin'",
                "updated_at DESC",
                "payload, id, email, phone, role, team_id, email_verified, fio, identity_status, avatar_url, student_card_file",
                USER_FIELDS,
            ),
            "teams": (
                "lug_teams",
                "TRUE",
                "updated_at DESC",
                "payload, id, group_name, captain_id, invite_code, invite_status, name, member_limit, flag_url, video_url, video_status, video_score",
                TEAM_FIELDS,
            ),
            "achievements": (
                "lug_achievements",
                "TRUE",
                "updated_at DESC",
                "payload, id, user_id, status, direction, points, file_url, title",
                ACHIEVEMENT_FIELDS,
            ),
        }
        config = table_by_resource.get(resource)
        if not config:
            return {"items": [], "total": 0}
        table, base_where, order, columns, fields = config
        filters = [base_where]
        args: list[Any] = []
        if query:
            args.append(f"%{query.strip()}%")
            query_arg = "$%d" % len(args)
            if resource == "users":
                filters.append(
                    f"(email ILIKE {query_arg} OR fio ILIKE {query_arg} OR phone ILIKE {query_arg})"
                )
            elif resource == "teams":
                filters.append(
                    f"(name ILIKE {query_arg} OR group_name ILIKE {query_arg} OR invite_code ILIKE {query_arg})"
                )
            else:
                filters.append(
                    f"(title ILIKE {query_arg} OR direction ILIKE {query_arg} OR file_url ILIKE {query_arg})"
                )
        if status not in {"", "all"}:
            column = (
                "status"
                if resource == "achievements"
                else "identity_status"
                if resource == "users"
                else "invite_status"
            )
            args.append(status)
            filters.append(f"{column} = ${len(args)}")
        where = " AND ".join(filters)
        total = await self.pool.fetchval(
            f"SELECT count(*) FROM {table} WHERE {where}", *args
        )
        args.extend([max(1, min(limit, 100)), max(0, offset)])
        rows = await self.pool.fetch(
            f"SELECT {columns} FROM {table} WHERE {where} ORDER BY {order} LIMIT ${len(args) - 1} OFFSET ${len(args)}",
            *args,
        )
        items = [_entity(row, fields) for row in rows]
        if resource == "users":
            from ..shared import domain

            items = [domain.public_user(item) for item in items]
        return {"items": items, "total": int(total or 0)}
