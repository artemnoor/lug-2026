"""Organizer settings and notification broadcast endpoints."""

from typing import Any

from fastapi import APIRouter, Request

from ..http.errors import ApiError
from ..http.utils import json_response, read_json
from ..security.auth import require_admin
from ..shared import domain

router = APIRouter(prefix="/api/admin")


async def _admin_state(request: Request) -> tuple[Any, dict, dict]:
    context = request.app.state.context
    state = await context.store.load()
    return context, state, require_admin(request, state)


@router.patch("/settings")
async def update_settings(request: Request):
    context, state, admin = await _admin_state(request)
    payload = await read_json(request, context.config.max_json_body)
    date_keys = (
        "registrationStart",
        "registrationDeadline",
        "portfolioStart",
        "portfolioDeadline",
        "videoStart",
        "videoDeadline",
        "resultsStart",
        "resultsDeadline",
    )
    for key in date_keys:
        if key in payload and not domain.valid_iso_date(payload[key]):
            raise ApiError(422, f"Укажите корректную дату для поля {key}.")
    if "minTeamPercentage" in payload and (
        not _number_or_none(payload["minTeamPercentage"])
        or not 1 <= float(payload["minTeamPercentage"]) <= 100
    ):
        raise ApiError(422, "Процент состава должен быть от 1 до 100.")
    if "isRegistrationOpen" in payload and not isinstance(
        payload["isRegistrationOpen"], bool
    ):
        raise ApiError(422, "Флаг регистрации должен быть логическим.")
    next_settings = {
        **state["settings"],
        **{key: payload[key] for key in date_keys if key in payload},
    }
    ranges = (
        ("registrationStart", "registrationDeadline"),
        ("portfolioStart", "portfolioDeadline"),
        ("videoStart", "videoDeadline"),
        ("resultsStart", "resultsDeadline"),
    )
    if any(
        domain.timestamp(next_settings[start]) > domain.timestamp(next_settings[end])
        for start, end in ranges
    ):
        raise ApiError(422, "Дата начала не может быть позже даты окончания.")
    if "content" in payload:
        content = payload["content"]
        if not isinstance(content, dict):
            raise ApiError(422, "Контент должен быть объектом.")
        if any(
            not isinstance(content.get(key), str) or len(content[key].strip()) > 300
            for key in ("manifestoLead", "manifestoNote", "registrationHeadline")
            if key in content
        ):
            raise ApiError(
                422, "Текст контентных блоков не должен превышать 300 символов."
            )
    state["settings"].update({key: payload[key] for key in date_keys if key in payload})
    if "isRegistrationOpen" in payload:
        state["settings"]["isRegistrationOpen"] = payload["isRegistrationOpen"]
    if isinstance(payload.get("content"), dict):
        state["settings"]["content"].update(
            {
                key: payload["content"][key].strip()
                for key in ("manifestoLead", "manifestoNote", "registrationHeadline")
                if key in payload["content"]
            }
        )
    if "minTeamPercentage" in payload:
        state["settings"]["minTeamPercentage"] = int(payload["minTeamPercentage"])
    domain.audit(state, admin["id"], "settings.updated", "settings", "global")
    await context.store.save(state)
    return json_response({"settings": state["settings"]}, request=request)


@router.post("/notifications/broadcast")
async def broadcast(request: Request):
    context, state, admin = await _admin_state(request)
    payload = await read_json(request, context.config.max_json_body)
    target_type = str(payload.get("targetType") or "all")
    title = str(payload.get("title") or "").strip()
    message = str(payload.get("message") or "").strip()
    if (
        target_type not in {"all", "teams", "captains", "team", "captain", "user"}
        or payload.get("kind") not in {None, "system"}
        or not title
        or len(title) > 120
        or not message
        or len(message) > 1000
    ):
        raise ApiError(422, "Укажите адресатов, заголовок и текст сообщения.")
    target_id = payload.get("targetId")
    if target_type in {"teams", "captains"}:
        target_id = None
    if target_type in {"team", "captain"} and not any(
        team.get("id") == target_id for team in state["teams"]
    ):
        raise ApiError(404, "Команда не найдена.")
    if target_type == "user" and not any(
        user.get("id") == target_id and user.get("role") != "admin"
        for user in state["users"]
    ):
        raise ApiError(404, "Пользователь не найден.")
    if target_type == "captains" and not any(
        team.get("captainId") for team in state["teams"]
    ):
        raise ApiError(422, "Ни у одной команды нет капитана.")
    domain.notify(
        state,
        target_type,
        target_id,
        title,
        message,
    )
    domain.audit(
        state, admin["id"], "notification.sent", target_type, target_id or "all"
    )
    await context.store.save(state)
    return json_response({"success": True}, 201, request)


def _number_or_none(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise ApiError(422, "Баллы должны быть числом от 0 до 100.") from exc
    if number != number or number in {float("inf"), float("-inf")}:
        raise ApiError(422, "Баллы должны быть числом от 0 до 100.")
    return number
