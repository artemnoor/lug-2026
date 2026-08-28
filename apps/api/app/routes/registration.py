"""Team registration, email verification and invite joining endpoints."""

from datetime import datetime, timezone
from hmac import compare_digest
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Request

from ..http.errors import ApiError
from ..http.utils import json_response, read_json, set_session_cookie
from ..models import (
    EmailVerificationPayload,
    JoinTeamPayload,
    RegisterTeamPayload,
    ResendEmailVerificationPayload,
    model_payload,
)
from ..security.auth import (
    new_session,
    password_hash,
    verification_code,
    verification_code_hash,
)
from ..shared import domain
from .registration_helpers import active_team, commit_pending, validate_registration

router = APIRouter(prefix="/api")


def _context(request: Request):
    return request.app.state.context


async def _validated(request: Request, model: type, limit: int) -> dict[str, Any]:
    payload = await read_json(request, limit)
    try:
        return model_payload(model.model_validate(payload))
    except ValueError as exc:
        raise ApiError(422, "Некорректный формат запроса.") from exc


def _verification_expiry(context) -> tuple[int, str]:
    expires_at_ms = int(datetime.now(timezone.utc).timestamp() * 1000) + context.config.email_verification_ttl_ms
    expires_at = datetime.fromtimestamp(expires_at_ms / 1000, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return expires_at_ms, expires_at


async def _prune_expired(context, state: dict) -> None:
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    active = []
    removed = False
    for item in state.get("emailVerifications", []):
        if int(item.get("expiresAtMs", 0)) > now_ms:
            active.append(item)
            continue
        student_card = item.get("studentCard") or {}
        await context.file_storage.delete(student_card.get("url", ""))
        removed = True
    if removed:
        state["emailVerifications"] = active
        await context.store.save(state)


def _pending_for_email(state: dict, email: str) -> dict | None:
    normalized = domain.normalize_email(email)
    return next(
        (
            item
            for item in state.get("emailVerifications", [])
            if domain.normalize_email(item.get("email")) == normalized
        ),
        None,
    )


def _pending_response(pending: dict) -> dict[str, Any]:
    return {
        "verificationRequired": True,
        "verificationId": pending["id"],
        "email": pending["email"],
        "expiresAt": pending["expiresAt"],
        "message": "Проверьте почту и введите шестизначный код подтверждения.",
    }


async def _create_pending_verification(
    request: Request, state: dict, payload: dict[str, Any], kind: str
) -> dict[str, Any]:
    context = _context(request)
    email = domain.normalize_email(payload.get("email"))
    if _pending_for_email(state, email):
        raise ApiError(409, "На эту почту уже отправлен код. Используйте его или запросите новый.")
    student_card = await context.file_storage.save(
        payload["studentCardFile"], payload.get("studentCardFileName", "student-card")
    )
    expires_at_ms, expires_at = _verification_expiry(context)
    stored_payload = {
        key: value
        for key, value in payload.items()
        if key not in {"password", "studentCardFile"}
    }
    stored_payload["passwordHash"] = password_hash(payload["password"])
    code = verification_code()
    pending = {
        "id": str(uuid4()),
        "kind": kind,
        "email": email,
        "codeHash": verification_code_hash(
            code, context.config.email_verification_secret
        ),
        "attempts": 0,
        "lastSentAtMs": int(datetime.now(timezone.utc).timestamp() * 1000),
        "expiresAtMs": expires_at_ms,
        "expiresAt": expires_at,
        "payload": stored_payload,
        "studentCard": student_card,
        "createdAt": domain.now(),
    }
    try:
        await context.email_service.send_verification_code(
            email,
            code,
            max(1, context.config.email_verification_ttl_ms // 60_000),
        )
    except Exception:
        await context.file_storage.delete(student_card["url"])
        raise
    state.setdefault("emailVerifications", []).append(pending)
    await context.store.save(state)
    return pending


@router.post("/auth/register-team")
async def register_team(request: Request):
    context = _context(request)
    result = await context.rate_limiter.check(request, "register", 5)
    if not result["allowed"]:
        raise ApiError(429, "Слишком много заявок с этого адреса. Повторите позже.")
    state = await context.store.load()
    await _prune_expired(context, state)
    if not domain.registration_open(state["settings"]):
        raise ApiError(403, "Регистрация завершена или ещё не началась.")
    payload = await _validated(request, RegisterTeamPayload, 12 * 1024 * 1024)
    validate_registration(payload, state, is_team=True)
    pending = await _create_pending_verification(request, state, payload, "team")
    return json_response(_pending_response(pending), 202, request)


@router.post("/auth/join-team")
async def join_team(request: Request):
    context = _context(request)
    result = await context.rate_limiter.check(request, "register", 10)
    if not result["allowed"]:
        raise ApiError(429, "Слишком много заявок с этого адреса. Повторите позже.")
    state = await context.store.load()
    await _prune_expired(context, state)
    if not domain.registration_open(state["settings"]):
        raise ApiError(403, "Регистрация завершена или ещё не началась.")
    payload = await _validated(request, JoinTeamPayload, 12 * 1024 * 1024)
    team = active_team(state, payload.get("inviteCode"))
    if not team:
        raise ApiError(404, "Приглашение неактивно.")
    validate_registration(payload, state, is_team=False)
    if sum(user.get("teamId") == team.get("id") for user in state["users"]) >= int(team.get("totalStudentsInGroup") or 0):
        raise ApiError(409, "В команде уже достигнута заявленная вместимость.")
    pending = await _create_pending_verification(request, state, payload, "participant")
    return json_response(_pending_response(pending), 202, request)


@router.post("/auth/verify-email")
async def verify_email(request: Request):
    context = _context(request)
    result = await context.rate_limiter.check(request, "email-verification", 10)
    if not result["allowed"]:
        raise ApiError(429, "Слишком много попыток подтверждения. Повторите позже.")
    payload = await _validated(
        request, EmailVerificationPayload, context.config.max_json_body
    )
    state = await context.store.load()
    await _prune_expired(context, state)
    pending = next(
        (
            item
            for item in state.get("emailVerifications", [])
            if item.get("id") == payload.get("verificationId")
        ),
        None,
    )
    if not pending:
        raise ApiError(404, "Заявка на подтверждение не найдена или уже обработана.")
    if int(pending.get("attempts", 0)) >= context.config.email_verification_max_attempts:
        await _discard_pending(context, state, pending)
        raise ApiError(422, "Лимит попыток исчерпан. Начните регистрацию заново.")
    expected = verification_code_hash(
        payload.get("code", ""), context.config.email_verification_secret
    )
    if not compare_digest(expected, str(pending.get("codeHash") or "")):
        pending["attempts"] = int(pending.get("attempts", 0)) + 1
        await context.store.save(state)
        raise ApiError(422, "Неверный код подтверждения.")
    user = await commit_pending(context, state, pending)
    token = new_session(state, user, context.config.session_ttl_ms)
    await context.store.save(state)
    response = json_response({"user": domain.public_user(user)}, 201, request)
    set_session_cookie(response, token, context.config)
    return response


@router.post("/auth/resend-email-code")
async def resend_email_code(request: Request):
    context = _context(request)
    result = await context.rate_limiter.check(request, "email-verification-resend", 5)
    if not result["allowed"]:
        raise ApiError(429, "Слишком много запросов кода. Повторите позже.")
    payload = await _validated(
        request, ResendEmailVerificationPayload, context.config.max_json_body
    )
    state = await context.store.load()
    await _prune_expired(context, state)
    pending = next(
        (
            item
            for item in state.get("emailVerifications", [])
            if item.get("id") == payload.get("verificationId")
        ),
        None,
    )
    if not pending:
        raise ApiError(404, "Заявка на подтверждение не найдена или уже обработана.")
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    retry_ms = context.config.email_verification_cooldown_ms - (
        now_ms - int(pending.get("lastSentAtMs", 0))
    )
    if retry_ms > 0:
        raise ApiError(429, f"Новый код можно запросить через {max(1, retry_ms // 1000)} сек.")
    old_values = {
        key: pending.get(key)
        for key in ("codeHash", "attempts", "lastSentAtMs", "expiresAtMs", "expiresAt")
    }
    code = verification_code()
    expires_at_ms, expires_at = _verification_expiry(context)
    pending.update(
        {
            "codeHash": verification_code_hash(
                code, context.config.email_verification_secret
            ),
            "attempts": 0,
            "lastSentAtMs": now_ms,
            "expiresAtMs": expires_at_ms,
            "expiresAt": expires_at,
        }
    )
    try:
        await context.email_service.send_verification_code(
            pending["email"],
            code,
            max(1, context.config.email_verification_ttl_ms // 60_000),
        )
    except Exception:
        pending.update(old_values)
        raise
    await context.store.save(state)
    return json_response(_pending_response(pending), 200, request)


async def _discard_pending(context, state: dict, pending: dict) -> None:
    state["emailVerifications"] = [item for item in state.get("emailVerifications", []) if item.get("id") != pending.get("id")]
    student_card = pending.get("studentCard") or {}
    await context.file_storage.delete(student_card.get("url", ""))
    await context.store.save(state)
