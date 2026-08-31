"""Registration, email verification and invitation use cases."""

from collections.abc import Mapping
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
from ..shared.commands import RegistrationCommand
from .repositories import (
    RegistrationRepository,
    SettingsRepository,
    TeamRepository,
    UserRepository,
)


class RegistrationRuleViolation(Exception):
    def __init__(self, status_code: int, message: str, code: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.code = code


class RegistrationService:
    def __init__(self, context: Any) -> None:
        self.context = context
        repositories = getattr(context, "repositories", None)
        backend = getattr(context, "store", None)
        self.registration: RegistrationRepository = (
            repositories.registration if repositories else backend
        )
        self.settings: SettingsRepository = (
            repositories.settings if repositories else backend
        )
        self.teams: TeamRepository = repositories.teams if repositories else backend
        self.users: UserRepository = repositories.users if repositories else backend
        self.email_outbox = repositories.email_outbox if repositories else backend

    async def begin(
        self, payload: RegistrationCommand | Mapping[str, Any], kind: str
    ) -> dict[str, Any]:
        """Validate the complete flow and create its pending email challenge."""

        values = _values(payload)
        settings = await self.settings.get_settings()
        if not domain.registration_open(settings):
            raise RegistrationRuleViolation(
                403, "Регистрация завершена или ещё не началась.", "REGISTRATION_CLOSED"
            )
        email = domain.normalize_email(values.get("email"))
        existing_user = await self.users.get_user_by_email(email)
        existing_team = await self.teams.get_team_by_group(values.get("group"))
        members: list[dict] = []
        team = None
        if kind == "participant":
            team = await self.teams.get_invite(values.get("inviteCode", ""))
            if not team:
                raise RegistrationRuleViolation(
                    404, "Приглашение неактивно.", "INVITE_INVALID"
                )
            snapshot = await self.teams.get_team_snapshot(team["id"])
            members = snapshot[1] if snapshot else []
        _validate_registration(
            values,
            [existing_user] if existing_user else [],
            [existing_team] if existing_team else [],
            is_team=kind == "team",
        )
        if kind == "participant" and sum(
            member.get("teamId") == team.get("id") for member in members
        ) >= int(team.get("totalStudentsInGroup") or 0):
            raise RegistrationRuleViolation(
                409,
                "В команде уже достигнута заявленная вместимость.",
                "TEAM_CAPACITY_REACHED",
            )
        return await self.create_pending_verification(values, kind)

    async def create_pending_verification(
        self, payload: RegistrationCommand | Mapping[str, Any], kind: str
    ) -> dict[str, Any]:
        values = _values(payload)
        email = domain.normalize_email(values.get("email"))
        existing = await self.registration.get_email_verification_by_email(email)
        student_card_data = values["studentCardFile"]
        upload_claim = (
            verify_registration_upload_claim(
                values.get("studentCardUploadToken", ""),
                self.context.config.email_verification_secret,
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
            "name": values.get("studentCardFileName", "student-card"),
            "type": values.get("studentCardType", ""),
            "size": int(values.get("studentCardSize") or 0),
        }
        if not student_card["type"].startswith("image/") or student_card["size"] <= 0:
            raise RegistrationRuleViolation(
                422,
                "Некорректные параметры загруженного документа.",
                "REGISTRATION_UPLOAD_METADATA_INVALID",
            )

        expires_at_ms, expires_at = self._verification_expiry()
        stored_payload = {
            key: value
            for key, value in values.items()
            if key
            not in {
                "password",
                "studentCardFile",
                "studentCardUploadToken",
                "studentCardSize",
                "studentCardType",
            }
        }
        stored_payload["passwordHash"] = await password_hash_async(values["password"])
        code = verification_code()
        pending = {
            "id": existing.get("id") if existing else str(uuid4()),
            "kind": kind,
            "email": email,
            "codeHash": verification_code_hash(
                code, self.context.config.email_verification_secret
            ),
            "attempts": 0,
            "lastSentAtMs": int(datetime.now(timezone.utc).timestamp() * 1000),
            "expiresAtMs": expires_at_ms,
            "expiresAt": expires_at,
            "payload": stored_payload,
            "studentCard": student_card,
            "createdAt": domain.now(),
        }
        expires_minutes = max(
            1, self.context.config.email_verification_ttl_ms // 60_000
        )
        email_message = {"code": code, "expiresMinutes": expires_minutes}
        try:
            if not self.email_outbox.queues_email:
                await self.context.email_service.send_verification_code(
                    email, code, expires_minutes
                )
            old_urls = await self.registration.replace_email_verification(
                pending, email_message
            )
        except Exception:
            await self.context.file_storage.delete(student_card["url"])
            raise
        for stale_card in set(old_urls):
            await self.context.file_storage.delete(stale_card)
        return pending

    async def verify_email(self, verification_id: str, code: str) -> tuple[dict, str]:
        expected = verification_code_hash(
            code, self.context.config.email_verification_secret
        )
        return await self.registration.commit_pending_atomic(
            verification_id,
            self.context.config.session_ttl_ms,
            expected,
            self.context.config.email_verification_max_attempts,
        )

    @staticmethod
    def public_user(user: Mapping[str, Any]) -> dict[str, Any]:
        return domain.public_user(dict(user))

    async def resend_email_code(self, verification_id: str) -> dict[str, Any]:
        pending = await self.registration.get_email_verification(verification_id)
        if not pending:
            raise RegistrationRuleViolation(
                404,
                "Заявка на подтверждение не найдена или уже обработана.",
                "NOT_FOUND",
            )
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        retry_ms = self.context.config.email_verification_cooldown_ms - (
            now_ms - int(pending.get("lastSentAtMs", 0))
        )
        if retry_ms > 0:
            raise RegistrationRuleViolation(
                429,
                f"Новый код можно запросить через {max(1, retry_ms // 1000)} сек.",
                "VERIFICATION_COOLDOWN",
            )
        code = verification_code()
        expires_at_ms, expires_at = self._verification_expiry()
        expires_minutes = max(
            1, self.context.config.email_verification_ttl_ms // 60_000
        )
        try:
            pending = await self.registration.resend_email_verification_atomic(
                verification_id,
                {
                    "codeHash": verification_code_hash(
                        code, self.context.config.email_verification_secret
                    ),
                    "attempts": 0,
                    "lastSentAtMs": now_ms,
                    "expiresAtMs": expires_at_ms,
                    "expiresAt": expires_at,
                },
                {"code": code, "expiresMinutes": expires_minutes},
                now_ms,
                self.context.config.email_verification_cooldown_ms,
            )
            if not self.email_outbox.queues_email:
                await self.context.email_service.send_verification_code(
                    pending["email"], code, expires_minutes
                )
        except Exception:
            raise
        return pending

    def _verification_expiry(self) -> tuple[int, str]:
        expires_at_ms = (
            int(datetime.now(timezone.utc).timestamp() * 1000)
            + self.context.config.email_verification_ttl_ms
        )
        expires_at = (
            datetime.fromtimestamp(expires_at_ms / 1000, timezone.utc)
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z")
        )
        return expires_at_ms, expires_at


def _values(payload: RegistrationCommand | Mapping[str, Any]) -> dict[str, Any]:
    if isinstance(payload, RegistrationCommand):
        return payload.as_mapping()
    return dict(payload)


def _validate_registration(
    payload: Mapping[str, Any], users: list[dict], teams: list[dict], is_team: bool
) -> None:
    required = (
        ["fio", "group", "teamName", "email", "password", "studentCardFile"]
        if is_team
        else ["fio", "email", "password", "studentCardFile"]
    )
    if (
        any(not str(payload.get(field) or "").strip() for field in required)
        or payload.get("consent") is not True
    ):
        raise RegistrationRuleViolation(
            422,
            "Заполните все обязательные поля и подтвердите согласие.",
            "REQUIRED_FIELDS_INVALID",
        )
    if not domain.valid_email(payload.get("email")):
        raise RegistrationRuleViolation(
            422, "Укажите корректный адрес электронной почты.", "EMAIL_INVALID"
        )
    if payload.get("phone") and not domain.valid_phone(payload.get("phone")):
        raise RegistrationRuleViolation(
            422, "Если указываете телефон, проверьте его формат.", "PHONE_INVALID"
        )
    if not domain.strong_password(payload.get("password")):
        raise RegistrationRuleViolation(
            422,
            "Пароль должен содержать минимум 8 символов, строчную и прописную букву, цифру и спецсимвол.",
            "PASSWORD_INVALID",
        )
    contacts = domain.normalize_messenger_contacts(dict(payload))
    if not domain.validate_messenger_contacts(contacts):
        raise RegistrationRuleViolation(
            422,
            "Выберите хотя бы один мессенджер и укажите корректный контакт.",
            "CONTACTS_INVALID",
        )
    if is_team:
        total = int(payload.get("totalStudentsInGroup") or 0)
        if total < 1 or total > 1000:
            raise RegistrationRuleViolation(
                422,
                "Укажите количество студентов в группе от 1 до 1000.",
                "TEAM_SIZE_INVALID",
            )
    email = domain.normalize_email(payload.get("email"))
    if any(domain.normalize_email(user.get("email")) == email for user in users):
        raise RegistrationRuleViolation(
            409,
            "Этот адрес электронной почты уже зарегистрирован.",
            "EMAIL_ALREADY_REGISTERED",
        )
    if is_team and any(
        team.get("group") == str(payload.get("group")).strip().upper() for team in teams
    ):
        raise RegistrationRuleViolation(
            409,
            "Для этой учебной группы уже создана команда.",
            "GROUP_ALREADY_REGISTERED",
        )
