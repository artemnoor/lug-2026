"""Authenticated participant profile endpoint."""

from typing import Any

from fastapi import APIRouter, Request

from ..application.profile import ProfileRuleViolation, ProfileService
from ..http.errors import ApiError
from ..http.utils import json_response, read_json
from ..security.auth import SESSION_COOKIE, hash_token, parse_cookies
from ..shared import domain

router = APIRouter(prefix="/api")


def _context(request: Request):
    return request.app.state.context


async def _auth_state(request: Request) -> tuple[Any, dict, dict]:
    context = _context(request)
    token = parse_cookies(request).get(SESSION_COOKIE, "")
    user = await context.store.get_user_by_session(hash_token(token)) if token else None
    if not user:
        raise ApiError(401, "Требуется вход в личный кабинет.")
    state = {"uploads": await context.store.get_user_uploads(user["id"]), "users": []}
    return context, state, user


async def _check_upload_rate(context: Any, request: Request, user: dict) -> None:
    for key, limit in (
        ("upload", context.config.upload_rate_limit_per_ip),
        (f"upload-user-{user['id']}", context.config.upload_rate_limit_per_user),
    ):
        result = await context.rate_limiter.check(request, key, limit)
        if not result["allowed"]:
            raise ApiError(429, "Слишком много загрузок. Повторите через минуту.")


@router.patch("/me")
async def update_profile(request: Request):
    context, state, user = await _auth_state(request)
    payload = await read_json(request, context.config.max_upload_body)
    if (
        isinstance(payload.get("studentCardFile"), str)
        and payload["studentCardFile"].strip()
    ):
        await _check_upload_rate(context, request, user)
    try:
        saved_user = await ProfileService(context.store, context.file_storage).update(
            state, user, payload
        )
    except ProfileRuleViolation as exc:
        raise ApiError(exc.status_code, exc.message, exc.code) from exc
    return json_response({"user": domain.public_user(saved_user)}, request=request)
