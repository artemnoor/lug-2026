"""Atomic writes for user-owned uploads, achievements and team media."""

import json
from uuid import UUID, uuid4

from .persistence_errors import PersistenceError
from .postgres_queries import payload


def upload_identity(upload: dict) -> str:
    candidate = str(upload.get("uploadId") or upload.get("id") or uuid4())
    try:
        return str(UUID(candidate))
    except ValueError as exc:
        raise PersistenceError(
            "Некорректный идентификатор загрузки.", 422, "INVALID_UPLOAD_ID"
        ) from exc


class PostgresEntityWriteMixin:
    async def update_team_atomic(
        self, team_id: str, patch: dict, actor_id: str
    ) -> dict:
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                row = await connection.fetchrow(
                    "SELECT payload FROM lug_teams WHERE id=$1 FOR UPDATE", team_id
                )
                if not row:
                    raise PersistenceError("Команда не найдена.", 404)
                team = payload(row["payload"])
                team.update(patch)
                await connection.execute(
                    """UPDATE lug_teams SET name=$2, group_name=$3, member_limit=$4,
                    invite_code=$5, captain_id=$6, invite_status=$7, flag_url=$8,
                    video_url=$9, video_status=$10, video_score=$11, quota_confirmed=$12,
                    review_name_status=$13, review_group_status=$14, review_flag_status=$15,
                    review_description_status=$16, payload=$17::jsonb,
                    entity_version=entity_version + 1, updated_at=now() WHERE id=$1""",
                    team_id,
                    team.get("name", ""),
                    team.get("group", ""),
                    int(team.get("totalStudentsInGroup") or 1),
                    team.get("inviteCode", ""),
                    team.get("captainId") or None,
                    team.get("inviteStatus", "active"),
                    team.get("flagUrl", ""),
                    (team.get("videoCard") or {}).get("url", ""),
                    (team.get("videoCard") or {}).get("status", ""),
                    float((team.get("videoCard") or {}).get("score") or 0),
                    bool(team.get("isQuotaConfirmed", False)),
                    (team.get("review", {}).get("name", {}) or {}).get("status", ""),
                    (team.get("review", {}).get("group", {}) or {}).get("status", ""),
                    (team.get("review", {}).get("flag", {}) or {}).get("status", ""),
                    (team.get("review", {}).get("description", {}) or {}).get(
                        "status", ""
                    ),
                    json.dumps(team, ensure_ascii=False),
                )
                await self._audit(connection, actor_id, "team.updated", "team", team_id)
        return team

    async def rotate_invite_atomic(
        self, team_id: str, invite_code: str, expires_at: str, actor_id: str
    ) -> dict:
        team = await self.update_team_atomic(
            team_id,
            {
                "inviteCode": invite_code,
                "inviteStatus": "active",
                "inviteExpiresAt": expires_at,
            },
            actor_id,
        )
        return {key: team.get(key) for key in ("inviteCode", "inviteExpiresAt")}

    async def update_video_atomic(
        self, team_id: str, video: dict, actor_id: str, upload: dict | None = None
    ) -> dict:
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                row = await connection.fetchrow(
                    "SELECT payload FROM lug_teams WHERE id=$1 FOR UPDATE", team_id
                )
                if not row:
                    raise PersistenceError("Команда не найдена.", 404)
                if upload:
                    upload_id = upload_identity(upload)
                    upload = {**upload, "id": upload_id, "uploadId": upload_id}
                    await connection.execute(
                        """INSERT INTO lug_uploads
                    (upload_id,url,user_id,kind,status,scan_status,storage_key,mime_type,size_bytes,payload)
                    VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)""",
                        upload_id,
                        upload["url"],
                        upload["userId"],
                        upload.get("kind", "video"),
                        upload.get("status", "uploaded"),
                        upload.get("scanStatus", "pending"),
                        upload.get("storageKey", ""),
                        upload.get("type", ""),
                        int(upload.get("size", 0) or 0),
                        json.dumps(upload, ensure_ascii=False),
                    )
                await connection.execute(
                    """UPDATE lug_teams SET payload=jsonb_set(payload, '{videoCard}', $2::jsonb),
                    video_url=$3, video_status=$4, video_score=$5, entity_version=entity_version + 1,
                    updated_at=now() WHERE id=$1""",
                    team_id,
                    json.dumps(video, ensure_ascii=False),
                    video.get("url", ""),
                    video.get("status", ""),
                    float(video.get("score") or 0),
                )
                await self._audit(
                    connection, actor_id, "team.video_submitted", "team", team_id
                )
        return video

    async def create_upload_atomic(self, upload: dict, actor_id: str) -> dict:
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                upload_id = upload_identity(upload)
                upload = {**upload, "id": upload_id, "uploadId": upload_id}
                await connection.execute(
                    """INSERT INTO lug_uploads
                (upload_id,url,user_id,kind,status,scan_status,storage_key,mime_type,size_bytes,payload)
                VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)""",
                    upload_id,
                    upload["url"],
                    upload["userId"],
                    upload.get("kind", "attachment"),
                    upload.get("status", "uploaded"),
                    upload.get("scanStatus", "pending"),
                    upload.get("storageKey", ""),
                    upload.get("type", ""),
                    int(upload.get("size", 0) or 0),
                    json.dumps(upload, ensure_ascii=False),
                )
                await self._audit(
                    connection, actor_id, "file.uploaded", "file", upload_id
                )
        return upload

    async def claim_upload_for_scan(self) -> dict | None:
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                row = await connection.fetchrow(
                    """SELECT upload_id, url, payload FROM lug_uploads
                    WHERE status = 'uploaded' AND scan_status = 'pending'
                    ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1"""
                )
                if not row:
                    return None
                item = payload(row["payload"])
                item.setdefault("id", str(row["upload_id"]))
                item.update(
                    {
                        "uploadId": str(row["upload_id"]),
                        "status": "scanning",
                        "scanStatus": "pending",
                    }
                )
                await connection.execute(
                    """UPDATE lug_uploads SET status='scanning', payload=$2::jsonb,
                    updated_at=now() WHERE upload_id=$1""",
                    row["upload_id"],
                    json.dumps(item, ensure_ascii=False),
                )
                return item

    async def finish_upload_scan_atomic(
        self, upload_id: str, status: str, scan_status: str, error: str = ""
    ) -> None:
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                row = await connection.fetchrow(
                    "SELECT payload FROM lug_uploads WHERE upload_id=$1 FOR UPDATE",
                    upload_id,
                )
                if not row:
                    return
                item = payload(row["payload"])
                item.update({"status": status, "scanStatus": scan_status})
                if error:
                    item["scanError"] = error[:500]
                await connection.execute(
                    """UPDATE lug_uploads SET status=$2, scan_status=$3, payload=$4::jsonb,
                    updated_at=now() WHERE upload_id=$1""",
                    upload_id,
                    status,
                    scan_status,
                    json.dumps(item, ensure_ascii=False),
                )
                await self._audit(
                    connection,
                    "system:upload-scanner",
                    "file.scan_completed",
                    "file",
                    upload_id,
                    {"status": status, "scanStatus": scan_status},
                )

    async def create_achievement_atomic(self, achievement: dict, actor_id: str) -> dict:
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                if not await connection.fetchval(
                    "SELECT 1 FROM lug_users WHERE id=$1", achievement["userId"]
                ):
                    raise PersistenceError("Пользователь не найден.", 404)
                upload_id = await connection.fetchval(
                    "SELECT upload_id FROM lug_uploads WHERE url=$1 AND user_id=$2",
                    achievement["fileUrl"],
                    achievement["userId"],
                )
                if not upload_id:
                    raise PersistenceError("Файл не принадлежит пользователю.", 403)
                achievement = {**achievement, "fileUploadId": str(upload_id)}
                await connection.execute(
                    """INSERT INTO lug_achievements
                    (id,user_id,status,direction,points,file_url,file_upload_id,title,payload)
                    VALUES ($1,$2,$3,$4,$5,$6,$7::uuid,$8,$9::jsonb)""",
                    achievement["id"],
                    achievement["userId"],
                    achievement["status"],
                    achievement.get("direction", ""),
                    float(achievement.get("points") or 0),
                    achievement.get("fileUrl", ""),
                    achievement["fileUploadId"],
                    achievement.get("title", ""),
                    json.dumps(achievement, ensure_ascii=False),
                )
                await self._audit(
                    connection,
                    actor_id,
                    "achievement.created",
                    "achievement",
                    achievement["id"],
                )
        return achievement

    async def delete_achievement_atomic(
        self, achievement_id: str, user_id: str
    ) -> bool:
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                deleted = await connection.fetchval(
                    "DELETE FROM lug_achievements WHERE id=$1 AND user_id=$2 RETURNING id",
                    achievement_id,
                    user_id,
                )
                if not deleted:
                    return False
                await self._audit(
                    connection,
                    user_id,
                    "achievement.deleted",
                    "achievement",
                    achievement_id,
                )
        return True
