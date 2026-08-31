"""Team registration, email verification and invite joining endpoints."""

import secrets
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Request

from ..application.registration import (
    RegistrationRuleViolation,
    RegistrationService,
)
from ..application.uploads import UploadRuleViolation, UploadService
from ..http.errors import ApiError
from ..http.utils import json_response, read_json, set_session_cookie
from ..infrastructure.persistence_errors import PersistenceError
from ..models import (
    EmailVerificationPayload,
    JoinTeamPayload,
    RegisterTeamPayload,
    ResendEmailVerificationPayload,
    UploadCompletePayload,
    UploadIntentPayload,
    model_payload,
)
from ..security.auth import (
    issue_registration_upload_claim,
    verification_code,
    verification_code_hash,
    verify_registration_upload_claim,
)
from ..shared import domain
from .registration_helpers import validate_registration

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
    expires_at_ms = (
        int(datetime.now(timezone.utc).timestamp() * 1000)
        + context.config.email_verification_ttl_ms
    )
    expires_at = (
        datetime.fromtimestamp(expires_at_ms / 1000, timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )
    return expires_at_ms, expires_at


def _pending_response(pending: dict) -> dict[str, Any]:
    return {
        "verificationRequired": True,
        "verificationId": pending["id"],
        "email": pending["email"],
        "expiresAt": pending["expiresAt"],
        "message": "Код отправлен на почту. Проверьте входящие и папку «Спам».",
    }


def _upload_owner(context) -> tuple[str, str]:
    owner = secrets.token_urlsafe(24)
    return owner, issue_registration_upload_claim(
        context.config.email_verification_secret, owner
    )


@router.post("/auth/student-card/stream")
async def registration_card_stream(request: Request):
    context = _context(request)
    result = await context.rate_limiter.check(request, "registration-upload", 10)
    if not result["allowed"]:
        raise ApiError(429, "Слишком много загрузок. Повторите позже.")
    name = request.headers.get("x-upload-name", "").strip()
    content_type = request.headers.get("content-type", "").split(";", 1)[0].strip()
    if not name or not content_type:
        raise ApiError(422, "Не указаны имя и тип файла.")
    owner, _ = _upload_owner(context)
    try:
        uploaded = await UploadService(
            context.store, context.file_storage, context.config
        ).registration_stream(request.stream(), name, content_type, owner)
    except UploadRuleViolation as exc:
        raise ApiError(exc.status_code, exc.message, exc.code) from exc
    token = issue_registration_upload_claim(
        context.config.email_verification_secret, owner, uploaded["url"]
    )
    return json_response({**uploaded, "registrationToken": token}, 201, request)


@router.post("/auth/student-card/intent")
async def registration_card_intent(request: Request):
    context = _context(request)
    result = await context.rate_limiter.check(request, "registration-upload", 10)
    if not result["allowed"]:
        raise ApiError(429, "Слишком много загрузок. Повторите позже.")
    try:
        payload = model_payload(
            UploadIntentPayload.model_validate(
                await read_json(request, context.config.max_json_body)
            )
        )
    except ValueError as exc:
        raise ApiError(422, "Некорректные параметры загрузки.") from exc
    owner, _ = _upload_owner(context)
    try:
        intent = await UploadService(
            context.store, context.file_storage, context.config
        ).registration_intent(payload, owner)
    except UploadRuleViolation as exc:
        raise ApiError(exc.status_code, exc.message, exc.code) from exc
    token = issue_registration_upload_claim(
        context.config.email_verification_secret, owner, key=intent["key"]
    )
    return json_response({**intent, "registrationToken": token}, 201, request)


@router.post("/auth/student-card/complete")
async def registration_card_complete(request: Request):
    context = _context(request)
    result = await context.rate_limiter.check(request, "registration-upload", 10)
    if not result["allowed"]:
        raise ApiError(429, "Слишком много загрузок. Повторите позже.")
    try:
        payload = model_payload(
            UploadCompletePayload.model_validate(
                await read_json(request, context.config.max_json_body)
            )
        )
    except ValueError as exc:
        raise ApiError(422, "Некорректные параметры завершения загрузки.") from exc
    claim = verify_registration_upload_claim(
        payload.get("registrationToken", ""), context.config.email_verification_secret
    )
    if not claim or claim.get("key") != payload["key"]:
        raise ApiError(403, "Временная загрузка документа недействительна или истекла.")
    try:
        uploaded = await UploadService(
            context.store, context.file_storage, context.config
        ).registration_complete(payload, claim["owner"])
    except UploadRuleViolation as exc:
        raise ApiError(exc.status_code, exc.message, exc.code) from exc
    token = issue_registration_upload_claim(
        context.config.email_verification_secret,
        claim["owner"],
        uploaded["url"],
        payload["key"],
    )
    return json_response({**uploaded, "registrationToken": token}, 201, request)


@router.post("/auth/register-team")
async def register_team(request: Request):
    context = _context(request)
    result = await context.rate_limiter.check(request, "register", 5)
    if not result["allowed"]:
        raise ApiError(429, "Слишком много заявок с этого адреса. Повторите позже.")
    settings = await context.store.get_settings()
    state = {"settings": settings, "users": [], "teams": []}
    if not domain.registration_open(settings):
        raise ApiError(403, "Регистрация завершена или ещё не началась.")
    payload = await _validated(request, RegisterTeamPayload, 12 * 1024 * 1024)
    existing_user = await context.store.get_user_by_email(
        domain.normalize_email(payload.get("email"))
    )
    existing_team = await context.store.get_team_by_group(payload.get("group"))
    state["users"] = [existing_user] if existing_user else []
    state["teams"] = [existing_team] if existing_team else []
    validate_registration(payload, state, is_team=True)
    try:
        pending = await RegistrationService(context).create_pending_verification(
            payload, "team"
        )
    except RegistrationRuleViolation as exc:
        raise ApiError(exc.status_code, exc.message, exc.code) from exc
    return json_response(_pending_response(pending), 202, request)


@router.post("/auth/join-team")
async def join_team(request: Request):
    context = _context(request)
    result = await context.rate_limiter.check(request, "register", 10)
    if not result["allowed"]:
        raise ApiError(429, "Слишком много заявок с этого адреса. Повторите позже.")
    settings = await context.store.get_settings()
    state = {"settings": settings, "users": [], "teams": []}
    if not domain.registration_open(settings):
        raise ApiError(403, "Регистрация завершена или ещё не началась.")
    payload = await _validated(request, JoinTeamPayload, 12 * 1024 * 1024)
    team = await context.store.get_invite(payload.get("inviteCode"))
    if not team:
        raise ApiError(404, "Приглашение неактивно.")
    snapshot = await context.store.get_team_snapshot(team["id"])
    state["teams"] = [team]
    state["users"] = snapshot[1] if snapshot else []
    existing_user = await context.store.get_user_by_email(
        domain.normalize_email(payload.get("email"))
    )
    if existing_user:
        state["users"].append(existing_user)
    validate_registration(payload, state, is_team=False)
    if sum(user.get("teamId") == team.get("id") for user in state["users"]) >= int(
        team.get("totalStudentsInGroup") or 0
    ):
        raise ApiError(
            409,
            "В команде уже достигнута заявленная вместимость.",
            "TEAM_CAPACITY_REACHED",
        )
    try:
        pending = await RegistrationService(context).create_pending_verification(
            payload, "participant"
        )
    except RegistrationRuleViolation as exc:
        raise ApiError(exc.status_code, exc.message, exc.code) from exc
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
    expected = verification_code_hash(
        payload.get("code", ""), context.config.email_verification_secret
    )
    try:
        user, token = await context.store.commit_pending_atomic(
            payload.get("verificationId"),
            context.config.session_ttl_ms,
            expected,
            context.config.email_verification_max_attempts,
        )
    except PersistenceError as exc:
        raise ApiError(exc.status_code, exc.message, exc.code) from exc
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
    pending = await context.store.get_email_verification(payload.get("verificationId"))
    if not pending:
        raise ApiError(404, "Заявка на подтверждение не найдена или уже обработана.")
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    retry_ms = context.config.email_verification_cooldown_ms - (
        now_ms - int(pending.get("lastSentAtMs", 0))
    )
    if retry_ms > 0:
        raise ApiError(
            429, f"Новый код можно запросить через {max(1, retry_ms // 1000)} сек."
        )
    code = verification_code()
    expires_at_ms, expires_at = _verification_expiry(context)
    try:
        pending = await context.store.resend_email_verification_atomic(
            pending["id"],
            {
                "codeHash": verification_code_hash(
                    code, context.config.email_verification_secret
                ),
                "attempts": 0,
                "lastSentAtMs": now_ms,
                "expiresAtMs": expires_at_ms,
                "expiresAt": expires_at,
            },
            {
                "code": code,
                "expiresMinutes": max(
                    1, context.config.email_verification_ttl_ms // 60_000
                ),
            },
            now_ms,
            context.config.email_verification_cooldown_ms,
        )
    except PersistenceError as exc:
        raise ApiError(exc.status_code, exc.message, exc.code) from exc
    if not context.store.queues_email:
        await context.email_service.send_verification_code(
            pending["email"],
            code,
            max(1, context.config.email_verification_ttl_ms // 60_000),
        )
    return json_response(_pending_response(pending), 200, request)
