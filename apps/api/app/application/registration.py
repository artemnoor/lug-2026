"""Registration verification use case."""

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from ..security.auth import (
    password_hash_async,
    verification_code,
    verification_code_hash,
    verify_registration_upload_claim,
)
from ..shared import domain


class RegistrationRuleViolation(Exception):
    def __init__(self, status_code: int, message: str, code: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.code = code


class RegistrationService:
    def __init__(self, context: Any) -> None:
        self.context = context

    async def create_pending_verification(
        self, payload: dict[str, Any], kind: str
    ) -> dict[str, Any]:
        context = self.context
        email = domain.normalize_email(payload.get("email"))
        existing = await context.store.get_email_verification_by_email(email)
        student_card_data = payload["studentCardFile"]
        upload_claim = (
            verify_registration_upload_claim(
                payload.get("studentCardUploadToken", ""),
                context.config.email_verification_secret,
            )
            if str(student_card_data).startswith("/uploads/")
            else None
        )
        if not str(student_card_data).startswith("/uploads/"):
            raise RegistrationRuleViolation(
                422,
                "Сначала загрузите документ через dedicated upload endpoint.",
                "REGISTRATION_UPLOAD_REQUIRED",
            )
        if not upload_claim or upload_claim.get("url") != student_card_data:
            raise RegistrationRuleViolation(
                403,
                "Временная загрузка документа недействительна или истекла.",
                "REGISTRATION_UPLOAD_CLAIM_INVALID",
            )
        student_card = {
            "url": student_card_data,
            "name": payload.get("studentCardFileName", "student-card"),
            "type": payload.get("studentCardType", ""),
            "size": int(payload.get("studentCardSize") or 0),
        }
        if not student_card["type"].startswith("image/") or student_card["size"] <= 0:
            raise RegistrationRuleViolation(
                422,
                "Некорректные параметры загруженного документа.",
                "REGISTRATION_UPLOAD_METADATA_INVALID",
            )

        expires_at_ms = (
            int(datetime.now(timezone.utc).timestamp() * 1000)
            + context.config.email_verification_ttl_ms
        )
        expires_at = (
            datetime.fromtimestamp(expires_at_ms / 1000, timezone.utc)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z")
        )
        stored_payload = {
            key: value
            for key, value in payload.items()
            if key
            not in {
                "password",
                "studentCardFile",
                "studentCardUploadToken",
                "studentCardSize",
                "studentCardType",
            }
        }
        stored_payload["passwordHash"] = await password_hash_async(payload["password"])
        code = verification_code()
        pending = {
            "id": existing.get("id") if existing else str(uuid4()),
            "kind": kind,
            "email": email,
            "codeHash": verification_code_hash(
                code, context.config.email_verification_secret
            ),
            "attempts": 0,
            "lastSentAtMs": int(datetime.now(timezone.utc).timestamp() * 1000),
            "expiresAtMs": expires_at_ms,
            "expiresAt": expires_at,
            "payload": stored_payload,
            "studentCard": student_card,
            "createdAt": domain.now(),
        }
        expires_minutes = max(1, context.config.email_verification_ttl_ms // 60_000)
        email_message = {"code": code, "expiresMinutes": expires_minutes}
        if not context.store.queues_email:
            try:
                await context.email_service.send_verification_code(
                    email, code, expires_minutes
                )
            except Exception:
                await context.file_storage.delete(student_card["url"])
                raise
        try:
            old_urls = await context.store.replace_email_verification(
                pending, email_message
            )
        except Exception:
            await context.file_storage.delete(student_card["url"])
            raise
        for stale_card in set(old_urls):
            await context.file_storage.delete(stale_card)
        return pending
