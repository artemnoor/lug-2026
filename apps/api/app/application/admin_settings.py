"""Organizer settings and notification broadcast use cases."""

from typing import Any
from uuid import uuid4

from ..shared import domain
from ..shared.commands import SettingsPatch
from ..shared.notifications import (
    send_notification_emails,
    target_users,
    verified_email_recipients,
)


class AdminSettingsRuleViolation(Exception):
    def __init__(self, message: str, code: str = "ADMIN_SETTINGS_INVALID") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


class AdminSettingsService:
    DATE_KEYS = (
        "registrationStart",
        "registrationDeadline",
        "portfolioStart",
        "portfolioDeadline",
        "videoStart",
        "videoDeadline",
        "resultsStart",
        "resultsDeadline",
    )
    DATE_RANGES = (
        ("registrationStart", "registrationDeadline"),
        ("portfolioStart", "portfolioDeadline"),
        ("videoStart", "videoDeadline"),
        ("resultsStart", "resultsDeadline"),
    )
    CONTENT_KEYS = ("manifestoLead", "manifestoNote", "registrationHeadline")

    def __init__(self, context: Any) -> None:
        self.context = context
        self.store = context.store

    async def update(self, payload: dict[str, Any], actor_id: str) -> dict:
        current = await self.store.get_settings()
        self._validate_settings_payload(payload, current)
        if "minTeamPercentage" in payload:
            payload = {
                **payload,
                "minTeamPercentage": int(float(payload["minTeamPercentage"])),
            }
        patch: dict[str, Any] = {
            key: payload[key] for key in self.DATE_KEYS if key in payload
        }
        for key in ("isRegistrationOpen", "minTeamPercentage"):
            if key in payload:
                patch[key] = payload[key]
        if isinstance(payload.get("content"), dict):
            patch["content"] = {
                key: payload["content"][key].strip()
                for key in self.CONTENT_KEYS
                if key in payload["content"]
            }
        return await self.store.update_settings_atomic(
            SettingsPatch(patch).as_dict(), actor_id
        )

    async def broadcast(self, payload: dict[str, Any], actor_id: str) -> dict:
        target_type = str(payload.get("targetType") or "all")
        title = str(payload.get("title") or "").strip()
        message = str(payload.get("message") or "").strip()
        if (
            target_type not in {"all", "teams", "captains", "team", "captain", "user"}
            or payload.get("kind") not in {None, "system"}
            or not title
            or len(title) > 120
            or any(character in title for character in "\r\n")
            or not message
            or len(message) > 1000
        ):
            raise AdminSettingsRuleViolation(
                "Укажите адресатов, заголовок и текст сообщения.",
                "BROADCAST_PAYLOAD_INVALID",
            )
        targets = await self.store.get_broadcast_targets()
        target_id = payload.get("targetId")
        if target_type in {"teams", "captains"}:
            target_id = None
        if target_type in {"team", "captain"} and not any(
            team.get("id") == target_id for team in targets["teams"]
        ):
            raise AdminSettingsRuleViolation("Команда не найдена.", "TEAM_NOT_FOUND")
        if target_type == "user" and not any(
            user.get("id") == target_id and user.get("role") != "admin"
            for user in targets["users"]
        ):
            raise AdminSettingsRuleViolation(
                "Пользователь не найден.", "USER_NOT_FOUND"
            )
        if target_type == "captains" and not any(
            team.get("captainId") for team in targets["teams"]
        ):
            raise AdminSettingsRuleViolation(
                "Ни у одной команды нет капитана.", "NO_CAPTAINS"
            )
        recipients = target_users(targets, target_type, target_id)
        email_recipients = verified_email_recipients(recipients)
        if target_type in {"user", "team", "captain"} and not email_recipients:
            raise AdminSettingsRuleViolation(
                "У выбранного участника нет подтверждённого адреса электронной почты.",
                "VERIFIED_EMAIL_REQUIRED",
            )
        await self.store.create_notification_atomic(
            {
                "id": str(uuid4()),
                "targetType": target_type,
                "targetId": target_id,
                "title": title,
                "message": message,
                "kind": "system",
                "createdAt": domain.now(),
                "readBy": [],
            },
            actor_id,
        )
        delivery = await send_notification_emails(
            self.context, recipients, title, message
        )
        return {
            "emailRecipients": delivery["eligible"],
            "emailSent": delivery["sent"],
            "emailFailed": delivery["failed"],
            "emailMode": self.context.config.email_mode,
        }

    def _validate_settings_payload(
        self, payload: dict[str, Any], current: dict
    ) -> None:
        for key in self.DATE_KEYS:
            if key in payload and not domain.valid_iso_date(payload[key]):
                raise AdminSettingsRuleViolation(
                    f"Укажите корректную дату для поля {key}.", "DATE_INVALID"
                )
        if "minTeamPercentage" in payload:
            value = self._number_or_none(payload["minTeamPercentage"])
            if value is None or not 1 <= value <= 100:
                raise AdminSettingsRuleViolation(
                    "Процент состава должен быть от 1 до 100.",
                    "TEAM_PERCENTAGE_INVALID",
                )
        if "isRegistrationOpen" in payload and not isinstance(
            payload["isRegistrationOpen"], bool
        ):
            raise AdminSettingsRuleViolation(
                "Флаг регистрации должен быть логическим.", "REGISTRATION_FLAG_INVALID"
            )
        next_settings = {
            **current,
            **{key: payload[key] for key in self.DATE_KEYS if key in payload},
        }
        if any(
            domain.timestamp(next_settings[start])
            > domain.timestamp(next_settings[end])
            for start, end in self.DATE_RANGES
        ):
            raise AdminSettingsRuleViolation(
                "Дата начала не может быть позже даты окончания.",
                "DATE_RANGE_INVALID",
            )
        if "content" not in payload:
            return
        content = payload["content"]
        if not isinstance(content, dict):
            raise AdminSettingsRuleViolation(
                "Контент должен быть объектом.", "CONTENT_INVALID"
            )
        if any(
            not isinstance(content.get(key), str) or len(content[key].strip()) > 300
            for key in self.CONTENT_KEYS
            if key in content
        ):
            raise AdminSettingsRuleViolation(
                "Текст контентных блоков не должен превышать 300 символов.",
                "CONTENT_TOO_LONG",
            )

    @staticmethod
    def _number_or_none(value: Any) -> float | None:
        if value is None or value == "":
            return None
        try:
            number = float(value)
        except (TypeError, ValueError) as exc:
            raise AdminSettingsRuleViolation(
                "Процент состава должен быть числом от 1 до 100.",
                "TEAM_PERCENTAGE_INVALID",
            ) from exc
        if number != number or number in {float("inf"), float("-inf")}:
            raise AdminSettingsRuleViolation(
                "Процент состава должен быть числом от 1 до 100.",
                "TEAM_PERCENTAGE_INVALID",
            )
        return number
