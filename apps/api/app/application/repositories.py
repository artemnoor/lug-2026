"""Narrow persistence ports used by application use cases.

The concrete JSON and PostgreSQL adapters still share one compatibility backend
for now. The application layer does not depend on that backend's shape: the
composition root exposes only the port needed by each use case. This keeps a
new persistence operation from silently enlarging a God Store dependency.
"""

from dataclasses import dataclass
from typing import Any, Protocol, cast


class SettingsRepository(Protocol):
    async def get_settings(self) -> dict: ...
    async def update_settings_atomic(self, patch: dict, actor_id: str) -> dict: ...


class UserRepository(Protocol):
    async def get_user_by_id(self, user_id: str) -> dict | None: ...
    async def get_user_by_email(self, email: str) -> dict | None: ...
    async def get_admin_by_identity(
        self, email: str, phone: str = ""
    ) -> dict | None: ...
    async def has_admin(self) -> bool: ...
    async def save_admin_atomic(
        self, user: dict, clear_sessions: bool = False
    ) -> dict: ...
    async def is_phone_in_use(self, phone: str, excluding_user_id: str) -> bool: ...
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
    async def review_identity_atomic(
        self, user_id: str, status: str, comment: str, actor_id: str
    ) -> tuple[dict, list[dict], dict]: ...


class TeamRepository(Protocol):
    async def get_invite(self, code: str) -> dict | None: ...
    async def get_team_by_group(self, group: str) -> dict | None: ...
    async def get_team_snapshot(
        self, team_id: str
    ) -> tuple[dict, list[dict], dict] | None: ...
    async def update_team_atomic(
        self, team_id: str, patch: dict, actor_id: str
    ) -> dict: ...
    async def rotate_invite_atomic(
        self, team_id: str, invite_code: str, expires_at: str, actor_id: str
    ) -> dict: ...
    async def update_video_atomic(
        self, team_id: str, video: dict, actor_id: str, upload: dict | None = None
    ) -> dict: ...
    async def update_quota_atomic(
        self, team_id: str, confirmed: bool, actor_id: str
    ) -> dict: ...
    async def remove_team_member_atomic(
        self, team_id: str, user_id: str, actor_id: str
    ) -> bool: ...
    async def review_team_atomic(
        self, team_id: str, field: str, status: str, comment: str, actor_id: str
    ) -> tuple[dict, list[dict], dict]: ...


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
    async def get_user_uploads(self, user_id: str) -> list[dict]: ...
    async def create_upload_atomic(self, upload: dict, actor_id: str) -> dict: ...
    async def can_user_read_upload(self, user_id: str, url: str) -> bool: ...
    async def claim_upload_for_scan(self) -> dict | None: ...
    async def finish_upload_scan_atomic(
        self, upload_id: str, status: str, scan_status: str, error: str = ""
    ) -> None: ...


class NotificationRepository(Protocol):
    async def get_user_notifications(self, user_id: str) -> list[dict]: ...
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


class RegistrationRepository(Protocol):
    async def get_email_verification_by_email(self, email: str) -> dict | None: ...
    async def get_email_verification(self, verification_id: str) -> dict | None: ...
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


class PasswordResetRepository(Protocol):
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


class ParticipantReadRepository(Protocol):
    async def get_dashboard_projection(self, user_id: str) -> dict | None: ...
    async def get_public_results(self) -> dict: ...
    async def get_public_results_data(self) -> dict: ...


class AdminReadRepository(Protocol):
    async def get_admin_overview(self) -> dict: ...
    async def get_admin_collection(
        self,
        resource: str,
        limit: int = 50,
        offset: int = 0,
        query: str = "",
        status: str = "all",
    ) -> dict: ...
    async def get_audit_log(self, limit: int = 200) -> list[dict]: ...
    async def get_broadcast_targets(self) -> dict: ...


class UploadAccessRepository(Protocol):
    async def get_referenced_upload_urls(self) -> set[str]: ...
    async def can_user_read_upload(self, user_id: str, url: str) -> bool: ...


class EmailOutboxRepository(Protocol):
    queues_email: bool

    async def enqueue_email(
        self, recipient: str, purpose: str, message: dict
    ) -> None: ...
    async def claim_email(self) -> dict | None: ...
    async def finish_email(self, message_id: Any, error: str | None = None) -> None: ...
    async def requeue_stale_emails(self) -> None: ...


@dataclass(frozen=True, slots=True)
class ApplicationRepositories:
    """Dependency map exposed to application and HTTP layers."""

    settings: SettingsRepository
    users: UserRepository
    teams: TeamRepository
    achievements: AchievementRepository
    uploads: UploadRepository
    notifications: NotificationRepository
    sessions: SessionRepository
    registration: RegistrationRepository
    password_resets: PasswordResetRepository
    participant_reads: ParticipantReadRepository
    admin_reads: AdminReadRepository
    upload_access: UploadAccessRepository
    email_outbox: EmailOutboxRepository


def expose_application_repositories(backend: object) -> ApplicationRepositories:
    """Bind an adapter once while keeping every consumer on a narrow port."""

    return ApplicationRepositories(
        settings=cast(SettingsRepository, backend),
        users=cast(UserRepository, backend),
        teams=cast(TeamRepository, backend),
        achievements=cast(AchievementRepository, backend),
        uploads=cast(UploadRepository, backend),
        notifications=cast(NotificationRepository, backend),
        sessions=cast(SessionRepository, backend),
        registration=cast(RegistrationRepository, backend),
        password_resets=cast(PasswordResetRepository, backend),
        participant_reads=cast(ParticipantReadRepository, backend),
        admin_reads=cast(AdminReadRepository, backend),
        upload_access=cast(UploadAccessRepository, backend),
        email_outbox=cast(EmailOutboxRepository, backend),
    )
