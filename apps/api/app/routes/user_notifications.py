"""Authenticated notification endpoints."""

from urllib.parse import unquote

from fastapi import APIRouter, Request

from ..http.errors import ApiError
from ..http.utils import json_response
from ..security.auth import SESSION_COOKIE, hash_token, parse_cookies

router = APIRouter(prefix="/api")


async def _auth_user(request: Request) -> tuple[object, dict]:
    context = request.app.state.context
    token = parse_cookies(request).get(SESSION_COOKIE, "")
    user = (
        await context.repositories.sessions.get_user_by_session(hash_token(token))
        if token
        else None
    )
    if not user:
        raise ApiError(401, "Требуется вход в личный кабинет.")
    return context, user


@router.get("/notifications")
async def notifications(request: Request):
    context, user = await _auth_user(request)
    return json_response(
        {
            "notifications": await context.repositories.notifications.get_user_notifications(
                user["id"]
            )
        },
        request=request,
    )


@router.patch("/notifications/{notification_id}/read")
async def read_notification(notification_id: str, request: Request):
    context, user = await _auth_user(request)
    if not await context.repositories.notifications.mark_notification_read_atomic(
        unquote(notification_id), user["id"]
    ):
        raise ApiError(404, "Уведомление не найдено.")
    return json_response({"success": True}, request=request)
