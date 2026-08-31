"""Persistence protocol, JSON compatibility store, and provider factory."""

import asyncio
import json
import os
import time
from pathlib import Path
from typing import Any, Protocol
from uuid import uuid4

from .json_review_commands import JsonReviewCommandMixin
from .json_store_commands import JsonStoreCommandMixin
from .json_store_queries import JsonStoreQueryMixin


class JsonDatabaseState(dict):
    """JSON adapter state retained only for development/compatibility."""


def normalize_db(data: Any, defaults: dict) -> JsonDatabaseState:
    settings = data.get("settings", {}) if isinstance(data, dict) else {}
    content = settings.get("content", {}) if isinstance(settings, dict) else {}
    state = JsonDatabaseState(
        settings={**defaults, **(settings if isinstance(settings, dict) else {})},
        users=[],
        teams=[],
        achievements=[],
        notifications=[],
        auditLog=[],
        sessions=[],
        uploads=[],
        emailVerifications=[],
        passwordResets=[],
    )
    state["settings"]["content"] = {
        **defaults["content"],
        **(content if isinstance(content, dict) else {}),
    }
    if isinstance(data, dict):
        state.update(data)
    for key in (
        "users",
        "teams",
        "achievements",
        "notifications",
        "auditLog",
        "sessions",
        "uploads",
        "emailVerifications",
        "passwordResets",
    ):
        if not isinstance(state.get(key), list):
            state[key] = []
    # Переписки больше не являются частью продукта. Старые записи не должны
    # попадать ни в API, ни обратно в persistent store после следующей записи.
    state["notifications"] = [
        item for item in state["notifications"] if item.get("kind") != "chat"
    ]
    state["sessions"] = [
        {key: value for key, value in item.items() if key != "token"}
        for item in state["sessions"]
        if isinstance(item, dict)
    ]
    return state


class Store(Protocol):
    provider: str
    serializes_writes: bool
    queues_email: bool
    atomic_reviews: bool
    atomic_password_reset: bool
    atomic_registration: bool

    async def get_settings(self) -> dict: ...
    async def get_user_by_email(self, email: str) -> dict | None: ...

    async def get_user_by_id(self, user_id: str) -> dict | None: ...

    async def get_admin_by_identity(
        self, email: str, phone: str = ""
    ) -> dict | None: ...

    async def has_admin(self) -> bool: ...

    async def save_admin_atomic(
        self, user: dict, clear_sessions: bool = False
    ) -> dict: ...

    async def get_user_notifications(self, user_id: str) -> list[dict]: ...

    async def get_user_uploads(self, user_id: str) -> list[dict]: ...

    async def is_phone_in_use(self, phone: str, excluding_user_id: str) -> bool: ...

    async def mark_notification_read_atomic(
        self, notification_id: str, user_id: str
    ) -> bool: ...

    async def update_user_atomic(
        self,
        user_id: str,
        user: dict,
        actor_id: str,
        upload: dict | None = None,
        remove_upload_url: str = "",
    ) -> dict: ...

    async def rehash_password_atomic(
        self, user_id: str, password_hash: str
    ) -> None: ...

    async def remove_team_member_atomic(
        self, team_id: str, user_id: str, actor_id: str
    ) -> bool: ...

    async def get_user_by_session(self, token_hash: str) -> dict | None: ...

    async def get_invite(self, code: str) -> dict | None: ...

    async def get_team_by_group(self, group: str) -> dict | None: ...

    async def get_email_verification_by_email(self, email: str) -> dict | None: ...

    async def get_email_verification(self, verification_id: str) -> dict | None: ...

    async def create_password_reset_atomic(
        self,
        email: str,
        reset: dict,
        email_message: dict,
        now_ms: int,
        cooldown_ms: int,
    ) -> bool: ...

    async def reset_password_atomic(
        self, email: str, expected_hash: str, new_password_hash: str, max_attempts: int
    ) -> dict: ...

    async def get_team_snapshot(
        self, team_id: str
    ) -> tuple[dict, list[dict], dict] | None: ...

    async def replace_email_verification(
        self, pending: dict, email_message: dict | None = None
    ) -> list[str]: ...

    async def resend_email_verification_atomic(
        self,
        verification_id: str,
        fields: dict,
        email_message: dict,
        now_ms: int,
        cooldown_ms: int,
    ) -> dict: ...

    async def commit_pending_atomic(
        self,
        verification_id: str,
        session_ttl_ms: int,
        expected_code_hash: str | None = None,
        max_attempts: int | None = None,
    ) -> tuple[dict, str]: ...

    async def get_dashboard_projection(self, user_id: str) -> dict | None: ...

    async def get_admin_overview(self) -> dict: ...

    async def get_broadcast_targets(self) -> dict: ...

    async def get_admin_collection(
        self,
        resource: str,
        limit: int = 50,
        offset: int = 0,
        query: str = "",
        status: str = "all",
    ) -> dict: ...

    async def get_public_results_data(self) -> dict: ...

    async def get_public_results(self) -> dict: ...

    async def get_audit_log(self, limit: int = 200) -> list[dict]: ...

    async def get_referenced_upload_urls(self) -> set[str]: ...

    async def cleanup_expired_records(self) -> int: ...

    async def can_user_read_upload(self, user_id: str, url: str) -> bool: ...

    async def create_session_atomic(
        self, user_id: str, ttl_ms: int, actor_id: str | None = None
    ) -> str: ...

    async def remove_session_atomic(self, token_hash: str) -> None: ...

    async def list_sessions(
        self, user_id: str, current_token_hash: str
    ) -> list[dict]: ...

    async def remove_other_sessions_atomic(
        self, user_id: str, current_token_hash: str
    ) -> int: ...

    async def create_upload_atomic(self, upload: dict, actor_id: str) -> dict: ...

    async def claim_upload_for_scan(self) -> dict | None: ...

    async def finish_upload_scan_atomic(
        self, upload_id: str, status: str, scan_status: str, error: str = ""
    ) -> None: ...

    async def create_notification_atomic(
        self, notification: dict, actor_id: str
    ) -> dict: ...

    async def create_achievement_atomic(
        self, achievement: dict, actor_id: str
    ) -> dict: ...

    async def delete_achievement_atomic(
        self, achievement_id: str, user_id: str
    ) -> bool: ...

    async def update_team_atomic(
        self, team_id: str, patch: dict, actor_id: str
    ) -> dict: ...

    async def rotate_invite_atomic(
        self, team_id: str, invite_code: str, expires_at: str, actor_id: str
    ) -> dict: ...

    async def update_video_atomic(
        self, team_id: str, video: dict, actor_id: str, upload: dict | None = None
    ) -> dict: ...

    async def update_settings_atomic(self, patch: dict, actor_id: str) -> dict: ...

    async def update_quota_atomic(
        self, team_id: str, confirmed: bool, actor_id: str
    ) -> dict: ...

    async def enqueue_email(
        self, recipient: str, purpose: str, message: dict
    ) -> None: ...

    async def claim_email(self) -> dict | None: ...

    async def finish_email(self, message_id: Any, error: str | None = None) -> None: ...

    async def requeue_stale_emails(self) -> None: ...

    async def review_team_atomic(
        self, team_id: str, field: str, status: str, comment: str, actor_id: str
    ) -> tuple[dict, list[dict], dict]: ...

    async def review_identity_atomic(
        self, user_id: str, status: str, comment: str, actor_id: str
    ) -> tuple[dict, list[dict], dict]: ...

    async def review_achievement_atomic(
        self,
        achievement_id: str,
        status: str,
        comment: str,
        points: float | None,
        review_stage: str,
        actor_id: str,
    ) -> dict: ...

    async def review_video_atomic(
        self, team_id: str, status: str, comment: str, scores: dict, actor_id: str
    ) -> dict: ...

    async def close(self) -> None: ...


class JsonStore(JsonStoreQueryMixin, JsonStoreCommandMixin, JsonReviewCommandMixin):
    provider = "json"
    serializes_writes = True
    queues_email = False
    atomic_reviews = True
    atomic_password_reset = True
    atomic_registration = True

    def __init__(self, data_dir: Path, defaults: dict) -> None:
        self.file = data_dir / "lug.json"
        self.defaults = defaults
        data_dir.mkdir(parents=True, exist_ok=True)
        self.lock = asyncio.Lock()

    async def load(self) -> JsonDatabaseState:
        return await asyncio.to_thread(self._load_sync)

    def _load_sync(self) -> JsonDatabaseState:
        if not self.file.exists():
            return normalize_db(None, self.defaults)
        try:
            data = json.loads(self.file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeError(
                "Не удалось прочитать data/lug.json. Восстановите файл из резервной копии."
            ) from exc
        return normalize_db(data, self.defaults)

    async def save(self, state: JsonDatabaseState) -> None:
        async with self.lock:
            await asyncio.to_thread(self._save_sync, state)

    async def get_settings(self) -> dict:
        return (await self.load())["settings"]

    async def get_user_by_email(self, email: str) -> dict | None:
        normalized = str(email or "").strip().lower()
        state = await self.load()
        return next(
            (
                user
                for user in state["users"]
                if str(user.get("email", "")).strip().lower() == normalized
            ),
            None,
        )

    async def get_user_by_session(self, token_hash: str) -> dict | None:
        state = await self.load()
        now_ms = int(time.time() * 1000)
        session = next(
            (
                item
                for item in state["sessions"]
                if item.get("tokenHash") == token_hash
                and int(item.get("expiresAt", 0) or 0) >= now_ms
            ),
            None,
        )
        if not session:
            return None
        return next(
            (
                user
                for user in state["users"]
                if user.get("id") == session.get("userId")
            ),
            None,
        )

    async def get_invite(self, code: str) -> dict | None:
        state = await self.load()
        now_ms = int(time.time() * 1000)
        return next(
            (
                team
                for team in state["teams"]
                if team.get("inviteCode") == code
                and team.get("inviteStatus") == "active"
                and _timestamp_ms(team.get("inviteExpiresAt")) >= now_ms
            ),
            None,
        )

    async def get_dashboard_projection(self, user_id: str) -> dict | None:
        state = await self.load()
        if not any(user.get("id") == user_id for user in state["users"]):
            return None
        return state

    async def get_admin_overview(self) -> dict:
        from ..shared.projections import admin_snapshot

        return admin_snapshot(await self.load())

    def _save_sync(self, state: JsonDatabaseState) -> None:
        temporary = self.file.with_name(
            f"{self.file.name}.{os.getpid()}.{uuid4().hex}.tmp"
        )
        temporary.write_text(
            json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        os.replace(temporary, self.file)

    async def close(self) -> None:
        return None

    def health(self) -> dict:
        return {"provider": self.provider, "file": str(self.file)}


def _timestamp_ms(value: Any) -> float:
    from datetime import datetime

    try:
        return (
            datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp() * 1000
        )
    except (TypeError, ValueError):
        return float("nan")


async def create_store(
    provider: str,
    data_dir: Path,
    database_url: str,
    defaults: dict,
    pool_min_size: int = 2,
    pool_max_size: int = 20,
    email_outbox_encryption_key: bytes | None = None,
    database_ssl_mode: str = "disable",
    database_ssl_root_cert: str = "",
) -> Store:
    if provider == "postgres":
        if not database_url:
            raise RuntimeError(
                "LUG_DATABASE_PROVIDER=postgres требует LUG_DATABASE_URL или DATABASE_URL."
            )
        from .postgres import PostgresStore

        return await PostgresStore.create(
            database_url,
            defaults,
            pool_min_size,
            pool_max_size,
            email_outbox_encryption_key,
            database_ssl_mode,
            database_ssl_root_cert,
        )
    return JsonStore(data_dir, defaults)
