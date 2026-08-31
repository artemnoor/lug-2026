"""Organizer settings and notification broadcast endpoints."""

from fastapi import APIRouter, Request

from ..application.admin_settings import (
    AdminSettingsRuleViolation,
    AdminSettingsService,
)
from ..http.errors import ApiError
from ..http.utils import json_response, read_json
from . import admin_postgres

router = APIRouter(prefix="/api/admin")


@router.patch("/settings")
async def update_settings(request: Request):
    context = request.app.state.context
    admin = await admin_postgres.admin_user(request)
    payload = await read_json(request, context.config.max_json_body)
    try:
        settings = await AdminSettingsService(context).update(payload, admin["id"])
    except AdminSettingsRuleViolation as error:
        raise ApiError(422, error.message, error.code) from error
    return json_response({"settings": settings}, request=request)


@router.post("/notifications/broadcast")
async def broadcast(request: Request):
    context = request.app.state.context
    admin = await admin_postgres.admin_user(request)
    payload = await read_json(request, context.config.max_json_body)
    try:
        result = await AdminSettingsService(context).broadcast(payload, admin["id"])
    except AdminSettingsRuleViolation as error:
        status = 404 if error.code in {"TEAM_NOT_FOUND", "USER_NOT_FOUND"} else 422
        raise ApiError(status, error.message, error.code) from error
    return json_response(
        {
            "success": True,
            **result,
        },
        201,
        request,
    )
