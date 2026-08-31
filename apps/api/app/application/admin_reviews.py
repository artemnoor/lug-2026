"""Organizer review use cases, independent from HTTP error representation."""

from typing import Any

from ..shared import domain


class AdminRuleViolation(Exception):
    def __init__(self, message: str, code: str = "ADMIN_RULE_VIOLATION") -> None:
        super().__init__(message)
        self.message = message
        self.code = code


class AdminReviewService:
    def __init__(self, store: Any) -> None:
        self.store = store

    async def update_quota(self, team_id: str, confirmed: bool, actor_id: str):
        team = await self.store.update_quota_atomic(team_id, confirmed, actor_id)
        return await self.store.get_team_snapshot(team["id"]) if team else None

    async def remove_member(self, team_id: str, user_id: str, actor_id: str) -> None:
        snapshot = await self.store.get_team_snapshot(team_id)
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
        if not await self.store.remove_team_member_atomic(team_id, user_id, actor_id):
            raise AdminRuleViolation(
                "Участник уже удалён другим запросом.", "MEMBER_REMOVAL_CONFLICT"
            )

    async def review_team(self, team_id: str, payload: dict, actor_id: str):
        field, status = payload.get("field"), payload.get("status")
        if (
            field not in {"name", "group", "flag", "description"}
            or status not in domain.REVIEW_STATUSES
        ):
            raise AdminRuleViolation(
                "Недопустимое решение по данным команды.", "TEAM_REVIEW_INVALID"
            )
        comment = str(payload.get("comment") or "").strip()
        self._require_comment(status, comment)
        return await self.store.review_team_atomic(
            team_id, field, status, comment, actor_id
        )

    async def review_identity(self, user_id: str, payload: dict, actor_id: str):
        status = payload.get("status")
        if status not in domain.REVIEW_STATUSES:
            raise AdminRuleViolation(
                "Недопустимый статус проверки личности.", "IDENTITY_REVIEW_INVALID"
            )
        comment = str(payload.get("comment") or "").strip()
        self._require_comment(status, comment)
        user, _, _ = await self.store.review_identity_atomic(
            user_id, status, comment, actor_id
        )
        return user

    async def review_achievement(
        self, achievement_id: str, payload: dict, actor_id: str
    ):
        status = payload.get("status")
        if status not in domain.REVIEW_STATUSES:
            raise AdminRuleViolation(
                "Недопустимый статус материала.", "ACHIEVEMENT_REVIEW_INVALID"
            )
        comment = str(payload.get("comment") or "").strip()
        self._require_comment(status, comment)
        points = self._number_or_none(payload.get("points"))
        if points is not None and not 0 <= points <= 100:
            raise AdminRuleViolation(
                "Баллы должны быть числом от 0 до 100.", "ACHIEVEMENT_POINTS_INVALID"
            )
        return await self.store.review_achievement_atomic(
            achievement_id,
            status,
            comment,
            points,
            str(payload.get("reviewStage") or "received"),
            actor_id,
        )

    async def review_video(self, team_id: str, payload: dict, actor_id: str):
        status = payload.get("status")
        if status not in domain.REVIEW_STATUSES:
            raise AdminRuleViolation(
                "Недопустимый статус видео-визитки.", "VIDEO_REVIEW_INVALID"
            )
        comment = str(payload.get("comment") or "").strip()
        self._require_comment(status, comment)
        limits = {"topic": 8, "creativity": 8, "quality": 5, "vfx": 2}
        scores = {}
        for key, limit in limits.items():
            value = (
                self._number_or_none((payload.get("criteriaScores") or {}).get(key))
                or 0
            )
            if value < 0 or value > limit:
                raise AdminRuleViolation(
                    f"Оценка «{key}» должна быть от 0 до {limit}.",
                    "VIDEO_SCORE_INVALID",
                )
            scores[key] = value
        return await self.store.review_video_atomic(
            team_id, status, comment, scores, actor_id
        )

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
