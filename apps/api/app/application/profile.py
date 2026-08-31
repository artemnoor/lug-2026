"""Profile update use case and student-card replacement workflow."""

from copy import deepcopy
from typing import Any

from ..shared import domain


class ProfileRuleViolation(Exception):
    def __init__(self, status_code: int, message: str, code: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.code = code


class ProfileService:
    FIELD_LIMITS = {
        "fio": 200,
        "phone": 32,
        "messenger": 32,
        "messengerContact": 128,
        "telegramAccount": 128,
    }

    def __init__(self, store: Any, file_storage: Any) -> None:
        self.store = store
        self.file_storage = file_storage

    async def update(self, state: dict, user: dict, payload: dict) -> dict:
        next_user = deepcopy(user)
        await self._validate_fields(user, next_user, payload)
        uploaded_card, old_card_url = self._student_card_replacement(
            state, user, next_user, payload
        )
        try:
            upload_record = (
                {
                    "url": uploaded_card["url"],
                    "userId": user["id"],
                    "kind": "student-card",
                    "size": uploaded_card["size"],
                    "createdAt": domain.now(),
                }
                if uploaded_card
                else None
            )
            saved_user = await self.store.update_user_atomic(
                user["id"],
                next_user,
                user["id"],
                upload_record,
                old_card_url if uploaded_card else "",
            )
        except Exception:
            if uploaded_card:
                await self.file_storage.delete(uploaded_card.get("url", ""))
            raise
        if uploaded_card and old_card_url and old_card_url != uploaded_card["url"]:
            try:
                await self.file_storage.delete(old_card_url)
            except Exception:
                pass
        return saved_user

    async def _validate_fields(
        self, user: dict, next_user: dict, payload: dict
    ) -> None:
        if "email" in payload and domain.normalize_email(
            payload.get("email")
        ) != domain.normalize_email(user.get("email")):
            raise ProfileRuleViolation(
                422,
                "Почту нельзя изменить без повторного подтверждения.",
                "EMAIL_CHANGE_REQUIRES_VERIFICATION",
            )
        for key, limit in self.FIELD_LIMITS.items():
            if isinstance(payload.get(key), str):
                if len(payload[key]) > limit:
                    raise ProfileRuleViolation(
                        422,
                        "Одно из полей профиля слишком длинное.",
                        "PROFILE_FIELD_TOO_LONG",
                    )
                next_user[key] = payload[key].strip()
        contacts = domain.normalize_messenger_contacts({**user, **payload})
        if (
            not next_user.get("fio")
            or (
                next_user.get("phone")
                and not domain.valid_phone(next_user.get("phone"))
            )
            or not domain.validate_messenger_contacts(contacts)
        ):
            raise ProfileRuleViolation(
                422,
                "Укажите имя и хотя бы один корректный контакт.",
                "PROFILE_CONTACTS_INVALID",
            )
        if next_user.get("phone"):
            next_user["phone"] = domain.normal_phone(next_user["phone"])
        if next_user.get("phone") and await self.store.is_phone_in_use(
            next_user["phone"], user["id"]
        ):
            raise ProfileRuleViolation(
                409, "Этот телефон уже используется.", "PHONE_ALREADY_IN_USE"
            )
        next_user["messengerContacts"] = contacts
        first_key, first_value = next(iter(contacts.items()))
        next_user.update(
            {
                "messenger": first_key,
                "messengerContact": first_value,
                "telegramAccount": contacts.get("telegram", ""),
            }
        )

    def _student_card_replacement(
        self, state: dict, user: dict, next_user: dict, payload: dict
    ) -> tuple[dict | None, str]:
        student_card_data = payload.get("studentCardFile")
        has_replacement = isinstance(student_card_data, str) and bool(
            student_card_data.strip()
        )
        if student_card_data is not None and not isinstance(student_card_data, str):
            raise ProfileRuleViolation(
                422, "Некорректное фото личного кабинета.", "PROFILE_CARD_INVALID"
            )
        old_card_url = str(user.get("studentCardFile") or "")
        if not has_replacement:
            return None, old_card_url
        name = payload.get("studentCardFileName")
        if not isinstance(name, str) or not name.strip():
            raise ProfileRuleViolation(
                422, "Укажите имя файла фотографии.", "PROFILE_CARD_NAME_REQUIRED"
            )
        name = name.strip()
        if len(name) > 255:
            raise ProfileRuleViolation(
                422, "Имя файла слишком длинное.", "PROFILE_CARD_NAME_TOO_LONG"
            )
        if not student_card_data.startswith("/uploads/"):
            raise ProfileRuleViolation(
                422,
                "Сначала загрузите фотографию через форму.",
                "PROFILE_CARD_UPLOAD_REQUIRED",
            )
        uploaded = next(
            (
                item
                for item in state.get("uploads", [])
                if item.get("url") == student_card_data
                and item.get("userId") == user["id"]
            ),
            None,
        )
        if not uploaded or uploaded.get("kind") != "student-card":
            raise ProfileRuleViolation(
                403,
                "Сначала загрузите фотографию через форму.",
                "PROFILE_CARD_NOT_OWNED",
            )
        if not str(uploaded.get("type") or "").startswith("image/"):
            raise ProfileRuleViolation(
                422,
                "Прикрепите фотографию в формате изображения.",
                "PROFILE_CARD_IMAGE_REQUIRED",
            )
        next_user.update(
            {
                "studentCardFile": student_card_data,
                "studentCardFileName": name,
                "identityStatus": "pending",
                "identityComment": "",
                "isIdentityConfirmed": False,
            }
        )
        return uploaded, old_card_url
