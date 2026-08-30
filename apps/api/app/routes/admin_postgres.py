"""PostgreSQL-backed admin commands kept separate from the legacy state routes."""

from typing import Any
from urllib.parse import unquote

from fastapi import Request

from ..http.errors import ApiError
from ..http.utils import json_response, read_json
from ..infrastructure.postgres_writes import PersistenceError
from ..models import ReviewPayload, model_payload
from ..security.auth import SESSION_COOKIE, hash_token, parse_cookies
from ..shared import domain
from ..shared.commands import QuotaCommand, ReviewCommand


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
            ReviewPayload.model_validate(await read_json(request, context.config.max_json_body))
        )
    except ValueError as exc:
        raise ApiError(422, "Некорректный формат решения.") from exc


async def update_quota(request: Request, team_id: str):
    context = request.app.state.context
    admin = await admin_user(request)
    data = await read_json(request, context.config.max_json_body)
    command = QuotaCommand(unquote(team_id), bool(data.get("confirmed")))
    try:
        team = await context.store.update_quota_atomic(
            command.team_id, command.confirmed, admin["id"]
        )
        snapshot = await context.store.get_team_snapshot(team["id"])
    except PersistenceError as exc:
        raise ApiError(exc.status_code, exc.message) from exc
    return json_response({"team": _team_result(snapshot)}, request=request)


async def review_team(request: Request, team_id: str):
    context = request.app.state.context
    admin = await admin_user(request)
    payload = await review_payload(request)
    field, status = payload.get("field"), payload.get("status")
    if field not in {"name", "group", "flag", "description"} or status not in domain.REVIEW_STATUSES:
        raise ApiError(422, "Недопустимое решение по данным команды.")
    comment = str(payload.get("comment") or "").strip()
    _require_comment(status, comment)
    command = ReviewCommand(status=status, field=field, comment=comment)
    try:
        team, members, settings = await context.store.review_team_atomic(
            unquote(team_id), command.field, command.status, command.comment, admin["id"]
        )
    except PersistenceError as exc:
        raise ApiError(exc.status_code, exc.message) from exc
    return json_response({"team": _team_result((team, members, settings))}, request=request)


async def review_identity(request: Request, user_id: str):
    context = request.app.state.context
    admin = await admin_user(request)
    data = await review_payload(request)
    status = data.get("status")
    if status not in domain.REVIEW_STATUSES:
        raise ApiError(422, "Недопустимый статус проверки личности.")
    comment = str(data.get("comment") or "").strip()
    _require_comment(status, comment)
    try:
        user, _, _ = await context.store.review_identity_atomic(
            unquote(user_id), status, comment, admin["id"]
        )
    except PersistenceError as exc:
        raise ApiError(exc.status_code, exc.message) from exc
    return json_response({"user": domain.public_user(user)}, request=request)


async def review_achievement(request: Request, achievement_id: str):
    context = request.app.state.context
    admin = await admin_user(request)
    data = await review_payload(request)
    status = data.get("status")
    if status not in domain.REVIEW_STATUSES:
        raise ApiError(422, "Недопустимый статус материала.")
    comment = str(data.get("comment") or "").strip()
    _require_comment(status, comment)
    points = _number_or_none(data.get("points"))
    if points is not None and not 0 <= points <= 100:
        raise ApiError(422, "Баллы должны быть числом от 0 до 100.")
    try:
        achievement = await context.store.review_achievement_atomic(
            unquote(achievement_id), status, comment, points,
            str(data.get("reviewStage") or "received"), admin["id"],
        )
    except PersistenceError as exc:
        raise ApiError(exc.status_code, exc.message) from exc
    return json_response({"achievement": achievement}, request=request)


async def review_video(request: Request, team_id: str):
    context = request.app.state.context
    admin = await admin_user(request)
    data = await review_payload(request)
    status = data.get("status")
    if status not in domain.REVIEW_STATUSES:
        raise ApiError(422, "Недопустимый статус видео-визитки.")
    comment = str(data.get("comment") or "").strip()
    _require_comment(status, comment)
    limits = {"topic": 8, "creativity": 8, "quality": 5, "vfx": 2}
    scores = {}
    for key, limit in limits.items():
        value = _number_or_none((data.get("criteriaScores") or {}).get(key)) or 0
        if value < 0 or value > limit:
            raise ApiError(422, f"Оценка «{key}» должна быть от 0 до {limit}.")
        scores[key] = value
    try:
        video = await context.store.review_video_atomic(
            unquote(team_id), status, comment, scores, admin["id"]
        )
    except PersistenceError as exc:
        raise ApiError(exc.status_code, exc.message) from exc
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


def _require_comment(status: str, comment: str) -> None:
    if status == "rejected" and not comment:
        raise ApiError(422, "При отклонении обязательно укажите причину.")


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
