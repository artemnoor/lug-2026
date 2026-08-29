"""Profile-specific file handling shared by the authenticated user route."""

from copy import deepcopy
from typing import Any

from fastapi import APIRouter, Request

from ..http.errors import ApiError
from ..http.utils import json_response, read_json
from ..security.auth import require_user
from ..shared import domain

router = APIRouter(prefix="/api")


def _context(request: Request):
    return request.app.state.context


async def _auth_state(request: Request) -> tuple[Any, dict, dict]:
    context = _context(request)
    state = await context.store.load()
    return context, state, require_user(request, state)


async def _check_upload_rate(context: Any, request: Request, user: dict) -> None:
    for key, limit in (
        ("upload", context.config.upload_rate_limit_per_ip),
        (f"upload-user-{user['id']}", context.config.upload_rate_limit_per_user),
    ):
        result = await context.rate_limiter.check(request, key, limit)
        if not result["allowed"]:
            raise ApiError(429, "Слишком много загрузок. Повторите через минуту.")


async def prepare_student_card_replacement(
    context: Any,
    state: dict,
    user: dict,
    next_user: dict,
    payload: dict[str, Any],
) -> tuple[dict[str, Any] | None, str, list[dict]]:
    student_card_data = payload.get("studentCardFile")
    has_replacement = isinstance(student_card_data, str) and bool(student_card_data.strip())
    if student_card_data is not None and not isinstance(student_card_data, str):
        raise ApiError(422, "Некорректное фото личного кабинета.")

    old_card_url = str(user.get("studentCardFile") or "")
    if not has_replacement:
        return None, old_card_url, state.get("uploads", [])

    student_card_name = payload.get("studentCardFileName")
    if not isinstance(student_card_name, str) or not student_card_name.strip():
        raise ApiError(422, "Укажите имя файла фотографии.")
    student_card_name = student_card_name.strip()
    if len(student_card_name) > 255:
        raise ApiError(422, "Имя файла слишком длинное.")

    uploads_without_current = [
        item
        for item in state.get("uploads", [])
        if not (
            item.get("userId") == user["id"]
            and item.get("kind") == "student-card"
            and item.get("url") == old_card_url
        )
    ]
    quota_state = dict(state)
    quota_state["uploads"] = uploads_without_current
    estimated_size = context.file_storage.estimate_size(student_card_data)
    if not domain.upload_quota_available(
        quota_state,
        user["id"],
        context.config.max_uploads_per_user,
        context.config.max_upload_bytes_per_user,
        estimated_size,
    ):
        raise ApiError(413, "Достигнут лимит количества или общего размера файлов.")

    uploaded_card = await context.file_storage.save(student_card_data, student_card_name)
    if not str(uploaded_card.get("type") or "").startswith("image/"):
        await context.file_storage.delete(uploaded_card.get("url", ""))
        raise ApiError(422, "Прикрепите фотографию в формате изображения.")
    next_user.update(
        {
            "studentCardFile": uploaded_card["url"],
            "studentCardFileName": student_card_name,
            "identityStatus": "pending",
            "identityComment": "",
            "isIdentityConfirmed": False,
        }
    )
    return uploaded_card, old_card_url, uploads_without_current


@router.patch("/me")
async def update_profile(request: Request):
    context, state, user = await _auth_state(request)
    # Фото приходит как data URL и может быть больше обычного JSON-профиля.
    payload = await read_json(request, context.config.max_upload_body)
    if isinstance(payload.get("studentCardFile"), str) and payload["studentCardFile"].strip():
        await _check_upload_rate(context, request, user)
    next_user = deepcopy(user)
    field_limits = {
        "fio": 200,
        "phone": 32,
        "messenger": 32,
        "messengerContact": 128,
        "telegramAccount": 128,
    }
    if "email" in payload and domain.normalize_email(payload.get("email")) != domain.normalize_email(user.get("email")):
        raise ApiError(422, "Почту нельзя изменить без повторного подтверждения.")
    for key in (
        "fio",
        "phone",
        "messenger",
        "messengerContact",
        "telegramAccount",
    ):
        if isinstance(payload.get(key), str):
            if len(payload[key]) > field_limits[key]:
                raise ApiError(422, "Одно из полей профиля слишком длинное.")
            next_user[key] = payload[key].strip()
    contacts = domain.normalize_messenger_contacts({**user, **payload})
    if (
        not next_user.get("fio")
        or (next_user.get("phone") and not domain.valid_phone(next_user.get("phone")))
        or not domain.validate_messenger_contacts(contacts)
    ):
        raise ApiError(422, "Укажите имя и хотя бы один корректный контакт.")
    if next_user.get("phone"):
        next_user["phone"] = domain.normal_phone(next_user["phone"])
    if any(
        entry.get("id") != user.get("id")
        and next_user.get("phone")
        and domain.normal_phone(entry.get("phone")) == next_user["phone"]
        for entry in state["users"]
    ):
        raise ApiError(409, "Этот телефон уже используется.")
    next_user["messengerContacts"] = contacts
    first_key, first_value = next(iter(contacts.items()))
    next_user.update(
        {
            "messenger": first_key,
            "messengerContact": first_value,
            "telegramAccount": contacts.get("telegram", ""),
        }
    )
    uploaded_card, old_card_url, uploads_without_current = await prepare_student_card_replacement(
        context, state, user, next_user, payload
    )

    try:
        user.update(next_user)
        if uploaded_card:
            state["uploads"] = uploads_without_current + [
                {
                    "url": uploaded_card["url"],
                    "userId": user["id"],
                    "kind": "student-card",
                    "size": uploaded_card["size"],
                    "createdAt": domain.now(),
                }
            ]
            domain.notify(
                state,
                "admins",
                user["id"],
                "Новое фото личного кабинета",
                f"{user.get('fio', 'Участник')} прикрепил(а) новое фото личного кабинета. Проверьте участника в разделе «Участники».",
            )
            domain.audit(
                state,
                user["id"],
                "identity.document_replaced",
                "user",
                user["id"],
            )
        domain.audit(state, user["id"], "profile.updated", "user", user["id"])
        await context.store.save(state)
    except Exception:
        if uploaded_card:
            await context.file_storage.delete(uploaded_card.get("url", ""))
        raise

    if uploaded_card and old_card_url and old_card_url != uploaded_card["url"]:
        try:
            await context.file_storage.delete(old_card_url)
        except Exception:
            # Замену уже сохранили; старый объект можно удалить при уборке хранилища.
            pass
    return json_response({"user": domain.public_user(user)}, request=request)
