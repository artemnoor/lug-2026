"""PostgreSQL-backed admin commands kept separate from the legacy state routes."""

from typing import Any
from urllib.parse import unquote

from fastapi import Request

from ..application.admin_reviews import AdminReviewService, AdminRuleViolation
from ..http.errors import ApiError
from ..http.utils import json_response, read_json
from ..infrastructure.persistence_errors import PersistenceError
from ..models import ReviewPayload, model_payload
from ..security.auth import SESSION_COOKIE, hash_token, parse_cookies
from ..shared import domain
from ..shared.commands import QuotaCommand


async def admin_user(request: Request) -> dict:
    context = request.app.state.context
    token = parse_cookies(request).get(SESSION_COOKIE, "")
    user = await context.store.get_user_by_session(hash_token(token)) if token else None
    if not user:
        raise ApiError(401, "Требуется вход в личный кабинет.")
    if user.get("role") != "admin":
        raise ApiError(403, "Доступ разрешён только организаторам.")
    return user


async def review_payload(request: Request) -> dict[str, Any]:
    context = request.app.state.context
    try:
        return model_payload(
            ReviewPayload.model_validate(
                await read_json(request, context.config.max_json_body)
            )
        )
    except ValueError as exc:
        raise ApiError(422, "Некорректный формат решения.") from exc


async def update_quota(request: Request, team_id: str):
    context = request.app.state.context
    admin = await admin_user(request)
    data = await read_json(request, context.config.max_json_body)
    command = QuotaCommand(unquote(team_id), bool(data.get("confirmed")))
    try:
        snapshot = await AdminReviewService(context.store).update_quota(
            command.team_id, command.confirmed, admin["id"]
        )
        if not snapshot:
            raise ApiError(404, "Команда не найдена.")
    except AdminRuleViolation as exc:
        raise ApiError(422, exc.message, exc.code) from exc
    except PersistenceError as exc:
        raise ApiError(exc.status_code, exc.message, exc.code) from exc
    return json_response({"team": _team_result(snapshot)}, request=request)


async def review_team(request: Request, team_id: str):
    context = request.app.state.context
    admin = await admin_user(request)
    payload = await review_payload(request)
    command = {
        "status": payload.get("status", ""),
        "field": payload.get("field", ""),
        "comment": str(payload.get("comment") or "").strip(),
    }
    try:
        team, members, settings = await AdminReviewService(context.store).review_team(
            unquote(team_id), command, admin["id"]
        )
    except AdminRuleViolation as exc:
        raise ApiError(422, exc.message, exc.code) from exc
    except PersistenceError as exc:
        raise ApiError(exc.status_code, exc.message, exc.code) from exc
    return json_response(
        {"team": _team_result((team, members, settings))}, request=request
    )


async def review_identity(request: Request, user_id: str):
    context = request.app.state.context
    admin = await admin_user(request)
    data = await review_payload(request)
    try:
        user = await AdminReviewService(context.store).review_identity(
            unquote(user_id), data, admin["id"]
        )
    except AdminRuleViolation as exc:
        raise ApiError(422, exc.message, exc.code) from exc
    except PersistenceError as exc:
        raise ApiError(exc.status_code, exc.message, exc.code) from exc
    return json_response({"user": domain.public_user(user)}, request=request)


async def review_achievement(request: Request, achievement_id: str):
    context = request.app.state.context
    admin = await admin_user(request)
    data = await review_payload(request)
    try:
        achievement = await AdminReviewService(context.store).review_achievement(
            unquote(achievement_id), data, admin["id"]
        )
    except AdminRuleViolation as exc:
        raise ApiError(422, exc.message, exc.code) from exc
    except PersistenceError as exc:
        raise ApiError(exc.status_code, exc.message, exc.code) from exc
    return json_response({"achievement": achievement}, request=request)


async def review_video(request: Request, team_id: str):
    context = request.app.state.context
    admin = await admin_user(request)
    data = await review_payload(request)
    try:
        video = await AdminReviewService(context.store).review_video(
            unquote(team_id), data, admin["id"]
        )
    except AdminRuleViolation as exc:
        raise ApiError(422, exc.message, exc.code) from exc
    except PersistenceError as exc:
        raise ApiError(exc.status_code, exc.message, exc.code) from exc
    return json_response({"videoCard": video}, request=request)


def _team_result(snapshot) -> dict:
    if not snapshot:
        raise ApiError(404, "Команда не найдена.")
    team, members, settings = snapshot
    state = {"settings": settings, "users": members}
    result = dict(team)
    result["quota"] = domain.team_quota(state, team, members)
    result["isAdmitted"] = domain.team_is_admitted(state, team, members)
    return result
