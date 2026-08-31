"""Review command adapter for the development JSON provider."""

import time
from uuid import uuid4

from ..shared import domain
from ..shared.state_machine import ensure_review_transition
from .persistence_errors import PersistenceError


class JsonReviewCommandMixin:
    async def review_team_atomic(
        self, team_id: str, field: str, status: str, comment: str, actor_id: str
    ):
        state = await self.load()
        team = next(
            (item for item in state["teams"] if item.get("id") == team_id), None
        )
        if not team:
            raise PersistenceError("Команда не найдена.", 404)
        try:
            ensure_review_transition(
                (team.get("review", {}).get(field) or {}).get("status"), status
            )
        except ValueError as exc:
            raise PersistenceError(str(exc), 409, "REVIEW_TRANSITION_CONFLICT") from exc
        team.setdefault("review", {})[field] = {
            "status": status,
            "comment": comment,
            "updatedAt": domain.now(),
        }
        members = [item for item in state["users"] if item.get("teamId") == team_id]
        team["isAdmitted"] = domain.team_is_admitted(state, team, members)
        state["auditLog"].insert(
            0, self._audit_record(actor_id, f"team.{field}.{status}", "team", team_id)
        )
        if team.get("captainId"):
            self._notify(
                state,
                team["captainId"],
                "Проверка команды обновлена",
                comment or "Оргкомитет обновил решение по карточке команды.",
            )
        await self.save(state)
        return team, members, state["settings"]

    async def review_identity_atomic(
        self, user_id: str, status: str, comment: str, actor_id: str
    ):
        state = await self.load()
        target = next(
            (
                item
                for item in state["users"]
                if item.get("id") == user_id and item.get("role") != "admin"
            ),
            None,
        )
        if not target:
            raise PersistenceError("Пользователь не найден.", 404)
        try:
            ensure_review_transition(target.get("identityStatus"), status)
        except ValueError as exc:
            raise PersistenceError(str(exc), 409, "REVIEW_TRANSITION_CONFLICT") from exc
        target.update(
            {
                "identityStatus": status,
                "identityComment": comment,
                "isIdentityConfirmed": status == "approved",
            }
        )
        team = next(
            (item for item in state["teams"] if item.get("id") == target.get("teamId")),
            None,
        )
        members = [
            item
            for item in state["users"]
            if team and item.get("teamId") == team.get("id")
        ]
        if team:
            team["isAdmitted"] = domain.team_is_admitted(state, team, members)
        state["auditLog"].insert(
            0, self._audit_record(actor_id, f"identity.{status}", "user", user_id)
        )
        self._notify(
            state,
            user_id,
            "Личность подтверждена"
            if status == "approved"
            else "Нужно уточнить данные",
            comment or "Документы проверены организаторами.",
        )
        await self.save(state)
        return target, members, state["settings"]

    async def review_achievement_atomic(
        self,
        achievement_id: str,
        status: str,
        comment: str,
        points: float | None,
        review_stage: str,
        actor_id: str,
    ):
        state = await self.load()
        achievement = next(
            (
                item
                for item in state["achievements"]
                if item.get("id") == achievement_id
            ),
            None,
        )
        if not achievement:
            raise PersistenceError("Материал не найден.", 404)
        try:
            ensure_review_transition(achievement.get("status"), status)
        except ValueError as exc:
            raise PersistenceError(str(exc), 409, "REVIEW_TRANSITION_CONFLICT") from exc
        owner = next(
            (
                item
                for item in state["users"]
                if item.get("id") == achievement.get("userId")
            ),
            None,
        )
        if status == "approved" and owner and owner.get("identityStatus") != "approved":
            raise PersistenceError("Сначала подтвердите личность участника.", 422)
        achievement.update(
            {
                "status": status,
                "reviewComment": comment,
                "reviewStage": "approved"
                if status == "approved"
                else "rejected"
                if status == "rejected"
                else review_stage,
                "points": points if status == "approved" else None,
                "reviewedAt": None if status == "pending" else domain.now(),
                "stageUpdatedAt": domain.now(),
            }
        )
        state["auditLog"].insert(
            0,
            self._audit_record(
                actor_id, f"achievement.{status}", "achievement", achievement_id
            ),
        )
        self._notify(
            state,
            achievement.get("userId"),
            "Материал принят" if status == "approved" else "Материал отклонён",
            comment or "Материал прошёл проверку.",
        )
        await self.save(state)
        return achievement

    async def review_video_atomic(
        self, team_id: str, status: str, comment: str, scores: dict, actor_id: str
    ):
        state = await self.load()
        team = next(
            (item for item in state["teams"] if item.get("id") == team_id), None
        )
        if not team:
            raise PersistenceError("Команда не найдена.", 404)
        video = team.get("videoCard") or {}
        if not video.get("url"):
            raise PersistenceError(
                "Нельзя принять видео-визитку без загруженного материала.", 422
            )
        try:
            ensure_review_transition(video.get("status"), status)
        except ValueError as exc:
            raise PersistenceError(str(exc), 409, "REVIEW_TRANSITION_CONFLICT") from exc
        video.update(
            {
                "status": status,
                "score": sum(scores.values()) if status == "approved" else None,
                "criteriaScores": scores,
                "reviewComment": comment,
                "reviewedAt": None if status == "pending" else domain.now(),
            }
        )
        team["videoCard"] = video
        state["auditLog"].insert(
            0, self._audit_record(actor_id, f"video.{status}", "team", team_id)
        )
        if team.get("captainId"):
            self._notify(
                state,
                team["captainId"],
                "Видео-визитка принята"
                if status == "approved"
                else "Видео-визитку нужно уточнить",
                comment or "Откройте раздел «Видео-визитка».",
            )
        await self.save(state)
        return video

    @staticmethod
    def _notify(state: dict, user_id: str | None, title: str, message: str) -> None:
        if user_id:
            state["notifications"].insert(
                0,
                {
                    "id": str(uuid4()),
                    "targetType": "user",
                    "targetId": user_id,
                    "title": title,
                    "message": message,
                    "kind": "system",
                    "createdAt": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
                    "readBy": [],
                },
            )
