"""Participant/captain mutation use cases."""

from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from ..shared import domain
from ..shared.entities import ParticipantState
from .repositories import AchievementRepository, TeamRepository


class ParticipantRuleViolation(Exception):
    def __init__(self, status_code: int, message: str, code: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.code = code


class ParticipantMutationService:
    def __init__(
        self,
        teams: TeamRepository,
        achievements: AchievementRepository | None = None,
    ) -> None:
        self.teams = teams
        # Compatibility adapters can still provide both ports through one
        # object; production composition supplies each narrow port explicitly.
        self.achievements = achievements or teams  # type: ignore[assignment]

    async def create_achievement(
        self,
        state: ParticipantState | Mapping[str, Any],
        user: Mapping[str, Any],
        payload: Mapping[str, Any],
    ) -> dict:
        state = _state_mapping(state)
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
        return await self.achievements.create_achievement_atomic(record, user["id"])

    async def update_team(
        self,
        state: ParticipantState | Mapping[str, Any],
        user: Mapping[str, Any],
        payload: Mapping[str, Any],
    ) -> dict:
        state = _state_mapping(state)
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
        return await self.teams.update_team_atomic(
            team["id"],
            {**team_patch, "review": review, "isAdmitted": False},
            user["id"],
        )

    async def update_video(
        self,
        state: ParticipantState | Mapping[str, Any],
        user: Mapping[str, Any],
        payload: Mapping[str, Any],
    ) -> dict:
        state = _state_mapping(state)
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
        return await self.teams.update_video_atomic(
            team["id"], video_card, user["id"], None
        )

    async def rotate_invite(
        self,
        state: ParticipantState | Mapping[str, Any],
        user: Mapping[str, Any],
    ) -> dict:
        state = _state_mapping(state)
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
        return await self.teams.rotate_invite_atomic(
            team["id"], domain.invite_code(team["group"]), expires_at, user["id"]
        )

    async def delete_achievement(
        self,
        state: ParticipantState | Mapping[str, Any],
        user: Mapping[str, Any],
        achievement_id: str,
    ) -> None:
        state = _state_mapping(state)
        if not domain.portfolio_open(state["settings"]):
            raise ParticipantRuleViolation(
                403,
                "Период заполнения портфолио ещё не начался или уже завершён.",
                "PORTFOLIO_CLOSED",
            )
        if not await self.achievements.delete_achievement_atomic(
            achievement_id, user["id"]
        ):
            raise ParticipantRuleViolation(404, "Достижение не найдено.", "NOT_FOUND")

    @staticmethod
    def team_response(
        state: ParticipantState | Mapping[str, Any], team: Mapping[str, Any]
    ) -> dict[str, Any]:
        state = _state_mapping(state)
        result = dict(team)
        result["quota"] = domain.team_quota(state, result)
        return result


def _state_mapping(state: ParticipantState | Mapping[str, Any]) -> dict[str, Any]:
    if isinstance(state, ParticipantState):
        return state.as_mapping()
    return dict(state)
