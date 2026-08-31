"""Organizer review use cases, independent from HTTP error representation."""

from collections.abc import Mapping
from typing import Any

from ..shared import domain
from ..shared.commands import ReviewCommand
from .repositories import AchievementRepository, TeamRepository, UserRepository


class AdminRuleViolation(Exception):
    def __init__(self, message: str, code: str = "ADMIN_RULE_VIOLATION") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


class AdminReviewService:
    def __init__(
        self,
        teams: TeamRepository,
        users: UserRepository | None = None,
        achievements: AchievementRepository | None = None,
    ) -> None:
        self.teams = teams
        self.users = users or teams  # type: ignore[assignment]
        self.achievements = achievements or teams  # type: ignore[assignment]

    async def update_quota(self, team_id: str, confirmed: bool, actor_id: str):
        team = await self.teams.update_quota_atomic(team_id, confirmed, actor_id)
        return await self.teams.get_team_snapshot(team["id"]) if team else None

    async def remove_member(self, team_id: str, user_id: str, actor_id: str) -> None:
        snapshot = await self.teams.get_team_snapshot(team_id)
        if not snapshot:
            raise AdminRuleViolation("Команда не найдена.", "TEAM_NOT_FOUND")
        team, members, _ = snapshot
        member = next((item for item in members if item.get("id") == user_id), None)
        if not member:
            raise AdminRuleViolation("Участник не найден.", "MEMBER_NOT_FOUND")
        if member.get("id") == team.get("captainId") or member.get("role") == "captain":
            raise AdminRuleViolation(
                "Капитана нельзя удалить из команды.", "CAPTAIN_CANNOT_BE_REMOVED"
            )
        if not await self.teams.remove_team_member_atomic(team_id, user_id, actor_id):
            raise AdminRuleViolation(
                "Участник уже удалён другим запросом.", "MEMBER_REMOVAL_CONFLICT"
            )

    async def review_team(
        self, team_id: str, payload: ReviewCommand | Mapping[str, Any], actor_id: str
    ):
        command = _review_command(payload)
        field, status = command.field, command.status
        if (
            field not in {"name", "group", "flag", "description"}
            or status not in domain.REVIEW_STATUSES
        ):
            raise AdminRuleViolation(
                "Недопустимое решение по данным команды.", "TEAM_REVIEW_INVALID"
            )
        comment = command.comment
        self._require_comment(status, comment)
        return await self.teams.review_team_atomic(
            team_id, field, status, comment, actor_id
        )

    async def review_identity(
        self, user_id: str, payload: ReviewCommand | Mapping[str, Any], actor_id: str
    ):
        command = _review_command(payload)
        status = command.status
        if status not in domain.REVIEW_STATUSES:
            raise AdminRuleViolation(
                "Недопустимый статус проверки личности.", "IDENTITY_REVIEW_INVALID"
            )
        comment = command.comment
        self._require_comment(status, comment)
        user, _, _ = await self.users.review_identity_atomic(
            user_id, status, comment, actor_id
        )
        return user

    async def review_achievement(
        self,
        achievement_id: str,
        payload: ReviewCommand | Mapping[str, Any],
        actor_id: str,
    ):
        command = _review_command(payload)
        status = command.status
        if status not in domain.REVIEW_STATUSES:
            raise AdminRuleViolation(
                "Недопустимый статус материала.", "ACHIEVEMENT_REVIEW_INVALID"
            )
        comment = command.comment
        self._require_comment(status, comment)
        points = self._number_or_none(command.points)
        if points is not None and not 0 <= points <= 100:
            raise AdminRuleViolation(
                "Баллы должны быть числом от 0 до 100.", "ACHIEVEMENT_POINTS_INVALID"
            )
        return await self.achievements.review_achievement_atomic(
            achievement_id,
            status,
            comment,
            points,
            command.review_stage,
            actor_id,
        )

    async def review_video(
        self, team_id: str, payload: ReviewCommand | Mapping[str, Any], actor_id: str
    ):
        command = _review_command(payload)
        status = command.status
        if status not in domain.REVIEW_STATUSES:
            raise AdminRuleViolation(
                "Недопустимый статус видео-визитки.", "VIDEO_REVIEW_INVALID"
            )
        comment = command.comment
        self._require_comment(status, comment)
        limits = {"topic": 8, "creativity": 8, "quality": 5, "vfx": 2}
        scores = {}
        for key, limit in limits.items():
            value = self._number_or_none(command.criteria_scores.get(key)) or 0
            if value < 0 or value > limit:
                raise AdminRuleViolation(
                    f"Оценка «{key}» должна быть от 0 до {limit}.",
                    "VIDEO_SCORE_INVALID",
                )
            scores[key] = value
        return await self.teams.review_video_atomic(
            team_id, status, comment, scores, actor_id
        )

    @staticmethod
    def team_response(snapshot: tuple[dict, list[dict], dict] | None) -> dict:
        if not snapshot:
            raise AdminRuleViolation("Команда не найдена.", "TEAM_NOT_FOUND")
        team, members, settings = snapshot
        state = {"settings": settings, "users": members}
        result = dict(team)
        result["quota"] = domain.team_quota(state, team, members)
        result["isAdmitted"] = domain.team_is_admitted(state, team, members)
        return result

    @staticmethod
    def public_user(user: Mapping[str, Any]) -> dict[str, Any]:
        return domain.public_user(dict(user))

    @staticmethod
    def _require_comment(status: str, comment: str) -> None:
        if status == "rejected" and not comment:
            raise AdminRuleViolation(
                "При отклонении обязательно укажите причину.", "REVIEW_COMMENT_REQUIRED"
            )

    @staticmethod
    def _number_or_none(value: Any) -> float | None:
        if value is None or value == "":
            return None
        try:
            number = float(value)
        except (TypeError, ValueError) as exc:
            raise AdminRuleViolation(
                "Баллы должны быть числом от 0 до 100.", "SCORE_INVALID"
            ) from exc
        if number != number or number in {float("inf"), float("-inf")}:
            raise AdminRuleViolation(
                "Баллы должны быть числом от 0 до 100.", "SCORE_INVALID"
            )
        return number


def _review_command(payload: ReviewCommand | Mapping[str, Any]) -> ReviewCommand:
    if isinstance(payload, ReviewCommand):
        return payload
    return ReviewCommand(
        status=str(payload.get("status") or ""),
        field=str(payload.get("field") or ""),
        comment=str(payload.get("comment") or "").strip(),
        points=payload.get("points"),
        review_stage=str(payload.get("reviewStage") or "received"),
        criteria_scores=dict(payload.get("criteriaScores") or {}),
    )
