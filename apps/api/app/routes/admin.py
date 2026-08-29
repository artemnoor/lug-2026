"""Organizer-only review and quota endpoints."""

from copy import deepcopy
from typing import Any
from urllib.parse import unquote

from fastapi import APIRouter, Request

from ..http.errors import ApiError
from ..http.utils import json_response, read_json
from ..models import ReviewPayload, model_payload
from ..security.auth import require_admin
from ..shared import domain
from ..shared.notifications import notify_user_with_email
from ..shared.projections import admin_snapshot

router = APIRouter(prefix="/api/admin")
REVIEW_FIELDS = {"name", "group", "flag", "description"}


def _context(request: Request):
    return request.app.state.context


async def _admin_state(request: Request) -> tuple[Any, dict, dict]:
    context = _context(request)
    state = await context.store.load()
    return context, state, require_admin(request, state)


async def _review_payload(request: Request, context: Any) -> dict[str, Any]:
    try:
        return model_payload(
            ReviewPayload.model_validate(
                await read_json(request, context.config.max_json_body)
            )
        )
    except ValueError as exc:
        raise ApiError(422, "Некорректный формат решения.") from exc


@router.get("/overview")
async def overview(request: Request):
    _, state, _ = await _admin_state(request)
    return json_response(admin_snapshot(state), request=request)


@router.get("/audit")
async def audit_log(request: Request):
    _, state, _ = await _admin_state(request)
    return json_response({"auditLog": state.get("auditLog", [])[:200]}, request=request)


@router.patch("/teams/{team_id}/quota")
async def update_quota(team_id: str, request: Request):
    context, state, admin = await _admin_state(request)
    team = _find_team(state, team_id)
    payload = await read_json(request, context.config.max_json_body)
    team["isQuotaConfirmed"] = bool(payload.get("confirmed"))
    domain.audit(state, admin["id"], "team.quota_updated", "team", team["id"])
    await context.store.save(state)
    return json_response({"team": _team_result(state, team)}, request=request)


@router.patch("/teams/{team_id}/review")
async def review_team(team_id: str, request: Request):
    context, state, admin = await _admin_state(request)
    team = _find_team(state, team_id)
    payload = await _review_payload(request, context)
    field = payload.get("field")
    if (
        field not in REVIEW_FIELDS
        or payload.get("status") not in domain.REVIEW_STATUSES
    ):
        raise ApiError(422, "Недопустимое решение по данным команды.")
    comment = str(payload.get("comment") or "").strip()
    _require_comment(payload["status"], comment)
    team.setdefault("review", {})[field] = {
        "status": payload["status"],
        "comment": comment,
        "updatedAt": domain.now(),
    }
    members = _members(state, team)
    team["isAdmitted"] = domain.team_is_admitted(state, team, members)
    domain.audit(
        state, admin["id"], f"team.{field}.{payload['status']}", "team", team["id"]
    )
    if team.get("captainId"):
        title = (
            "Проверка поля пройдена"
            if payload["status"] == "approved"
            else "Поле требует исправления"
            if payload["status"] == "rejected"
            else "Проверка поля обновлена"
        )
        await notify_user_with_email(
            context,
            state,
            team["captainId"],
            title,
            comment or "Оргкомитет обновил решение по карточке команды.",
        )
    await context.store.save(state)
    return json_response({"team": _team_result(state, team)}, request=request)


@router.delete("/teams/{team_id}/members/{user_id}")
async def remove_member(team_id: str, user_id: str, request: Request):
    context, state, admin = await _admin_state(request)
    team = _find_team(state, team_id)
    member = next(
        (
            user
            for user in state["users"]
            if user.get("id") == unquote(user_id) and user.get("teamId") == team["id"]
        ),
        None,
    )
    if not member:
        raise ApiError(404, "Участник не найден.")
    if member.get("id") == team.get("captainId") or member.get("role") == "captain":
        raise ApiError(422, "Капитана нельзя удалить из команды.")
    state["users"] = [user for user in state["users"] if user.get("id") != member["id"]]
    state["achievements"] = [
        item for item in state["achievements"] if item.get("userId") != member["id"]
    ]
    state["sessions"] = [
        item for item in state["sessions"] if item.get("userId") != member["id"]
    ]
    team["isAdmitted"] = domain.team_is_admitted(state, team, _members(state, team))
    domain.audit(state, admin["id"], "team.member_removed", "user", member["id"])
    await context.store.save(state)
    return json_response({"success": True}, request=request)


@router.patch("/users/{user_id}/identity")
async def review_identity(user_id: str, request: Request):
    context, state, admin = await _admin_state(request)
    target = next(
        (
            user
            for user in state["users"]
            if user.get("id") == unquote(user_id) and user.get("role") != "admin"
        ),
        None,
    )
    if not target:
        raise ApiError(404, "Пользователь не найден.")
    payload = await _review_payload(request, context)
    if payload.get("status") not in domain.REVIEW_STATUSES:
        raise ApiError(422, "Недопустимый статус проверки личности.")
    comment = str(payload.get("comment") or "").strip()
    _require_comment(payload["status"], comment)
    target.update(
        {
            "identityStatus": payload["status"],
            "identityComment": comment,
            "isIdentityConfirmed": payload["status"] == "approved",
        }
    )
    team = domain.team_for(state, target)
    if team:
        team["isAdmitted"] = domain.team_is_admitted(state, team, _members(state, team))
    domain.audit(
        state, admin["id"], f"identity.{payload['status']}", "user", target["id"]
    )
    title = (
        "Личность подтверждена"
        if payload["status"] == "approved"
        else "Нужно уточнить данные"
        if payload["status"] == "rejected"
        else "Проверка личности обновлена"
    )
    await notify_user_with_email(
        context, state, target["id"], title, comment or "Документы проверены организаторами."
    )
    await context.store.save(state)
    return json_response({"user": domain.public_user(target)}, request=request)


@router.patch("/achievements/{achievement_id}/review")
async def review_achievement(achievement_id: str, request: Request):
    context, state, admin = await _admin_state(request)
    achievement = next(
        (
            item
            for item in state["achievements"]
            if item.get("id") == unquote(achievement_id)
        ),
        None,
    )
    if not achievement:
        raise ApiError(404, "Материал не найден.")
    payload = await _review_payload(request, context)
    status = payload.get("status")
    if status not in domain.REVIEW_STATUSES:
        raise ApiError(422, "Недопустимый статус материала.")
    comment = str(payload.get("comment") or "").strip()
    _require_comment(status, comment)
    points = _number_or_none(payload.get("points"))
    if points is not None and (points < 0 or points > 100):
        raise ApiError(422, "Баллы должны быть числом от 0 до 100.")
    owner = next(
        (
            user
            for user in state["users"]
            if user.get("id") == achievement.get("userId")
        ),
        None,
    )
    if status == "approved" and owner and owner.get("identityStatus") != "approved":
        raise ApiError(422, "Сначала подтвердите личность участника.")
    achievement.update(
        {
            "status": status,
            "reviewComment": comment,
            "reviewStage": payload.get("reviewStage")
            if status == "pending"
            else "approved"
            if status == "approved"
            else "rejected",
            "points": points if status == "approved" else None,
            "reviewedAt": None if status == "pending" else domain.now(),
            "stageUpdatedAt": domain.now(),
        }
    )
    domain.audit(
        state, admin["id"], f"achievement.{status}", "achievement", achievement["id"]
    )
    title = (
        "Материал принят"
        if status == "approved"
        else "Материал отклонён"
        if status == "rejected"
        else "Материал снова на проверке"
    )
    await notify_user_with_email(
        context, state, achievement["userId"], title, comment or "Материал прошёл проверку."
    )
    await context.store.save(state)
    return json_response({"achievement": achievement}, request=request)


@router.patch("/videos/{team_id}/review")
async def review_video(team_id: str, request: Request):
    context, state, admin = await _admin_state(request)
    team = _find_team(state, team_id)
    payload = await _review_payload(request, context)
    status = payload.get("status")
    if status not in domain.REVIEW_STATUSES:
        raise ApiError(422, "Недопустимый статус видео-визитки.")
    video = team.get("videoCard") or {}
    if not video.get("url"):
        raise ApiError(422, "Нельзя принять видео-визитку без загруженного материала.")
    comment = str(payload.get("comment") or "").strip()
    _require_comment(status, comment)
    limits = {"topic": 8, "creativity": 8, "quality": 5, "vfx": 2}
    scores = {}
    for key, limit in limits.items():
        value = _number_or_none(payload.get("criteriaScores", {}).get(key)) or 0
        if value < 0 or value > limit:
            raise ApiError(422, f"Оценка «{key}» должна быть от 0 до {limit}.")
        scores[key] = value
    team["videoCard"] = {
        **video,
        "status": status,
        "score": sum(scores.values()) if status == "approved" else None,
        "criteriaScores": scores,
        "reviewComment": comment,
        "reviewedAt": None if status == "pending" else domain.now(),
    }
    domain.audit(state, admin["id"], f"video.{status}", "team", team["id"])
    title = (
        "Видео-визитка принята"
        if status == "approved"
        else "Видео-визитку нужно уточнить"
        if status == "rejected"
        else "Видео-визитка снова на проверке"
    )
    await notify_user_with_email(
        context,
        state,
        team.get("captainId"),
        title,
        comment or "Откройте раздел «Видео-визитка», чтобы посмотреть статус.",
    )
    await context.store.save(state)
    return json_response({"videoCard": team["videoCard"]}, request=request)


def _find_team(state: dict, team_id: str) -> dict:
    team = next(
        (entry for entry in state["teams"] if entry.get("id") == unquote(team_id)), None
    )
    if not team:
        raise ApiError(404, "Команда не найдена.")
    return team


def _members(state: dict, team: dict) -> list[dict]:
    return [user for user in state["users"] if user.get("teamId") == team.get("id")]


def _team_result(state: dict, team: dict) -> dict:
    result = deepcopy(team)
    members = _members(state, team)
    result.update(
        {
            "quota": domain.team_quota(state, team),
            "isAdmitted": domain.team_is_admitted(state, team, members),
        }
    )
    return result


def _require_comment(status: str, comment: str) -> None:
    if status == "rejected" and not comment:
        raise ApiError(422, "При отклонении обязательно укажите причину.")


def _number_or_none(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise ApiError(422, "Баллы должны быть числом от 0 до 100.")
    if number != number or number in {float("inf"), float("-inf")}:
        raise ApiError(422, "Баллы должны быть числом от 0 до 100.")
    return number
