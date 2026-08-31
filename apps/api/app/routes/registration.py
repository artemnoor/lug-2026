"""Team registration, email verification and invite joining endpoints."""

import secrets
from typing import Any

from fastapi import APIRouter, Request

from ..application.errors import PersistenceError
from ..application.registration import RegistrationRuleViolation
from ..application.uploads import UploadRuleViolation
from ..http.errors import ApiError
from ..http.utils import json_response, read_json, set_session_cookie
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
    verify_registration_upload_claim,
)
from ..shared.commands import RegistrationCommand

router = APIRouter(prefix="/api")


def _context(request: Request):
    return request.app.state.context


async def _validated(request: Request, model: type, limit: int) -> dict[str, Any]:
    payload = await read_json(request, limit)
    try:
        return model_payload(model.model_validate(payload))
    except ValueError as exc:
        raise ApiError(422, "Некорректный формат запроса.") from exc


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
        uploaded = await context.services.uploads.registration_stream(
            request.stream(), name, content_type, owner
        )
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
        intent = await context.services.uploads.registration_intent(payload, owner)
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
        uploaded = await context.services.uploads.registration_complete(
            payload, claim["owner"]
        )
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
    payload = await _validated(request, RegisterTeamPayload, 12 * 1024 * 1024)
    try:
        pending = await context.services.registration.begin(
            RegistrationCommand(payload), "team"
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
    payload = await _validated(request, JoinTeamPayload, 12 * 1024 * 1024)
    try:
        pending = await context.services.registration.begin(
            RegistrationCommand(payload), "participant"
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
    try:
        user, token = await context.services.registration.verify_email(
            payload.get("verificationId"), payload.get("code", "")
        )
    except PersistenceError as exc:
        raise ApiError(exc.status_code, exc.message, exc.code) from exc
    response = json_response(
        {"user": context.services.registration.public_user(user)}, 201, request
    )
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
    try:
        pending = await context.services.registration.resend_email_code(
            payload.get("verificationId")
        )
    except RegistrationRuleViolation as exc:
        raise ApiError(exc.status_code, exc.message, exc.code) from exc
    except PersistenceError as exc:
        raise ApiError(exc.status_code, exc.message, exc.code) from exc
    return json_response(_pending_response(pending), 200, request)
