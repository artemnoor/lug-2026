"""HTTP-only helpers shared by organizer routes."""

from typing import Any

from fastapi import Request

from ..http.errors import ApiError
from ..http.utils import read_json
from ..models import ReviewPayload, model_payload
from ..security.auth import SESSION_COOKIE, hash_token, parse_cookies


async def admin_user(request: Request) -> dict:
    context = request.app.state.context
    token = parse_cookies(request).get(SESSION_COOKIE, "")
    user = (
        await context.repositories.sessions.get_user_by_session(hash_token(token))
        if token
        else None
    )
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
