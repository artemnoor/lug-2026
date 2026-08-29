"""Email-code password recovery endpoints."""

from datetime import datetime, timezone
from hmac import compare_digest
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Request

from ..http.errors import ApiError
from ..http.utils import json_response, read_json
from ..models import (
    PasswordResetPayload,
    PasswordResetRequestPayload,
    model_payload,
)
from ..security.auth import (
    hash_token,
    password_hash,
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
        raise ApiError(429, "Слишком много попыток. Повторите через минуту.")


def _reset_for_email(state: dict, email: str) -> dict | None:
    return next(
        (item for item in state.get("passwordResets", []) if domain.normalize_email(item.get("email")) == email),
        None,
    )


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
    payload = await _validated(request, PasswordResetRequestPayload, context.config.max_json_body)
    email = domain.normalize_email(payload.get("email"))
    if not domain.valid_email(email):
        raise ApiError(422, "Укажите корректный адрес электронной почты.")
    _not_limited(await context.rate_limiter.check(request, f"password-reset-account-{hash_token(email)[:24]}", 5))
    state = await context.store.load()
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    state["passwordResets"] = [item for item in state.get("passwordResets", []) if int(item.get("expiresAtMs", 0)) > now_ms]
    user = next(
        (entry for entry in state.get("users", []) if domain.normalize_email(entry.get("email")) == email and entry.get("emailVerified") is True),
        None,
    )
    if not user:
        return _reset_response(request)
    existing = _reset_for_email(state, email)
    if existing and now_ms - int(existing.get("lastSentAtMs", 0)) < context.config.email_verification_cooldown_ms:
        return _reset_response(request)
    code = verification_code()
    reset = {
        "id": existing.get("id") if existing else str(uuid4()),
        "email": email,
        "codeHash": verification_code_hash(code, context.config.email_verification_secret),
        "attempts": 0,
        "lastSentAtMs": now_ms,
        "expiresAtMs": now_ms + context.config.email_verification_ttl_ms,
        "createdAt": domain.now(),
    }
    await context.email_service.send_password_reset_code(email, code, max(1, context.config.email_verification_ttl_ms // 60_000))
    state["passwordResets"] = [item for item in state.get("passwordResets", []) if domain.normalize_email(item.get("email")) != email]
    state["passwordResets"].append(reset)
    await context.store.save(state)
    return _reset_response(request)


@router.post("/auth/reset-password")
async def reset_password(request: Request):
    context = _context(request)
    _not_limited(await context.rate_limiter.check(request, "password-reset-verify", 15))
    payload = await _validated(request, PasswordResetPayload, context.config.max_json_body)
    email = domain.normalize_email(payload.get("email"))
    if not domain.valid_email(email):
        raise ApiError(422, "Укажите корректный адрес электронной почты.")
    if not domain.strong_password(payload.get("password")):
        raise ApiError(422, "Пароль должен содержать минимум 8 символов, строчную и прописную букву, цифру и спецсимвол.")
    _not_limited(await context.rate_limiter.check(request, f"password-reset-verify-account-{hash_token(email)[:24]}", 10))
    state = await context.store.load()
    reset = _reset_for_email(state, email)
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    invalid_message = "Код восстановления недействителен или истёк. Запросите новый код."
    if not reset or int(reset.get("expiresAtMs", 0)) <= now_ms:
        state["passwordResets"] = [item for item in state.get("passwordResets", []) if item is not reset]
        await context.store.save(state)
        raise ApiError(422, invalid_message)
    if int(reset.get("attempts", 0)) >= context.config.email_verification_max_attempts:
        state["passwordResets"] = [item for item in state.get("passwordResets", []) if item is not reset]
        await context.store.save(state)
        raise ApiError(422, "Лимит попыток исчерпан. Запросите новый код восстановления.")
    expected = verification_code_hash(payload.get("code", ""), context.config.email_verification_secret)
    if not compare_digest(expected, str(reset.get("codeHash") or "")):
        reset["attempts"] = int(reset.get("attempts", 0)) + 1
        await context.store.save(state)
        raise ApiError(422, invalid_message)
    user = next(
        (entry for entry in state.get("users", []) if domain.normalize_email(entry.get("email")) == email and entry.get("emailVerified") is True),
        None,
    )
    if not user:
        raise ApiError(422, invalid_message)
    user["passwordHash"] = password_hash(payload.get("password", ""))
    state["passwordResets"] = [item for item in state.get("passwordResets", []) if item is not reset]
    state["sessions"] = [session for session in state.get("sessions", []) if session.get("userId") != user.get("id")]
    domain.audit(state, user["id"], "auth.password_reset", "user", user["id"])
    await context.store.save(state)
    return json_response({"success": True, "message": "Пароль изменён. Теперь можно войти."}, request=request)
