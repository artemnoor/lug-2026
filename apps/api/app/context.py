"""Application dependency container and bootstrap lifecycle."""

import asyncio
import os
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from uuid import uuid4

from .config import AppConfig
from .infrastructure.email import EmailService
from .infrastructure.file_storage import FileStorage
from .infrastructure.store import Store
from .observability import Logger, Metrics
from .security.auth import password_hash, password_matches
from .shared.domain import audit, normalize_email, now, strong_password, valid_email


@dataclass
class AppContext:
    config: AppConfig
    store: Store
    file_storage: FileStorage
    email_service: EmailService
    rate_limiter: object
    logger: Logger
    metrics: Metrics
    mutation_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    tracer: object | None = None

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
    state = await context.store.load()
    if email or password:
        if not valid_email(email) or not strong_password(password):
            raise RuntimeError(
                "LUG_ADMIN_EMAIL и LUG_ADMIN_PASSWORD должны быть заданы и соответствовать требованиям безопасности."
            )
    if not email or not password:
        if not any(user.get("role") == "admin" for user in state["users"]):
            context.logger.warning(
                "admin.not_configured",
                {"hint": "Set LUG_ADMIN_EMAIL and LUG_ADMIN_PASSWORD"},
            )
        return
    existing = next(
        (
            user
            for user in state["users"]
            if user.get("role") == "admin"
            and normalize_email(user.get("email")) == email
        ),
        None,
    )
    if not existing and legacy_phone:
        existing = next(
            (
                user
                for user in state["users"]
                if user.get("role") == "admin" and user.get("phone") == legacy_phone
            ),
            None,
        )
    if existing:
        changed = False
        credentials_changed = False
        if (
            existing.get("email") != email
            or existing.get("emailVerified") is not True
        ):
            existing["email"] = email
            existing["emailVerified"] = True
            existing["emailVerifiedAt"] = existing.get("emailVerifiedAt") or now()
            changed = True
            credentials_changed = True
        if not password_matches(password, existing.get("passwordHash", "")):
            existing["passwordHash"] = password_hash(password)
            audit(
                state, existing["id"], "admin.password_synced", "user", existing["id"]
            )
            changed = True
            credentials_changed = True
        if credentials_changed:
            state["sessions"] = [
                session
                for session in state.get("sessions", [])
                if session.get("userId") != existing["id"]
            ]
        if changed:
            await context.store.save(state)
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
        "passwordHash": password_hash(password),
        "createdAt": now(),
    }
    state["users"].append(admin)
    audit(state, admin["id"], "admin.created", "user", admin["id"])
    await context.store.save(state)
