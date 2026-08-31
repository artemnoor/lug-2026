"""Email-code password recovery endpoints."""

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Request

from ..http.errors import ApiError
from ..http.utils import json_response, read_json
from ..infrastructure.persistence_errors import PersistenceError
from ..models import PasswordResetPayload, PasswordResetRequestPayload, model_payload
from ..security.auth import (
    hash_token,
    password_hash_async,
    verification_code,
    verification_code_hash,
)
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
    email = domain.normalize_email(payload.get("email"))
    if not domain.valid_email(email):
        raise ApiError(422, "Укажите корректный адрес электронной почты.")
    _not_limited(
        await context.rate_limiter.check(
            request, f"password-reset-account-{hash_token(email)[:24]}", 5
        )
    )
    user = await context.store.get_user_by_email(email)
    if not user or user.get("emailVerified") is not True:
        return _reset_response(request)
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    code = verification_code()
    expires_minutes = max(1, context.config.email_verification_ttl_ms // 60_000)
    reset = {
        "id": str(uuid4()),
        "email": email,
        "codeHash": verification_code_hash(
            code, context.config.email_verification_secret
        ),
        "attempts": 0,
        "lastSentAtMs": now_ms,
        "expiresAtMs": now_ms + context.config.email_verification_ttl_ms,
        "createdAt": domain.now(),
    }
    queued = await context.store.create_password_reset_atomic(
        email,
        reset,
        {"code": code, "expiresMinutes": expires_minutes},
        now_ms,
        context.config.email_verification_cooldown_ms,
    )
    if queued and not context.store.queues_email:
        await context.email_service.send_password_reset_code(
            email, code, expires_minutes
        )
    return _reset_response(request)


@router.post("/auth/reset-password")
async def reset_password(request: Request):
    context = _context(request)
    _not_limited(await context.rate_limiter.check(request, "password-reset-verify", 15))
    payload = await _validated(
        request, PasswordResetPayload, context.config.max_json_body
    )
    email = domain.normalize_email(payload.get("email"))
    if not domain.valid_email(email):
        raise ApiError(422, "Укажите корректный адрес электронной почты.")
    if not domain.strong_password(payload.get("password")):
        raise ApiError(
            422,
            "Пароль должен содержать минимум 8 символов, строчную и прописную букву, цифру и спецсимвол.",
        )
    _not_limited(
        await context.rate_limiter.check(
            request, f"password-reset-verify-account-{hash_token(email)[:24]}", 10
        )
    )
    expected = verification_code_hash(
        payload.get("code", ""), context.config.email_verification_secret
    )
    try:
        await context.store.reset_password_atomic(
            email,
            expected,
            await password_hash_async(payload.get("password", "")),
            context.config.email_verification_max_attempts,
        )
    except PersistenceError as exc:
        raise ApiError(exc.status_code, exc.message, exc.code) from exc
    return json_response(
        {"success": True, "message": "Пароль изменён. Теперь можно войти."},
        request=request,
    )
