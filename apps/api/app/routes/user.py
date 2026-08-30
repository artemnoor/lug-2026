"""Authenticated participant and captain endpoints."""

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Request

from ..http.errors import ApiError
from ..http.utils import json_response, read_json
from ..models import AchievementPayload, UploadPayload, model_payload
from ..security.auth import SESSION_COOKIE, hash_token, parse_cookies, require_user
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


async def _auth_state(request: Request) -> tuple[Any, dict, dict]:
    context = _context(request)
    state = await context.store.load()
    return context, state, require_user(request, state)


async def _check_upload_rate(context: Any, request: Request, user: dict) -> None:
    checks = (
        ("upload", context.config.upload_rate_limit_per_ip),
        (f"upload-user-{user['id']}", context.config.upload_rate_limit_per_user),
    )
    for key, limit in checks:
        result = await context.rate_limiter.check(request, key, limit)
        if not result["allowed"]:
            raise ApiError(429, "Слишком много загрузок. Повторите через минуту.")


@router.get("/dashboard")
async def dashboard(request: Request):
    context = _context(request)
    if hasattr(context.store, "get_user_by_session"):
        token = parse_cookies(request).get(SESSION_COOKIE, "")
        user = await context.store.get_user_by_session(hash_token(token)) if token else None
        if not user:
            raise ApiError(401, "Требуется вход в личный кабинет.")
        state = await context.store.get_dashboard_state(user["id"])
        if state is None:
            raise ApiError(401, "Требуется вход в личный кабинет.")
        return json_response(domain.dashboard(state, user), request=request)
    _, state, user = await _auth_state(request)
    return json_response(domain.dashboard(state, user), request=request)


@router.post("/uploads")
async def upload(request: Request):
    context, state, user = await _auth_state(request)
    await _check_upload_rate(context, request, user)
    payload = await _validated(request, UploadPayload, 8 * 1024 * 1024)
    estimated_size = context.file_storage.estimate_size(payload.get("data", ""))
    if not domain.upload_quota_available(
        state,
        user["id"],
        context.config.max_uploads_per_user,
        context.config.max_upload_bytes_per_user,
        estimated_size,
    ):
        raise ApiError(413, "Достигнут лимит количества или общего размера файлов.")
    uploaded = await context.file_storage.save(
        payload.get("data", ""), payload.get("name", "")
    )
    state["uploads"].append(
        {
            "url": uploaded["url"],
            "userId": user["id"],
            "kind": "attachment",
            "size": uploaded["size"],
            "createdAt": domain.now(),
        }
    )
    domain.audit(state, user["id"], "file.uploaded", "file", uploaded["url"])
    await context.store.save(state)
    return json_response(uploaded, 201, request)


@router.post("/achievements")
async def create_achievement(request: Request):
    context, state, user = await _auth_state(request)
    if not domain.portfolio_open(state["settings"]):
        raise ApiError(
            403, "Период заполнения портфолио ещё не начался или уже завершён."
        )
    payload = await _validated(
        request, AchievementPayload, context.config.max_json_body
    )
    if (
        not payload.get("title")
        or payload.get("direction") not in domain.ALLOWED_DIRECTIONS
        or not payload.get("category")
        or not payload.get("fileUrl")
    ):
        raise ApiError(
            422,
            "Выберите направление, укажите название и загрузите подтверждающий документ.",
        )
    if not domain.owns_upload(state, user, payload["fileUrl"]):
        raise ApiError(403, "Сначала загрузите подтверждающий документ через форму.")
    record = {
        "id": str(uuid4()),
        "userId": user["id"],
        "direction": payload["direction"],
        "category": payload["category"],
        "title": payload["title"].strip(),
        "details": str(payload.get("details") or "").strip(),
        "fileUrl": payload["fileUrl"],
        "fileName": payload.get("fileName") or "Документ",
        "status": "pending",
        "reviewStage": "received",
        "reviewComment": "",
        "stageUpdatedAt": domain.now(),
        "reviewedAt": None,
        "points": None,
        "createdAt": domain.now(),
    }
    state["achievements"].insert(0, record)
    domain.audit(state, user["id"], "achievement.created", "achievement", record["id"])
    await context.store.save(state)
    return json_response({"achievement": record}, 201, request)


@router.delete("/achievements/{achievement_id}")
async def delete_achievement(achievement_id: str, request: Request):
    context, state, user = await _auth_state(request)
    index = next(
        (
            index
            for index, item in enumerate(state["achievements"])
            if item.get("id") == achievement_id and item.get("userId") == user["id"]
        ),
        -1,
    )
    if index < 0:
        raise ApiError(404, "Достижение не найдено.")
    if not domain.portfolio_open(state["settings"]):
        raise ApiError(
            403, "Период заполнения портфолио ещё не начался или уже завершён."
        )
    state["achievements"].pop(index)
    domain.audit(
        state, user["id"], "achievement.deleted", "achievement", achievement_id
    )
    await context.store.save(state)
    return json_response({"success": True}, request=request)


@router.patch("/team")
async def update_team(request: Request):
    context, state, user = await _auth_state(request)
    team = domain.team_for(state, user)
    if not team or user.get("role") != "captain":
        raise ApiError(403, "Редактировать карточку команды может только капитан.")
    if not domain.registration_open(state["settings"]):
        raise ApiError(
            403, "Редактирование карточки команды доступно только в период регистрации."
        )
    payload = await read_json(request, context.config.max_json_body)
    team.setdefault("review", {})
    if isinstance(payload.get("description"), str):
        if len(payload["description"]) > 1000:
            raise ApiError(422, "Описание команды не должно превышать 1000 символов.")
        team["description"] = payload["description"].strip()
        team["review"]["description"] = {
            "status": "pending",
            "comment": "",
            "updatedAt": None,
        }
    if isinstance(payload.get("flagUrl"), str):
        if payload["flagUrl"] and not domain.owns_upload(
            state, user, payload["flagUrl"]
        ):
            raise ApiError(403, "Сначала загрузите флаг через форму.")
        team["flagUrl"] = payload["flagUrl"]
        team["review"]["flag"] = {"status": "pending", "comment": "", "updatedAt": None}
    team["isAdmitted"] = False
    domain.audit(state, user["id"], "team.updated", "team", team["id"])
    await context.store.save(state)
    result = deepcopy(team)
    result["quota"] = domain.team_quota(state, team)
    return json_response({"team": result}, request=request)


@router.post("/team/invite")
async def rotate_invite(request: Request):
    context, state, user = await _auth_state(request)
    team = domain.team_for(state, user)
    if not team or user.get("role") != "captain":
        raise ApiError(403, "Только капитан может выпускать приглашения.")
    if not domain.registration_open(state["settings"]):
        raise ApiError(403, "Приглашения доступны только в период регистрации.")
    team.update(
        {
            "inviteCode": domain.invite_code(team["group"]),
            "inviteStatus": "active",
            "inviteExpiresAt": (
                datetime.now(timezone.utc)
                + timedelta(days=state["settings"]["inviteLifetimeDays"])
            )
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z"),
        }
    )
    domain.audit(state, user["id"], "team.invite_rotated", "team", team["id"])
    await context.store.save(state)
    return json_response(
        {"inviteCode": team["inviteCode"], "inviteExpiresAt": team["inviteExpiresAt"]},
        request=request,
    )


@router.patch("/team/video")
async def update_video(request: Request):
    context, state, user = await _auth_state(request)
    await _check_upload_rate(context, request, user)
    team = domain.team_for(state, user)
    if not team or user.get("role") != "captain":
        raise ApiError(403, "Видео-визитку загружает капитан.")
    if not domain.video_open(state["settings"]):
        raise ApiError(403, "Период подачи видео ещё не начался или уже завершён.")
    payload = await read_json(request, context.config.max_upload_body)
    url = str(payload.get("url") or "").strip()
    provider = domain.supported_video_provider(url)
    if payload.get("fileData"):
        if (
            not str(payload["fileData"])
            .lower()
            .startswith(
                (
                    "data:video/mp4;base64,",
                    "data:video/webm;base64,",
                    "data:video/quicktime;base64,",
                )
            )
        ):
            raise ApiError(422, "Для видео-визитки нужен видеофайл MP4, WEBM или MOV.")
        estimated_size = context.file_storage.estimate_size(payload["fileData"])
        if not domain.upload_quota_available(
            state,
            user["id"],
            context.config.max_uploads_per_user,
            context.config.max_upload_bytes_per_user,
            estimated_size,
        ):
            raise ApiError(413, "Достигнут лимит количества или общего размера файлов.")
        uploaded = await context.file_storage.save(
            payload["fileData"], payload.get("fileName", "video.mp4")
        )
        url, provider = uploaded["url"], "file"
        state["uploads"].append(
            {
                "url": url,
                "userId": user["id"],
                "kind": "video",
                "size": uploaded["size"],
                "createdAt": domain.now(),
            }
        )
    if not provider:
        raise ApiError(
            422,
            "Поддерживаются публичные ссылки Rutube, VK Видео, Яндекс Диск или видеофайл MP4, WEBM, MOV.",
        )
    team["videoCard"] = {
        **team.get("videoCard", {}),
        "url": url,
        "provider": provider,
        "status": "pending",
        "submittedAt": domain.now(),
        "score": None,
    }
    domain.audit(state, user["id"], "team.video_submitted", "team", team["id"])
    await context.store.save(state)
    return json_response({"videoCard": team["videoCard"]}, request=request)
