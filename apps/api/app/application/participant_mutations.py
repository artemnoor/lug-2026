"""Participant/captain mutation use cases."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from ..shared import domain


class ParticipantRuleViolation(Exception):
    def __init__(self, status_code: int, message: str, code: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.code = code


class ParticipantMutationService:
    def __init__(self, store) -> None:
        self.store = store

    async def create_achievement(self, state: dict, user: dict, payload: dict) -> dict:
        if not domain.portfolio_open(state["settings"]):
            raise ParticipantRuleViolation(
                403,
                "Период заполнения портфолио ещё не начался или уже завершён.",
                "PORTFOLIO_CLOSED",
            )
        if (
            not payload.get("title")
            or payload.get("direction") not in domain.ALLOWED_DIRECTIONS
            or not payload.get("category")
            or not payload.get("fileUrl")
        ):
            raise ParticipantRuleViolation(
                422,
                "Выберите направление, укажите название и загрузите подтверждающий документ.",
                "ACHIEVEMENT_FIELDS_INVALID",
            )
        if not domain.owns_upload(state, user, payload["fileUrl"]):
            raise ParticipantRuleViolation(
                403,
                "Сначала загрузите подтверждающий документ через форму.",
                "UPLOAD_NOT_OWNED",
            )
        now = domain.now()
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
            "stageUpdatedAt": now,
            "reviewedAt": None,
            "points": None,
            "createdAt": now,
        }
        return await self.store.create_achievement_atomic(record, user["id"])

    async def update_team(self, state: dict, user: dict, payload: dict) -> dict:
        team = domain.team_for(state, user)
        if not team or user.get("role") != "captain":
            raise ParticipantRuleViolation(
                403,
                "Редактировать карточку команды может только капитан.",
                "CAPTAIN_REQUIRED",
            )
        if not domain.registration_open(state["settings"]):
            raise ParticipantRuleViolation(
                403,
                "Редактирование карточки команды доступно только в период регистрации.",
                "REGISTRATION_CLOSED",
            )
        team_patch = {}
        review = dict(team.get("review") or {})
        if isinstance(payload.get("description"), str):
            if len(payload["description"]) > 1000:
                raise ParticipantRuleViolation(
                    422,
                    "Описание команды не должно превышать 1000 символов.",
                    "TEAM_DESCRIPTION_TOO_LONG",
                )
            team_patch["description"] = payload["description"].strip()
            review["description"] = {
                "status": "pending",
                "comment": "",
                "updatedAt": None,
            }
        if isinstance(payload.get("flagUrl"), str):
            if payload["flagUrl"] and not domain.owns_upload(
                state, user, payload["flagUrl"]
            ):
                raise ParticipantRuleViolation(
                    403, "Сначала загрузите флаг через форму.", "UPLOAD_NOT_OWNED"
                )
            team_patch["flagUrl"] = payload["flagUrl"]
            review["flag"] = {"status": "pending", "comment": "", "updatedAt": None}
        return await self.store.update_team_atomic(
            team["id"],
            {**team_patch, "review": review, "isAdmitted": False},
            user["id"],
        )

    async def update_video(self, state: dict, user: dict, payload: dict) -> dict:
        team = domain.team_for(state, user)
        if not team or user.get("role") != "captain":
            raise ParticipantRuleViolation(
                403, "Видео-визитку загружает капитан.", "CAPTAIN_REQUIRED"
            )
        if not domain.video_open(state["settings"]):
            raise ParticipantRuleViolation(
                403,
                "Период подачи видео ещё не начался или уже завершён.",
                "VIDEO_CLOSED",
            )
        url = str(payload.get("url") or "").strip()
        provider = domain.supported_video_provider(url)
        if (
            not provider
            and url.startswith("/uploads/")
            and domain.owns_upload(state, user, url)
        ):
            provider = "file"
        if not provider:
            raise ParticipantRuleViolation(
                422,
                "Поддерживаются публичные ссылки Rutube, VK Видео, Яндекс Диск или видеофайл MP4, WEBM, MOV.",
                "VIDEO_URL_INVALID",
            )
        video_card = {
            **team.get("videoCard", {}),
            "url": url,
            "provider": provider,
            "status": "pending",
            "submittedAt": domain.now(),
            "score": None,
        }
        return await self.store.update_video_atomic(
            team["id"], video_card, user["id"], None
        )

    async def rotate_invite(self, state: dict, user: dict) -> dict:
        team = domain.team_for(state, user)
        if not team or user.get("role") != "captain":
            raise ParticipantRuleViolation(
                403, "Только капитан может выпускать приглашения.", "CAPTAIN_REQUIRED"
            )
        if not domain.registration_open(state["settings"]):
            raise ParticipantRuleViolation(
                403,
                "Приглашения доступны только в период регистрации.",
                "REGISTRATION_CLOSED",
            )
        expires_at = (
            (
                datetime.now(timezone.utc)
                + timedelta(days=state["settings"]["inviteLifetimeDays"])
            )
            .isoformat(timespec="milliseconds")
            .replace("+00:00", "Z")
        )
        return await self.store.rotate_invite_atomic(
            team["id"], domain.invite_code(team["group"]), expires_at, user["id"]
        )
