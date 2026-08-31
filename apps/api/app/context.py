"""Application dependency container and bootstrap lifecycle."""

import asyncio
import os
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from uuid import uuid4

from .application.repositories import ApplicationRepositories
from .application.services import ApplicationServices
from .config import AppConfig
from .infrastructure.email import EmailService
from .infrastructure.file_storage import FileStorage
from .infrastructure.store import PersistenceBackend
from .observability import Logger, Metrics
from .security.auth import password_hash_async, password_matches_async
from .shared.domain import normalize_email, now, strong_password, valid_email


@dataclass
class AppContext:
    config: AppConfig
    store: PersistenceBackend
    repositories: ApplicationRepositories
    file_storage: FileStorage
    email_service: EmailService
    rate_limiter: object
    logger: Logger
    metrics: Metrics
    mutation_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    tracer: object | None = None
    services: ApplicationServices | None = None

    @property
    def persistence_provider(self) -> str:
        return self.store.provider

    @asynccontextmanager
    async def mutation_guard(self):
        """Serialize file writes while allowing independent PostgreSQL writes."""
        if getattr(self.store, "serializes_writes", True):
            async with self.mutation_lock:
                yield
            return
        yield


async def ensure_bootstrap_admin(context: AppContext) -> None:
    email = normalize_email(os.getenv("LUG_ADMIN_EMAIL", ""))
    legacy_phone = os.getenv("LUG_ADMIN_PHONE", "").strip()
    password = os.getenv("LUG_ADMIN_PASSWORD", "")
    if email or password:
        if not valid_email(email) or not strong_password(password):
            raise RuntimeError(
                "LUG_ADMIN_EMAIL и LUG_ADMIN_PASSWORD должны быть заданы и соответствовать требованиям безопасности."
            )
    if not email or not password:
        if not await context.repositories.users.has_admin():
            context.logger.warning(
                "admin.not_configured",
                {"hint": "Set LUG_ADMIN_EMAIL and LUG_ADMIN_PASSWORD"},
            )
        return
    existing = await context.repositories.users.get_admin_by_identity(
        email, legacy_phone
    )
    if existing:
        changed = False
        credentials_changed = False
        if existing.get("email") != email or existing.get("emailVerified") is not True:
            existing["email"] = email
            existing["emailVerified"] = True
            existing["emailVerifiedAt"] = existing.get("emailVerifiedAt") or now()
            changed = True
            credentials_changed = True
        if not await password_matches_async(password, existing.get("passwordHash", "")):
            existing["passwordHash"] = await password_hash_async(password)
            changed = True
            credentials_changed = True
        if changed:
            await context.repositories.users.save_admin_atomic(
                existing, credentials_changed
            )
        return
    admin = {
        "id": str(uuid4()),
        "fio": os.getenv("LUG_ADMIN_NAME", "Администратор ЛУГ").strip(),
        "group": "",
        "email": email,
        "emailVerified": True,
        "emailVerifiedAt": now(),
        "phone": legacy_phone,
        "messenger": "",
        "messengerContact": "",
        "telegramAccount": "",
        "role": "admin",
        "teamId": None,
        "studentCardFile": "",
        "avatarUrl": "",
        "identityStatus": "approved",
        "identityComment": "",
        "isIdentityConfirmed": True,
        "consentAt": now(),
        "consentVersion": "1.0",
        "consentPolicy": "/privacy.html",
        "passwordHash": await password_hash_async(password),
        "createdAt": now(),
    }
    await context.repositories.users.save_admin_atomic(admin)
