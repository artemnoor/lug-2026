"""Authenticated notification endpoints."""

from typing import Any
from urllib.parse import unquote

from fastapi import APIRouter, Request

from ..http.errors import ApiError
from ..http.utils import json_response
from ..security.auth import require_user
from ..shared import domain

router = APIRouter(prefix="/api")

async def _auth_state(request: Request) -> tuple[Any, dict, dict]:
    context = request.app.state.context
    state = await context.store.load()
    return context, state, require_user(request, state)


@router.get("/notifications")
async def notifications(request: Request):
    _, state, user = await _auth_state(request)
    return json_response(
        {"notifications": domain.list_notifications(state, user)}, request=request
    )


@router.patch("/notifications/{notification_id}/read")
async def read_notification(notification_id: str, request: Request):
    context, state, user = await _auth_state(request)
    pool = domain.list_notifications(state, user)
    item = next(
        (entry for entry in pool if entry.get("id") == unquote(notification_id)),
        None,
    )
    if not item:
        raise ApiError(404, "Уведомление не найдено.")
    item.setdefault("readBy", [])
    if user["id"] not in item["readBy"]:
        item["readBy"].append(user["id"])
    await context.store.save(state)
    return json_response({"success": True}, request=request)
