"""Small entity-oriented repository contracts implemented by each adapter."""

from typing import Any, Protocol


class UserRepository(Protocol):
    async def get_user_by_id(self, user_id: str) -> dict | None: ...
    async def get_user_by_email(self, email: str) -> dict | None: ...
    async def update_user_atomic(
        self,
        user_id: str,
        user: dict,
        actor_id: str,
        upload: dict | None = None,
        remove_upload_url: str = "",
    ) -> dict: ...


class TeamRepository(Protocol):
    async def get_team_snapshot(
        self, team_id: str
    ) -> tuple[dict, list[dict], dict] | None: ...
    async def update_team_atomic(
        self, team_id: str, patch: dict, actor_id: str
    ) -> dict: ...
    async def remove_team_member_atomic(
        self, team_id: str, user_id: str, actor_id: str
    ) -> bool: ...


class AchievementRepository(Protocol):
    async def create_achievement_atomic(
        self, achievement: dict, actor_id: str
    ) -> dict: ...
    async def delete_achievement_atomic(
        self, achievement_id: str, user_id: str
    ) -> bool: ...
    async def review_achievement_atomic(
        self,
        achievement_id: str,
        status: str,
        comment: str,
        points: float | None,
        review_stage: str,
        actor_id: str,
    ) -> dict: ...


class UploadRepository(Protocol):
    async def create_upload_atomic(self, upload: dict, actor_id: str) -> dict: ...
    async def can_user_read_upload(self, user_id: str, url: str) -> bool: ...
    async def claim_upload_for_scan(self) -> dict | None: ...
    async def finish_upload_scan_atomic(
        self, upload_id: str, status: str, scan_status: str, error: str = ""
    ) -> None: ...


class NotificationRepository(Protocol):
    async def create_notification_atomic(
        self, notification: dict, actor_id: str
    ) -> dict: ...
    async def mark_notification_read_atomic(
        self, notification_id: str, user_id: str
    ) -> bool: ...


class SessionRepository(Protocol):
    async def get_user_by_session(self, token_hash: str) -> dict | None: ...
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


class EmailOutboxRepository(Protocol):
    async def enqueue_email(
        self, recipient: str, purpose: str, message: dict
    ) -> None: ...
    async def claim_email(self) -> dict | None: ...
    async def finish_email(self, message_id: Any, error: str | None = None) -> None: ...
