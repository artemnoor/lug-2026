"""Thin organizer HTTP routes delegating scenarios to application use cases."""

from typing import Any
from urllib.parse import unquote

from fastapi import APIRouter, Query, Request

from ..application.admin_queries import AdminQueryRuleViolation
from ..application.admin_reviews import AdminRuleViolation
from ..application.errors import PersistenceError
from ..http.errors import ApiError
from ..http.utils import json_response, read_json
from ..shared.commands import QuotaCommand, ReviewCommand
from .admin_http import admin_user, review_payload

router = APIRouter(prefix="/api/admin")


@router.get("/collections/{resource}")
async def collection(
    resource: str,
    request: Request,
    limit: int = Query(50, ge=1, le=100),
    offset: int = Query(0, ge=0),
    query: str = Query("", max_length=120),
    status: str = Query("all", max_length=40),
):
    context = request.app.state.context
    await admin_user(request)
    try:
        result = await context.services.admin_queries.collection(
            resource, limit, offset, query, status
        )
    except AdminQueryRuleViolation as exc:
        raise ApiError(404, exc.message, exc.code) from exc
    return json_response(result, request=request)


@router.get("/overview")
async def overview(request: Request):
    context = request.app.state.context
    await admin_user(request)
    return json_response(
        await context.services.admin_queries.overview(), request=request
    )


@router.get("/audit")
async def audit_log(request: Request):
    await admin_user(request)
    return json_response(
        {"auditLog": await request.app.state.context.services.admin_queries.audit()},
        request=request,
    )


@router.patch("/teams/{team_id}/quota")
async def update_quota(team_id: str, request: Request):
    context = request.app.state.context
    admin = await admin_user(request)
    data = await read_json(request, context.config.max_json_body)
    command = QuotaCommand(unquote(team_id), bool(data.get("confirmed")))
    try:
        snapshot = await context.services.admin_reviews.update_quota(
            command.team_id, command.confirmed, admin["id"]
        )
        if not snapshot:
            raise ApiError(404, "Команда не найдена.")
    except AdminRuleViolation as exc:
        raise ApiError(422, exc.message, exc.code) from exc
    except PersistenceError as exc:
        raise ApiError(exc.status_code, exc.message, exc.code) from exc
    return json_response(
        {"team": context.services.admin_reviews.team_response(snapshot)},
        request=request,
    )


def _review_command(payload: dict[str, Any]) -> ReviewCommand:
    return ReviewCommand(
        status=payload.get("status", ""),
        field=payload.get("field", ""),
        comment=str(payload.get("comment") or "").strip(),
        points=payload.get("points"),
        review_stage=str(payload.get("reviewStage") or "received"),
        criteria_scores=dict(payload.get("criteriaScores") or {}),
    )


@router.patch("/teams/{team_id}/review")
async def review_team(team_id: str, request: Request):
    context = request.app.state.context
    admin = await admin_user(request)
    command = _review_command(await review_payload(request))
    try:
        snapshot = await context.services.admin_reviews.review_team(
            unquote(team_id), command, admin["id"]
        )
    except AdminRuleViolation as exc:
        raise ApiError(422, exc.message, exc.code) from exc
    except PersistenceError as exc:
        raise ApiError(exc.status_code, exc.message, exc.code) from exc
    return json_response(
        {"team": context.services.admin_reviews.team_response(snapshot)},
        request=request,
    )


@router.delete("/teams/{team_id}/members/{user_id}")
async def remove_member(team_id: str, user_id: str, request: Request):
    context = request.app.state.context
    admin = await admin_user(request)
    try:
        await context.services.admin_reviews.remove_member(
            unquote(team_id), unquote(user_id), admin["id"]
        )
    except AdminRuleViolation as error:
        status = {
            "TEAM_NOT_FOUND": 404,
            "MEMBER_NOT_FOUND": 404,
            "CAPTAIN_CANNOT_BE_REMOVED": 422,
            "MEMBER_REMOVAL_CONFLICT": 409,
        }.get(error.code, 422)
        raise ApiError(status, error.message, error.code) from error
    return json_response({"success": True}, request=request)


@router.patch("/users/{user_id}/identity")
async def review_identity(user_id: str, request: Request):
    context = request.app.state.context
    admin = await admin_user(request)
    command = _review_command(await review_payload(request))
    try:
        user = await context.services.admin_reviews.review_identity(
            unquote(user_id), command, admin["id"]
        )
    except AdminRuleViolation as exc:
        raise ApiError(422, exc.message, exc.code) from exc
    except PersistenceError as exc:
        raise ApiError(exc.status_code, exc.message, exc.code) from exc
    return json_response(
        {"user": context.services.admin_reviews.public_user(user)}, request=request
    )


@router.patch("/achievements/{achievement_id}/review")
async def review_achievement(achievement_id: str, request: Request):
    context = request.app.state.context
    admin = await admin_user(request)
    command = _review_command(await review_payload(request))
    try:
        achievement = await context.services.admin_reviews.review_achievement(
            unquote(achievement_id), command, admin["id"]
        )
    except AdminRuleViolation as exc:
        raise ApiError(422, exc.message, exc.code) from exc
    except PersistenceError as exc:
        raise ApiError(exc.status_code, exc.message, exc.code) from exc
    return json_response({"achievement": achievement}, request=request)


@router.patch("/videos/{team_id}/review")
async def review_video(team_id: str, request: Request):
    context = request.app.state.context
    admin = await admin_user(request)
    command = _review_command(await review_payload(request))
    try:
        video = await context.services.admin_reviews.review_video(
            unquote(team_id), command, admin["id"]
        )
    except AdminRuleViolation as exc:
        raise ApiError(422, exc.message, exc.code) from exc
    except PersistenceError as exc:
        raise ApiError(exc.status_code, exc.message, exc.code) from exc
    return json_response({"videoCard": video}, request=request)
