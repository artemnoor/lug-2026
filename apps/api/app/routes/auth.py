"""Public settings, session and login endpoints."""

from datetime import datetime, timezone
from typing import Any
from urllib.parse import unquote

from fastapi import APIRouter, Request

from ..application.authentication import InvalidCredentials
from ..http.errors import ApiError
from ..http.utils import (
    json_response,
    public_json_response,
    read_json,
    set_session_cookie,
)
from ..models import LoginPayload, model_payload
from ..security.auth import (
    SESSION_COOKIE,
    hash_token,
    parse_cookies,
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


@router.get("/config")
async def config(request: Request):
    context = _context(request)
    return public_json_response(
        {"settings": await context.repositories.settings.get_settings()}, request
    )


@router.get("/results")
async def results(request: Request):
    return public_json_response(
        await _context(request).repositories.participant_reads.get_public_results(),
        request,
    )


@router.get("/session")
async def session(request: Request):
    context = _context(request)
    token = parse_cookies(request).get(SESSION_COOKIE, "")
    authenticated = (
        await context.repositories.sessions.get_user_by_session(hash_token(token))
        if token
        else None
    )
    user = domain.public_user(authenticated) if authenticated else None
    return json_response({"user": user}, request=request)


async def _session_user(request: Request) -> tuple[dict, str]:
    context = _context(request)
    token = parse_cookies(request).get(SESSION_COOKIE, "")
    token_hash = hash_token(token) if token else ""
    user = (
        await context.repositories.sessions.get_user_by_session(token_hash)
        if token_hash
        else None
    )
    if not user:
        raise ApiError(401, "Требуется вход в личный кабинет.")
    return user, token_hash


@router.get("/sessions")
async def sessions(request: Request):
    user, token_hash = await _session_user(request)
    items = await _context(request).repositories.sessions.list_sessions(
        user["id"], token_hash
    )
    return json_response({"sessions": items}, request=request)


@router.delete("/sessions/others")
async def remove_other_sessions(request: Request):
    user, token_hash = await _session_user(request)
    removed = await _context(
        request
    ).repositories.sessions.remove_other_sessions_atomic(user["id"], token_hash)
    return json_response({"removed": removed}, request=request)


@router.post("/auth/logout")
async def logout(request: Request):
    context = _context(request)
    token = parse_cookies(request).get(SESSION_COOKIE, "")
    if token:
        await context.repositories.sessions.remove_session_atomic(hash_token(token))
    response = json_response({"success": True}, request=request)
    set_session_cookie(response, "", context.config, max_age=0)
    return response


@router.post("/auth/login")
async def login(request: Request):
    context = _context(request)
    _not_limited(await context.rate_limiter.check(request, "auth", 15))
    payload = await _validated(request, LoginPayload, context.config.max_json_body)
    email = domain.normalize_email(payload.get("email"))
    if not domain.valid_email(email):
        raise ApiError(422, "Укажите корректный адрес электронной почты.")
    _not_limited(
        await context.rate_limiter.check(
            request, f"auth-account-{hash_token(email)[:24]}", 10
        )
    )
    try:
        user, token = await context.services.authentication.authenticate(
            email, payload.get("password", "")
        )
    except InvalidCredentials as exc:
        raise ApiError(401, "Неверный адрес электронной почты или пароль.") from exc
    response = json_response({"user": domain.public_user(user)}, request=request)
    set_session_cookie(response, token, context.config)
    return response


@router.get("/invites/{code}")
async def invite(code: str, request: Request):
    context = _context(request)
    _not_limited(await context.rate_limiter.check(request, "invite-lookup", 20))
    normalized = unquote(code).upper()
    if not domain.valid_invite_code(normalized):
        raise ApiError(404, "Приглашение не найдено, отозвано или истекло.")
    team = await context.repositories.teams.get_invite(normalized)
    if (
        not team
        or team.get("inviteStatus") != "active"
        or domain.timestamp(team.get("inviteExpiresAt"))
        < datetime.now(timezone.utc).timestamp() * 1000
    ):
        raise ApiError(404, "Приглашение не найдено, отозвано или истекло.")
    return json_response(
        {
            "team": {
                "name": team.get("name"),
                "group": team.get("group"),
                "inviteExpiresAt": team.get("inviteExpiresAt"),
            }
        },
        request=request,
    )
