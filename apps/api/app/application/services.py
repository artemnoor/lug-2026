"""Application use-case composition for the API process."""

from dataclasses import dataclass
from typing import Any

from .admin_queries import AdminQueryService
from .admin_reviews import AdminReviewService
from .admin_settings import AdminSettingsService
from .authentication import AuthenticationService
from .participant_context import ParticipantContextService
from .participant_mutations import ParticipantMutationService
from .password_reset import PasswordResetService
from .profile import ProfileService
from .registration import RegistrationService
from .uploads import UploadService


@dataclass(frozen=True, slots=True)
class ApplicationServices:
    authentication: AuthenticationService
    registration: RegistrationService
    uploads: UploadService
    participant_context: ParticipantContextService
    participant_mutations: ParticipantMutationService
    profile: ProfileService
    admin_reviews: AdminReviewService
    admin_queries: AdminQueryService
    admin_settings: AdminSettingsService
    password_reset: PasswordResetService


def build_services(context: Any) -> ApplicationServices:
    repositories = context.repositories
    return ApplicationServices(
        authentication=AuthenticationService(
            repositories.users,
            repositories.sessions,
            context.config.session_ttl_ms,
        ),
        registration=RegistrationService(context),
        uploads=UploadService(
            repositories.uploads, context.file_storage, context.config
        ),
        participant_context=ParticipantContextService(
            repositories.settings,
            repositories.teams,
            repositories.uploads,
            repositories.participant_reads,
        ),
        participant_mutations=ParticipantMutationService(
            repositories.teams, repositories.achievements
        ),
        profile=ProfileService(
            repositories.users, context.file_storage, repositories.uploads
        ),
        admin_reviews=AdminReviewService(
            repositories.teams, repositories.users, repositories.achievements
        ),
        admin_queries=AdminQueryService(repositories.admin_reads),
        admin_settings=AdminSettingsService(context),
        password_reset=PasswordResetService(context),
    )
