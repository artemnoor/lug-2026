"""Thin organizer routes delegating validation and mutations to commands."""

from fastapi import APIRouter, Query, Request

from ..application.admin_reviews import AdminReviewService, AdminRuleViolation
from ..http.errors import ApiError
from ..http.utils import json_response
from . import admin_postgres

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
    if resource not in {"users", "teams", "achievements"}:
        raise ApiError(404, "Раздел админ-панели не найден.")
    await admin_postgres.admin_user(request)
    result = await request.app.state.context.store.get_admin_collection(
        resource, limit, offset, query, status
    )
    return json_response(result, request=request)


@router.get("/overview")
async def overview(request: Request):
    context = request.app.state.context
    await admin_postgres.admin_user(request)
    return json_response(await context.store.get_admin_overview(), request=request)


@router.get("/audit")
async def audit_log(request: Request):
    await admin_postgres.admin_user(request)
    return json_response(
        {"auditLog": await request.app.state.context.store.get_audit_log()},
        request=request,
    )


@router.patch("/teams/{team_id}/quota")
async def update_quota(team_id: str, request: Request):
    return await admin_postgres.update_quota(request, team_id)


@router.patch("/teams/{team_id}/review")
async def review_team(team_id: str, request: Request):
    return await admin_postgres.review_team(request, team_id)


@router.delete("/teams/{team_id}/members/{user_id}")
async def remove_member(team_id: str, user_id: str, request: Request):
    context = request.app.state.context
    admin = await admin_postgres.admin_user(request)
    try:
        await AdminReviewService(context.store).remove_member(
            team_id, user_id, admin["id"]
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
    return await admin_postgres.review_identity(request, user_id)


@router.patch("/achievements/{achievement_id}/review")
async def review_achievement(achievement_id: str, request: Request):
    return await admin_postgres.review_achievement(request, achievement_id)


@router.patch("/videos/{team_id}/review")
async def review_video(team_id: str, request: Request):
    return await admin_postgres.review_video(request, team_id)
