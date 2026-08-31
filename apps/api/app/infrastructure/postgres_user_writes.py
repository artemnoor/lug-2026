"""Atomic user/profile and notification commands for PostgreSQL."""

import json
from datetime import datetime, timezone
from uuid import uuid4

from .persistence_errors import PersistenceError
from .postgres_entity_writes import upload_identity
from .postgres_queries import payload


class PostgresUserWriteMixin:
    async def rehash_password_atomic(self, user_id: str, password_hash: str) -> None:
        async with self.pool.acquire() as connection:
            await connection.execute(
                "UPDATE lug_users SET payload = jsonb_set(payload, '{passwordHash}', to_jsonb($2::text)), entity_version = entity_version + 1, updated_at = now() WHERE id = $1",
                user_id,
                password_hash,
            )

    async def save_admin_atomic(self, user: dict, clear_sessions: bool = False) -> dict:
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                await connection.execute(
                    """INSERT INTO lug_users (id, email, phone, role, team_id, email_verified,
                    fio, identity_status, avatar_url, student_card_file, payload)
                    VALUES ($1, $2, $3, 'admin', NULL, TRUE, $4, $5, $6, $7, $8::jsonb)
                    ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, phone = EXCLUDED.phone,
                    role = 'admin', email_verified = TRUE, fio = EXCLUDED.fio,
                    identity_status = EXCLUDED.identity_status, avatar_url = EXCLUDED.avatar_url,
                    student_card_file = EXCLUDED.student_card_file, payload = EXCLUDED.payload, updated_at = now()""",
                    user["id"],
                    user.get("email", ""),
                    user.get("phone", ""),
                    user.get("fio", ""),
                    user.get("identityStatus", ""),
                    user.get("avatarUrl", ""),
                    user.get("studentCardFile", ""),
                    json.dumps(user, ensure_ascii=False),
                )
                if clear_sessions:
                    await connection.execute(
                        "DELETE FROM lug_sessions WHERE user_id = $1", user["id"]
                    )
                await self._audit(
                    connection,
                    user["id"],
                    "admin.credentials_synced",
                    "user",
                    user["id"],
                )
        return dict(user)

    async def remove_team_member_atomic(
        self, team_id: str, user_id: str, actor_id: str
    ) -> bool:
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                team = await connection.fetchval(
                    "SELECT id FROM lug_teams WHERE id = $1 FOR UPDATE", team_id
                )
                member = await connection.fetchval(
                    "SELECT id FROM lug_users WHERE id = $1 AND team_id = $2 FOR UPDATE",
                    user_id,
                    team_id,
                )
                if not team or not member:
                    return False
                await connection.execute(
                    "DELETE FROM lug_achievements WHERE user_id = $1", user_id
                )
                await connection.execute(
                    "DELETE FROM lug_sessions WHERE user_id = $1", user_id
                )
                await connection.execute("DELETE FROM lug_users WHERE id = $1", user_id)
                await self._audit(
                    connection, actor_id, "team.member_removed", "user", user_id
                )
        return True

    async def create_notification_atomic(
        self, notification: dict, actor_id: str
    ) -> dict:
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                await connection.execute(
                    """INSERT INTO lug_notifications
                    (id, target_type, target_id, kind, title, message, payload)
                    VALUES ($1, $2, $3, 'system', $4, $5, $6::jsonb)""",
                    notification["id"],
                    notification["targetType"],
                    notification.get("targetId"),
                    notification.get("title", ""),
                    notification.get("message", ""),
                    json.dumps(notification, ensure_ascii=False),
                )
                await self._audit(
                    connection,
                    actor_id,
                    "notification.sent",
                    notification["targetType"],
                    notification.get("targetId") or "all",
                )
        return dict(notification)

    async def mark_notification_read_atomic(
        self, notification_id: str, user_id: str
    ) -> bool:
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                row = await connection.fetchrow(
                    """SELECT n.id, n.payload FROM lug_notifications n
                    JOIN lug_users u ON u.id = $2
                    WHERE n.id = $1 AND (
                        n.target_type = 'all'
                        OR (n.target_type = 'teams' AND u.team_id IS NOT NULL)
                        OR (n.target_type = 'team' AND n.target_id = u.team_id)
                        OR (n.target_type = 'user' AND n.target_id = u.id)
                        OR (n.target_type = 'captains' AND EXISTS
                            (SELECT 1 FROM lug_teams t WHERE t.captain_id = u.id))
                        OR (n.target_type = 'admins' AND EXISTS
                            (SELECT 1 FROM lug_users a WHERE a.id = u.id AND a.role = 'admin'))
                        OR (n.target_type = 'captain' AND n.target_id = u.team_id
                            AND EXISTS (SELECT 1 FROM lug_teams t WHERE t.id = u.team_id AND t.captain_id = u.id))
                    ) FOR UPDATE""",
                    notification_id,
                    user_id,
                )
                if not row:
                    return False
                item = payload(row["payload"])
                read_by = list(item.get("readBy") or [])
                if user_id not in read_by:
                    read_by.append(user_id)
                    item["readBy"] = read_by
                    await connection.execute(
                        "UPDATE lug_notifications SET payload = $2::jsonb, updated_at = now() WHERE id = $1",
                        notification_id,
                        json.dumps(item, ensure_ascii=False),
                    )
                return True

    async def update_user_atomic(
        self,
        user_id: str,
        user: dict,
        actor_id: str,
        upload: dict | None = None,
        remove_upload_url: str = "",
    ) -> dict:
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                row = await connection.fetchrow(
                    "SELECT id FROM lug_users WHERE id = $1 FOR UPDATE", user_id
                )
                if not row:
                    raise PersistenceError("Пользователь не найден.", 404)
                await connection.execute(
                    """UPDATE lug_users
                    SET email = $2, phone = $3, role = $4, team_id = $5,
                        email_verified = $6, fio = $7, identity_status = $8,
                        avatar_url = $9, student_card_file = $10, payload = $11::jsonb, updated_at = now()
                    WHERE id = $1""",
                    user_id,
                    user.get("email", ""),
                    user.get("phone", ""),
                    user.get("role", ""),
                    user.get("teamId") or None,
                    user.get("emailVerified") is True,
                    user.get("fio", ""),
                    user.get("identityStatus", ""),
                    user.get("avatarUrl", ""),
                    user.get("studentCardFile", ""),
                    json.dumps(user, ensure_ascii=False),
                )
                if upload:
                    upload_id = upload_identity(upload)
                    upload = {**upload, "id": upload_id, "uploadId": upload_id}
                    await connection.execute(
                        """INSERT INTO lug_uploads
                        (upload_id,url,user_id,kind,status,scan_status,storage_key,mime_type,size_bytes,payload)
                        VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
                        ON CONFLICT (url) DO UPDATE SET upload_id = EXCLUDED.upload_id, payload = EXCLUDED.payload,
                        user_id = EXCLUDED.user_id, kind = EXCLUDED.kind,
                        status = EXCLUDED.status, scan_status = EXCLUDED.scan_status, updated_at = now()""",
                        upload_id,
                        upload["url"],
                        user_id,
                        upload.get("kind", "student-card"),
                        upload.get("status", "uploaded"),
                        upload.get("scanStatus", "pending"),
                        upload.get("storageKey", ""),
                        upload.get("type", ""),
                        int(upload.get("size", 0) or 0),
                        json.dumps(upload, ensure_ascii=False),
                    )
                if remove_upload_url:
                    await connection.execute(
                        "DELETE FROM lug_uploads WHERE url = $1", remove_upload_url
                    )
                await self._audit(
                    connection, actor_id, "profile.updated", "user", user_id
                )
                if upload:
                    item = {
                        "id": str(uuid4()),
                        "targetType": "admins",
                        "targetId": user_id,
                        "title": "Новое фото личного кабинета",
                        "message": "Участник прикрепил(а) новое фото личного кабинета.",
                        "kind": "system",
                        "createdAt": datetime.now(timezone.utc)
                        .isoformat()
                        .replace("+00:00", "Z"),
                        "readBy": [],
                    }
                    await connection.execute(
                        """INSERT INTO lug_notifications
                        (id, target_type, kind, title, message, payload)
                        VALUES ($1, 'admins', 'system', $2, $3, $4::jsonb)""",
                        item["id"],
                        item["title"],
                        item["message"],
                        json.dumps(item, ensure_ascii=False),
                    )
        return dict(user)
