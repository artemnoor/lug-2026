"""Email-code password recovery endpoints."""

from typing import Any

from fastapi import APIRouter, Request

from ..application.errors import PersistenceError
from ..application.password_reset import PasswordResetRuleViolation
from ..http.errors import ApiError
from ..http.utils import json_response, read_json
from ..models import PasswordResetPayload, PasswordResetRequestPayload, model_payload
from ..security.auth import hash_token

router = APIRouter(prefix="/api")


def _context(request: Request):
    return request.app.state.context


async def _validated(request: Request, model: type, limit: int) -> dict[str, Any]:
    payload = await read_json(request, limit)
    try:
        return model_payload(model.model_validate(payload))
    except ValueError as exc:
        raise ApiError(422, "Некорректный формат запроса.") from exc


def _not_limited(result: dict[str, Any]) -> None:
    if not result["allowed"]:
        raise ApiError(429, "Слишком много попыток. Повторите позже.")


def _reset_response(request: Request):
    return json_response(
        {
            "success": True,
            "message": "Если этот адрес зарегистрирован, мы отправили код восстановления. Проверьте входящие и папку «Спам».",
        },
        202,
        request,
    )


@router.post("/auth/request-password-reset")
async def request_password_reset(request: Request):
    context = _context(request)
    _not_limited(await context.rate_limiter.check(request, "password-reset", 8))
    payload = await _validated(
        request, PasswordResetRequestPayload, context.config.max_json_body
    )
    email = payload.get("email", "")
    _not_limited(
        await context.rate_limiter.check(
            request, f"password-reset-account-{hash_token(email)[:24]}", 5
        )
    )
    try:
        await context.services.password_reset.request(email)
    except PasswordResetRuleViolation as exc:
        raise ApiError(exc.status_code, exc.message, exc.code) from exc
    return _reset_response(request)


@router.post("/auth/reset-password")
async def reset_password(request: Request):
    context = _context(request)
    _not_limited(await context.rate_limiter.check(request, "password-reset-verify", 15))
    payload = await _validated(
        request, PasswordResetPayload, context.config.max_json_body
    )
    email = payload.get("email", "")
    _not_limited(
        await context.rate_limiter.check(
            request, f"password-reset-verify-account-{hash_token(email)[:24]}", 10
        )
    )
    try:
        await context.services.password_reset.reset(
            email, payload.get("code", ""), payload.get("password", "")
        )
    except PasswordResetRuleViolation as exc:
        raise ApiError(exc.status_code, exc.message, exc.code) from exc
    except PersistenceError as exc:
        raise ApiError(exc.status_code, exc.message, exc.code) from exc
    return json_response(
        {"success": True, "message": "Пароль изменён. Теперь можно войти."},
        request=request,
    )
