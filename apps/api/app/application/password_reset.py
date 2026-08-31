"""Password recovery use cases."""

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from ..security.auth import (
    password_hash_async,
    verification_code,
    verification_code_hash,
)
from ..shared import domain
from .repositories import PasswordResetRepository, UserRepository


class PasswordResetRuleViolation(Exception):
    def __init__(self, status_code: int, message: str, code: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.code = code


class PasswordResetService:
    def __init__(self, context: Any) -> None:
        self.context = context
        repositories = getattr(context, "repositories", None)
        backend = getattr(context, "store", None)
        self.users: UserRepository = repositories.users if repositories else backend
        self.resets: PasswordResetRepository = (
            repositories.password_resets if repositories else backend
        )
        self.outbox = repositories.email_outbox if repositories else backend

    async def request(self, email: str) -> None:
        normalized = domain.normalize_email(email)
        if not domain.valid_email(normalized):
            raise PasswordResetRuleViolation(
                422, "Укажите корректный адрес электронной почты.", "EMAIL_INVALID"
            )
        user = await self.users.get_user_by_email(normalized)
        if not user or user.get("emailVerified") is not True:
            return
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        code = verification_code()
        expires_minutes = max(
            1, self.context.config.email_verification_ttl_ms // 60_000
        )
        reset = {
            "id": str(uuid4()),
            "email": normalized,
            "codeHash": verification_code_hash(
                code, self.context.config.email_verification_secret
            ),
            "attempts": 0,
            "lastSentAtMs": now_ms,
            "expiresAtMs": now_ms + self.context.config.email_verification_ttl_ms,
            "createdAt": domain.now(),
        }
        queued = await self.resets.create_password_reset_atomic(
            normalized,
            reset,
            {"code": code, "expiresMinutes": expires_minutes},
            now_ms,
            self.context.config.email_verification_cooldown_ms,
        )
        if queued and not self.outbox.queues_email:
            await self.context.email_service.send_password_reset_code(
                normalized, code, expires_minutes
            )

    async def reset(self, email: str, code: str, password: str) -> None:
        normalized = domain.normalize_email(email)
        if not domain.valid_email(normalized):
            raise PasswordResetRuleViolation(
                422, "Укажите корректный адрес электронной почты.", "EMAIL_INVALID"
            )
        if not domain.strong_password(password):
            raise PasswordResetRuleViolation(
                422,
                "Пароль должен содержать минимум 8 символов, строчную и прописную букву, цифру и спецсимвол.",
                "PASSWORD_INVALID",
            )
        await self.resets.reset_password_atomic(
            normalized,
            verification_code_hash(code, self.context.config.email_verification_secret),
            await password_hash_async(password),
            self.context.config.email_verification_max_attempts,
        )
