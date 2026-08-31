"""Canonical PostgreSQL row projections shared by read repositories."""

import json
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any


def payload(value: Any) -> dict:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return {}
    return value if isinstance(value, dict) else {}


def entity(row: Any, fields: dict[str, str]) -> dict:
    """Merge compatibility JSON with canonical columns, preferring columns."""
    item = payload(row["payload"])
    for column, key in fields.items():
        value = row[column]
        if value is not None:
            if isinstance(value, Decimal):
                value = float(value)
            elif isinstance(value, datetime):
                value = (
                    value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
                )
            item[key] = value
    return item


USER_FIELDS = {
    "id": "id",
    "email": "email",
    "phone": "phone",
    "role": "role",
    "team_id": "teamId",
    "email_verified": "emailVerified",
    "fio": "fio",
    "identity_status": "identityStatus",
    "avatar_url": "avatarUrl",
    "student_card_file": "studentCardFile",
}
TEAM_FIELDS = {
    "id": "id",
    "group_name": "group",
    "captain_id": "captainId",
    "invite_code": "inviteCode",
    "invite_status": "inviteStatus",
    "name": "name",
    "member_limit": "totalStudentsInGroup",
    "flag_url": "flagUrl",
    "video_url": "videoUrl",
    "video_status": "videoStatus",
    "video_score": "videoScore",
}
ACHIEVEMENT_FIELDS = {
    "id": "id",
    "user_id": "userId",
    "status": "status",
    "direction": "direction",
    "points": "points",
    "file_url": "fileUrl",
    "title": "title",
}
UPLOAD_FIELDS = {
    "upload_id": "uploadId",
    "url": "url",
    "user_id": "userId",
    "kind": "kind",
    "status": "status",
    "scan_status": "scanStatus",
    "storage_key": "storageKey",
    "mime_type": "type",
    "size_bytes": "size",
    "created_at": "createdAt",
}
NOTIFICATION_FIELDS = {
    "id": "id",
    "target_type": "targetType",
    "target_id": "targetId",
    "kind": "kind",
    "title": "title",
    "message": "message",
    "created_at": "createdAt",
}
