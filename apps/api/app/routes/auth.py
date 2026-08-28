"""Public settings, session and login endpoints."""

from datetime import datetime, timezone
from typing import Any
from urllib.parse import unquote

from fastapi import APIRouter, Request

from ..http.errors import ApiError
from ..http.utils import json_response, read_json, set_session_cookie
from ..models import LoginPayload, model_payload
from ..security.auth import (
    SESSION_COOKIE,
    current_user,
    hash_token,
    new_session,
    parse_cookies,
    password_matches,
    remove_session,
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
    state = await _context(request).store.load()
    return json_response({"settings": state["settings"]}, request=request)


@router.get("/results")
async def results(request: Request):
    state = await _context(request).store.load()
    published = datetime.now(timezone.utc).timestamp() * 1000 >= domain.timestamp(
        state["settings"].get("resultsStart")
    )
    teams = []
    if published:
        users_by_team: dict[str, list[dict]] = {}
        achievements_by_user: dict[str, list[dict]] = {}
        for user in state["users"]:
            users_by_team.setdefault(user.get("teamId"), []).append(user)
        for achievement in state["achievements"]:
            achievements_by_user.setdefault(achievement.get("userId"), []).append(
                achievement
            )
        for team in state["teams"]:
            members = users_by_team.get(team.get("id"), [])
            if not domain.team_is_admitted(state, team, members):
                continue
            member_ids = {member.get("id") for member in members}
            achievement_points = sum(
                item.get("points") or 0
                for member_id in member_ids
                for item in achievements_by_user.get(member_id, [])
                if item.get("status") == "approved"
            )
            video_points = (
                (team.get("videoCard") or {}).get("score") or 0
                if (team.get("videoCard") or {}).get("status") == "approved"
                else 0
            )
            teams.append(
                {
                    "id": team.get("id"),
                    "name": team.get("name"),
                    "group": team.get("group"),
                    "score": achievement_points + video_points,
                    "admitted": True,
                }
            )
        teams.sort(key=lambda item: (-item["score"], item["name"] or ""))
    return json_response(
        {
            "published": published,
            "availableFrom": state["settings"].get("resultsStart"),
            "teams": teams,
        },
        request=request,
    )


@router.get("/session")
async def session(request: Request):
    state = await _context(request).store.load()
    authenticated = current_user(request, state)
    user = domain.public_user(authenticated) if authenticated else None
    return json_response({"user": user}, request=request)


@router.post("/auth/logout")
async def logout(request: Request):
    context = _context(request)
    state = await context.store.load()
    if parse_cookies(request).get(SESSION_COOKIE):
        remove_session(state, request)
        await context.store.save(state)
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
    state = await context.store.load()
    user = next(
        (
            entry
            for entry in state["users"]
            if domain.normalize_email(entry.get("email")) == email
        ),
        None,
    )
    if not user or not user.get("emailVerified"):
        raise ApiError(401, "Неверный адрес электронной почты или пароль.")
    if not password_matches(
        payload.get("password", ""), user.get("passwordHash", "")
    ):
        raise ApiError(401, "Неверный адрес электронной почты или пароль.")
    token = new_session(state, user, context.config.session_ttl_ms)
    domain.audit(state, user["id"], "auth.login", "user", user["id"])
    await context.store.save(state)
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
    state = await context.store.load()
    team = next(
        (entry for entry in state["teams"] if entry.get("inviteCode") == normalized),
        None,
    )
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
