"""Authenticated participant and captain endpoints."""

from copy import deepcopy
from typing import Any

from fastapi import APIRouter, Request

from ..application.participant_context import ParticipantContextService
from ..application.participant_mutations import (
    ParticipantMutationService,
    ParticipantRuleViolation,
)
from ..application.uploads import UploadRuleViolation, UploadService
from ..http.errors import ApiError
from ..http.utils import json_response, read_json
from ..models import (
    AchievementPayload,
    UploadCompletePayload,
    UploadIntentPayload,
    model_payload,
)
from ..security.auth import SESSION_COOKIE, hash_token, parse_cookies
from ..shared import domain

router = APIRouter(prefix="/api")


def _context(request: Request):
    return request.app.state.context


async def _validated(request: Request, model: type, limit: int) -> dict[str, Any]:
    payload = await read_json(request, limit)
    try:
        return model_payload(model.model_validate(payload))
    except ValueError as exc:
        raise ApiError(422, "Некорректный формат запроса.") from exc


async def _auth_state(request: Request) -> tuple[Any, dict, dict]:
    context = _context(request)
    token = parse_cookies(request).get(SESSION_COOKIE, "")
    user = await context.store.get_user_by_session(hash_token(token)) if token else None
    if not user:
        raise ApiError(401, "Требуется вход в личный кабинет.")
    state = await ParticipantContextService(context.store).load(user)
    return context, state, user


async def _check_upload_rate(context: Any, request: Request, user: dict) -> None:
    checks = (
        ("upload", context.config.upload_rate_limit_per_ip),
        (f"upload-user-{user['id']}", context.config.upload_rate_limit_per_user),
    )
    for key, limit in checks:
        result = await context.rate_limiter.check(request, key, limit)
        if not result["allowed"]:
            raise ApiError(429, "Слишком много загрузок. Повторите через минуту.")


@router.get("/dashboard")
async def dashboard(request: Request):
    context = _context(request)
    token = parse_cookies(request).get(SESSION_COOKIE, "")
    user = await context.store.get_user_by_session(hash_token(token)) if token else None
    if not user:
        raise ApiError(401, "Требуется вход в личный кабинет.")
    projection = await context.store.get_dashboard_projection(user["id"])
    if projection is None:
        raise ApiError(401, "Требуется вход в личный кабинет.")
    return json_response(domain.dashboard(projection, user), request=request)


@router.post("/uploads/stream")
async def upload_stream(request: Request):
    """Raw streaming fallback for local development/staging storage."""
    context, _, user = await _auth_state(request)
    await _check_upload_rate(context, request, user)
    name = request.headers.get("x-upload-name", "").strip()
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip()
    kind = request.headers.get("x-upload-kind", "attachment").strip()
    declared_size = request.headers.get("content-length")
    size = int(declared_size) if declared_size and declared_size.isdigit() else 0
    try:
        uploaded = await UploadService(
            context.store, context.file_storage, context.config
        ).stream(request.stream(), user, name, content_type, kind, size)
    except UploadRuleViolation as exc:
        raise ApiError(exc.status_code, exc.message, exc.code) from exc
    return json_response(uploaded, 201, request)


@router.post("/uploads/intent")
async def upload_intent(request: Request):
    context = _context(request)
    token = parse_cookies(request).get(SESSION_COOKIE, "")
    user = await context.store.get_user_by_session(hash_token(token)) if token else None
    if not user:
        raise ApiError(401, "Требуется вход в личный кабинет.")
    try:
        payload = model_payload(
            UploadIntentPayload.model_validate(
                await read_json(request, context.config.max_json_body)
            )
        )
    except ValueError as exc:
        raise ApiError(422, "Некорректные параметры загрузки.") from exc
    await _check_upload_rate(context, request, user)
    try:
        intent = await UploadService(
            context.store, context.file_storage, context.config
        ).create_intent(payload, user)
    except UploadRuleViolation as exc:
        raise ApiError(exc.status_code, exc.message, exc.code) from exc
    return json_response(intent, 201, request)


@router.post("/uploads/complete")
async def upload_complete(request: Request):
    context = _context(request)
    token = parse_cookies(request).get(SESSION_COOKIE, "")
    user = await context.store.get_user_by_session(hash_token(token)) if token else None
    if not user:
        raise ApiError(401, "Требуется вход в личный кабинет.")
    try:
        payload = model_payload(
            UploadCompletePayload.model_validate(
                await read_json(request, context.config.max_json_body)
            )
        )
    except ValueError as exc:
        raise ApiError(422, "Некорректные параметры завершения загрузки.") from exc
    try:
        uploaded = await UploadService(
            context.store, context.file_storage, context.config
        ).complete(payload, user)
    except UploadRuleViolation as exc:
        raise ApiError(exc.status_code, exc.message, exc.code) from exc
    return json_response(uploaded, 201, request)


@router.post("/achievements")
async def create_achievement(request: Request):
    context, state, user = await _auth_state(request)
    payload = await _validated(
        request, AchievementPayload, context.config.max_json_body
    )
    try:
        record = await ParticipantMutationService(context.store).create_achievement(
            state, user, payload
        )
    except ParticipantRuleViolation as exc:
        raise ApiError(exc.status_code, exc.message, exc.code) from exc
    return json_response({"achievement": record}, 201, request)


@router.delete("/achievements/{achievement_id}")
async def delete_achievement(achievement_id: str, request: Request):
    context, state, user = await _auth_state(request)
    if not domain.portfolio_open(state["settings"]):
        raise ApiError(
            403, "Период заполнения портфолио ещё не начался или уже завершён."
        )
    if not await context.store.delete_achievement_atomic(achievement_id, user["id"]):
        raise ApiError(404, "Достижение не найдено.")
    return json_response({"success": True}, request=request)


@router.patch("/team")
async def update_team(request: Request):
    context, state, user = await _auth_state(request)
    payload = await read_json(request, context.config.max_json_body)
    try:
        team = await ParticipantMutationService(context.store).update_team(
            state, user, payload
        )
    except ParticipantRuleViolation as exc:
        raise ApiError(exc.status_code, exc.message, exc.code) from exc
    result = deepcopy(team)
    result["quota"] = domain.team_quota(state, team)
    return json_response({"team": result}, request=request)


@router.post("/team/invite")
async def rotate_invite(request: Request):
    context, state, user = await _auth_state(request)
    try:
        invite = await ParticipantMutationService(context.store).rotate_invite(
            state, user
        )
    except ParticipantRuleViolation as exc:
        raise ApiError(exc.status_code, exc.message, exc.code) from exc
    return json_response(
        invite,
        request=request,
    )


@router.patch("/team/video")
async def update_video(request: Request):
    context, state, user = await _auth_state(request)
    await _check_upload_rate(context, request, user)
    payload = await read_json(request, context.config.max_upload_body)
    try:
        video_card = await ParticipantMutationService(context.store).update_video(
            state, user, payload
        )
    except ParticipantRuleViolation as exc:
        raise ApiError(exc.status_code, exc.message, exc.code) from exc
    return json_response({"videoCard": video_card}, request=request)
