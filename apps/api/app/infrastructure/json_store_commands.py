"""Command compatibility adapter for the single-process JSON store."""

import hashlib
import secrets
import time
from hmac import compare_digest
from uuid import uuid4

from ..shared import domain
from .persistence_errors import PersistenceError


class JsonStoreCommandMixin:
    async def cleanup_expired_records(self) -> int:
        now_ms = int(time.time() * 1000)
        state = await self.load()
        before = sum(
            len(state.get(key, []))
            for key in ("sessions", "emailVerifications", "passwordResets")
        )
        state["sessions"] = [
            item
            for item in state.get("sessions", [])
            if int(item.get("expiresAt", 0) or 0) >= now_ms
        ]
        state["emailVerifications"] = [
            item
            for item in state.get("emailVerifications", [])
            if int(item.get("expiresAtMs", 0) or 0) >= now_ms
        ]
        state["passwordResets"] = [
            item
            for item in state.get("passwordResets", [])
            if int(item.get("expiresAtMs", 0) or 0) >= now_ms
        ]
        removed = before - sum(
            len(state.get(key, []))
            for key in ("sessions", "emailVerifications", "passwordResets")
        )
        if removed:
            await self.save(state)
        return removed

    async def commit_pending_atomic(
        self,
        verification_id: str,
        session_ttl_ms: int,
        expected_code_hash: str | None = None,
        max_attempts: int | None = None,
    ) -> tuple[dict, str]:
        from ..shared.registration import make_team, make_user

        state = await self.load()
        pending = next(
            (
                item
                for item in state["emailVerifications"]
                if item.get("id") == verification_id
            ),
            None,
        )
        if not pending:
            raise PersistenceError(
                "Заявка на подтверждение не найдена или уже обработана.", 404
            )
        if int(pending.get("expiresAtMs", 0)) <= int(time.time() * 1000):
            raise PersistenceError(
                "Заявка на подтверждение не найдена или уже обработана.", 404
            )
        attempts = int(pending.get("attempts", 0))
        if max_attempts is not None and attempts >= max_attempts:
            raise PersistenceError(
                "Лимит попыток исчерпан. Начните регистрацию заново.", 422
            )
        if expected_code_hash is not None and not compare_digest(
            expected_code_hash, str(pending.get("codeHash") or "")
        ):
            pending["attempts"] = min(max_attempts or attempts + 1, attempts + 1)
            await self.save(state)
            raise PersistenceError("Неверный код подтверждения.", 422)
        settings = state["settings"]
        if not domain.registration_open(settings):
            raise PersistenceError("Регистрация завершена или ещё не началась.", 403)
        request_payload = dict(pending.get("payload") or {})
        email = domain.normalize_email(request_payload.get("email"))
        if any(
            domain.normalize_email(item.get("email")) == email
            for item in state["users"]
        ):
            raise PersistenceError(
                "Этот адрес электронной почты уже зарегистрирован.", 409
            )
        is_team = pending.get("kind") == "team"
        if is_team:
            group = str(request_payload.get("group") or "").strip().upper()
            if any(item.get("group") == group for item in state["teams"]):
                raise PersistenceError(
                    "Для этой учебной группы уже создана команда.", 409
                )
            team = make_team(request_payload, settings)
        else:
            team = next(
                (
                    item
                    for item in state["teams"]
                    if item.get("inviteCode")
                    == str(request_payload.get("inviteCode") or "").strip().upper()
                ),
                None,
            )
            if (
                not team
                or not domain.timestamp(team.get("inviteExpiresAt"))
                >= time.time() * 1000
            ):
                raise PersistenceError("Приглашение неактивно.", 404)
            if sum(
                item.get("teamId") == team.get("id") for item in state["users"]
            ) >= int(team.get("totalStudentsInGroup") or 0):
                raise PersistenceError(
                    "В команде уже достигнута заявленная вместимость.",
                    409,
                    "TEAM_CAPACITY_REACHED",
                )
        user = make_user(
            request_payload,
            team,
            pending.get("studentCard") or {},
            "captain" if is_team else "participant",
        )
        if is_team:
            team["captainId"] = user["id"]
            state["teams"].append(team)
        state["users"].append(user)
        card = pending.get("studentCard") or {}
        state["uploads"].append(
            {
                **card,
                "userId": user["id"],
                "kind": "student-card",
                "createdAt": domain.now(),
            }
        )
        state["emailVerifications"] = [
            item
            for item in state["emailVerifications"]
            if item.get("id") != verification_id
        ]
        state["auditLog"].insert(
            0,
            self._audit_record(
                user["id"],
                "team.created" if is_team else "team.joined",
                "team",
                team["id"],
            ),
        )
        state["notifications"].insert(
            0,
            {
                "id": str(uuid4()),
                "targetType": "user",
                "targetId": user["id"],
                "title": "Заявка принята",
                "message": "Команда создана. Оргкомитет проверит данные капитана."
                if is_team
                else "Вы добавлены в состав команды и ожидаете проверки личности.",
                "kind": "system",
                "createdAt": domain.now(),
                "readBy": [],
            },
        )
        token = secrets.token_hex(32)
        now_ms = int(time.time() * 1000)
        state["sessions"] = [
            item
            for item in state["sessions"]
            if int(item.get("expiresAt", 0) or 0) >= now_ms
        ]
        state["sessions"].append(
            {
                "tokenHash": hashlib.sha256(token.encode()).hexdigest(),
                "userId": user["id"],
                "expiresAt": now_ms + session_ttl_ms,
            }
        )
        await self.save(state)
        return user, token

    async def create_password_reset_atomic(
        self,
        email: str,
        reset: dict,
        email_message: dict,
        now_ms: int,
        cooldown_ms: int,
    ) -> bool:
        state = await self.load()
        user = next(
            (
                item
                for item in state["users"]
                if domain.normalize_email(item.get("email")) == email
                and item.get("emailVerified") is True
            ),
            None,
        )
        if not user:
            return False
        existing = next(
            (
                item
                for item in state["passwordResets"]
                if domain.normalize_email(item.get("email")) == email
            ),
            None,
        )
        if existing and now_ms - int(existing.get("lastSentAtMs", 0)) < cooldown_ms:
            return False
        reset["id"] = existing.get("id") if existing else reset["id"]
        state["passwordResets"] = [
            item
            for item in state["passwordResets"]
            if domain.normalize_email(item.get("email")) != email
        ]
        state["passwordResets"].append(dict(reset))
        await self.save(state)
        return True

    async def reset_password_atomic(
        self, email: str, expected_hash: str, new_password_hash: str, max_attempts: int
    ) -> dict:
        state = await self.load()
        reset = next(
            (
                item
                for item in state["passwordResets"]
                if domain.normalize_email(item.get("email")) == email
            ),
            None,
        )
        now_ms = int(time.time() * 1000)
        invalid = "Код восстановления недействителен или истёк. Запросите новый код."
        if not reset or int(reset.get("expiresAtMs", 0)) <= now_ms:
            raise PersistenceError(invalid, 422)
        if int(reset.get("attempts", 0)) >= max_attempts:
            raise PersistenceError(
                "Лимит попыток исчерпан. Запросите новый код восстановления.", 422
            )
        if not compare_digest(expected_hash, str(reset.get("codeHash") or "")):
            reset["attempts"] = int(reset.get("attempts", 0)) + 1
            await self.save(state)
            raise PersistenceError(invalid, 422)
        user = next(
            (
                item
                for item in state["users"]
                if domain.normalize_email(item.get("email")) == email
                and item.get("emailVerified") is True
            ),
            None,
        )
        if not user:
            raise PersistenceError(invalid, 422)
        user["passwordHash"] = new_password_hash
        state["passwordResets"] = [
            item for item in state["passwordResets"] if item is not reset
        ]
        state["sessions"] = [
            item for item in state["sessions"] if item.get("userId") != user.get("id")
        ]
        state["auditLog"].insert(
            0, self._audit_record(user["id"], "auth.password_reset", "user", user["id"])
        )
        await self.save(state)
        return dict(user)

    async def save_admin_atomic(self, user: dict, clear_sessions: bool = False) -> dict:
        state = await self.load()
        found = False
        for index, item in enumerate(state["users"]):
            if item.get("id") == user.get("id"):
                state["users"][index] = dict(user)
                found = True
                break
        if not found:
            state["users"].append(dict(user))
        if clear_sessions:
            state["sessions"] = [
                item
                for item in state["sessions"]
                if item.get("userId") != user.get("id")
            ]
        state["auditLog"].insert(
            0,
            self._audit_record(
                user["id"], "admin.credentials_synced", "user", user["id"]
            ),
        )
        await self.save(state)
        return dict(user)

    async def remove_team_member_atomic(
        self, team_id: str, user_id: str, actor_id: str
    ) -> bool:
        state = await self.load()
        if not any(
            item.get("id") == user_id and item.get("teamId") == team_id
            for item in state["users"]
        ):
            return False
        state["users"] = [item for item in state["users"] if item.get("id") != user_id]
        state["achievements"] = [
            item for item in state["achievements"] if item.get("userId") != user_id
        ]
        state["sessions"] = [
            item for item in state["sessions"] if item.get("userId") != user_id
        ]
        state["auditLog"].insert(
            0, self._audit_record(actor_id, "team.member_removed", "user", user_id)
        )
        await self.save(state)
        return True

    async def create_notification_atomic(
        self, notification: dict, actor_id: str
    ) -> dict:
        state = await self.load()
        state["notifications"].insert(0, dict(notification))
        state["auditLog"].insert(
            0,
            self._audit_record(
                actor_id,
                "notification.sent",
                notification.get("targetType", ""),
                notification.get("targetId") or "all",
            ),
        )
        await self.save(state)
        return dict(notification)

    async def mark_notification_read_atomic(
        self, notification_id: str, user_id: str
    ) -> bool:
        state = await self.load()
        item = next(
            (
                entry
                for entry in state["notifications"]
                if entry.get("id") == notification_id
            ),
            None,
        )
        user = next(
            (entry for entry in state["users"] if entry.get("id") == user_id), None
        )
        if (
            not item
            or not user
            or not any(
                entry.get("id") == notification_id
                for entry in domain.list_notifications(state, user)
            )
        ):
            return False
        item.setdefault("readBy", [])
        if user_id not in item["readBy"]:
            item["readBy"].append(user_id)
            await self.save(state)
        return True

    async def update_user_atomic(
        self,
        user_id: str,
        user: dict,
        actor_id: str,
        upload: dict | None = None,
        remove_upload_url: str = "",
    ) -> dict:
        state = await self.load()
        for index, item in enumerate(state["users"]):
            if item.get("id") == user_id:
                state["users"][index] = dict(user)
                if upload:
                    state["uploads"].append(dict(upload))
                if remove_upload_url:
                    state["uploads"] = [
                        item
                        for item in state["uploads"]
                        if item.get("url") != remove_upload_url
                    ]
                state["auditLog"].insert(
                    0, self._audit_record(actor_id, "profile.updated", "user", user_id)
                )
                if upload:
                    state["notifications"].insert(
                        0,
                        {
                            "id": str(uuid4()),
                            "targetType": "admins",
                            "targetId": user_id,
                            "title": "Новое фото личного кабинета",
                            "message": f"{user.get('fio', 'Участник')} прикрепил(а) новое фото личного кабинета. Проверьте участника в разделе «Участники».",
                            "kind": "system",
                            "createdAt": time.strftime(
                                "%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()
                            ),
                            "readBy": [],
                        },
                    )
                await self.save(state)
                return dict(user)
        raise RuntimeError("Пользователь не найден.")

    async def rehash_password_atomic(self, user_id: str, password_hash: str) -> None:
        state = await self.load()
        user = next(
            (item for item in state["users"] if item.get("id") == user_id), None
        )
        if user:
            user["passwordHash"] = password_hash
            await self.save(state)

    async def update_quota_atomic(
        self, team_id: str, confirmed: bool, actor_id: str
    ) -> dict:
        state = await self.load()
        team = next(
            (item for item in state["teams"] if item.get("id") == team_id), None
        )
        if not team:
            return {}
        team["isQuotaConfirmed"] = confirmed
        state["auditLog"].insert(
            0, self._audit_record(actor_id, "team.quota_updated", "team", team_id)
        )
        await self.save(state)
        return dict(team)

    async def get_email_verification(self, verification_id: str) -> dict | None:
        state = await self.load()
        return next(
            (
                item
                for item in state.get("emailVerifications", [])
                if item.get("id") == verification_id
            ),
            None,
        )

    async def replace_email_verification(
        self, pending: dict, email_message: dict | None = None
    ) -> list[str]:
        state = await self.load()
        old_urls = []
        retained = []
        for item in state.get("emailVerifications", []):
            if (
                item.get("id") == pending.get("id")
                or item.get("email", "").lower() == pending.get("email", "").lower()
            ):
                old_url = (item.get("studentCard") or {}).get("url", "")
                if old_url and old_url != (pending.get("studentCard") or {}).get(
                    "url", ""
                ):
                    old_urls.append(old_url)
                continue
            retained.append(item)
        retained.append(dict(pending))
        state["emailVerifications"] = retained
        await self.save(state)
        return old_urls

    async def resend_email_verification_atomic(
        self,
        verification_id: str,
        fields: dict,
        email_message: dict,
        now_ms: int,
        cooldown_ms: int,
    ) -> dict:
        pending = await self.get_email_verification(verification_id)
        if not pending:
            raise PersistenceError(
                "Заявка на подтверждение не найдена или уже обработана.", 404
            )
        if now_ms - int(pending.get("lastSentAtMs", 0)) < cooldown_ms:
            raise PersistenceError("Новый код можно запросить позже.", 429)
        pending.update(fields)
        state = await self.load()
        state["emailVerifications"] = [
            pending if item.get("id") == verification_id else item
            for item in state.get("emailVerifications", [])
        ]
        await self.save(state)
        return pending

    async def create_session_atomic(
        self, user_id: str, ttl_ms: int, actor_id: str | None = None
    ) -> str:
        token = secrets.token_hex(32)
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        state = await self.load()
        now_ms = int(time.time() * 1000)
        state["sessions"] = [
            item
            for item in state["sessions"]
            if int(item.get("expiresAt", 0) or 0) >= now_ms
        ]
        existing = [item for item in state["sessions"] if item.get("userId") == user_id]
        retained = {
            id(item)
            for item in sorted(
                existing,
                key=lambda item: int(item.get("expiresAt", 0) or 0),
                reverse=True,
            )[:4]
        }
        state["sessions"] = [
            item
            for item in state["sessions"]
            if item.get("userId") != user_id or id(item) in retained
        ]
        state["sessions"].append(
            {
                "id": secrets.token_hex(16),
                "tokenHash": token_hash,
                "userId": user_id,
                "expiresAt": now_ms + ttl_ms,
            }
        )
        await self.save(state)
        return token

    async def remove_session_atomic(self, token_hash: str) -> None:
        state = await self.load()
        state["sessions"] = [
            item for item in state["sessions"] if item.get("tokenHash") != token_hash
        ]
        await self.save(state)

    async def list_sessions(self, user_id: str, current_token_hash: str) -> list[dict]:
        state = await self.load()
        now_ms = int(time.time() * 1000)
        return [
            {
                "id": item.get("id", ""),
                "expiresAt": int(item.get("expiresAt", 0) or 0),
                "current": item.get("tokenHash") == current_token_hash,
            }
            for item in state.get("sessions", [])
            if item.get("userId") == user_id
            and int(item.get("expiresAt", 0) or 0) >= now_ms
        ]

    async def remove_other_sessions_atomic(
        self, user_id: str, current_token_hash: str
    ) -> int:
        state = await self.load()
        before = len(state.get("sessions", []))
        state["sessions"] = [
            item
            for item in state.get("sessions", [])
            if item.get("userId") != user_id
            or item.get("tokenHash") == current_token_hash
        ]
        await self.save(state)
        return before - len(state["sessions"])

    async def create_upload_atomic(self, upload: dict, actor_id: str) -> dict:
        state = await self.load()
        record = {"status": "uploaded", "scanStatus": "pending", **upload}
        state["uploads"].append(record)
        state["auditLog"].insert(
            0,
            self._audit_record(
                actor_id, "file.uploaded", "file", upload.get("url", "")
            ),
        )
        await self.save(state)
        return dict(record)

    async def claim_upload_for_scan(self) -> dict | None:
        state = await self.load()
        for item in state.get("uploads", []):
            if (
                item.get("status") == "uploaded"
                and item.get("scanStatus", "pending") == "pending"
            ):
                item["status"] = "scanning"
                await self.save(state)
                return dict(item)
        return None

    async def finish_upload_scan_atomic(
        self, upload_id: str, status: str, scan_status: str, error: str = ""
    ) -> None:
        state = await self.load()
        for item in state.get("uploads", []):
            if (
                item.get("id") == upload_id
                or item.get("uploadId") == upload_id
                or item.get("url") == upload_id
            ):
                item.update({"status": status, "scanStatus": scan_status})
                if error:
                    item["scanError"] = error[:500]
                await self.save(state)
                return

    async def create_achievement_atomic(self, achievement: dict, actor_id: str) -> dict:
        state = await self.load()
        state["achievements"].insert(0, dict(achievement))
        state["auditLog"].insert(
            0,
            self._audit_record(
                actor_id,
                "achievement.created",
                "achievement",
                achievement.get("id", ""),
            ),
        )
        await self.save(state)
        return dict(achievement)

    async def delete_achievement_atomic(
        self, achievement_id: str, user_id: str
    ) -> bool:
        state = await self.load()
        before = len(state["achievements"])
        state["achievements"] = [
            item
            for item in state["achievements"]
            if not (item.get("id") == achievement_id and item.get("userId") == user_id)
        ]
        if len(state["achievements"]) == before:
            return False
        state["auditLog"].insert(
            0,
            self._audit_record(
                user_id, "achievement.deleted", "achievement", achievement_id
            ),
        )
        await self.save(state)
        return True

    async def update_team_atomic(
        self, team_id: str, patch: dict, actor_id: str
    ) -> dict:
        state = await self.load()
        team = next(
            (item for item in state["teams"] if item.get("id") == team_id), None
        )
        if not team:
            return {}
        team.update(patch)
        state["auditLog"].insert(
            0, self._audit_record(actor_id, "team.updated", "team", team_id)
        )
        await self.save(state)
        return dict(team)

    async def rotate_invite_atomic(
        self, team_id: str, invite_code: str, expires_at: str, actor_id: str
    ) -> dict:
        team = await self.update_team_atomic(
            team_id,
            {
                "inviteCode": invite_code,
                "inviteStatus": "active",
                "inviteExpiresAt": expires_at,
            },
            actor_id,
        )
        return {key: team.get(key) for key in ("inviteCode", "inviteExpiresAt")}

    async def update_video_atomic(
        self, team_id: str, video: dict, actor_id: str, upload: dict | None = None
    ) -> dict:
        state = await self.load()
        team = next(
            (item for item in state["teams"] if item.get("id") == team_id), None
        )
        if not team:
            return {}
        if upload:
            state["uploads"].append(dict(upload))
        team["videoCard"] = dict(video)
        state["auditLog"].insert(
            0, self._audit_record(actor_id, "team.video_submitted", "team", team_id)
        )
        await self.save(state)
        return dict(video)

    async def update_settings_atomic(self, patch: dict, actor_id: str) -> dict:
        state = await self.load()
        settings = state["settings"]
        changes = dict(patch) if isinstance(patch, dict) else {}
        content = changes.pop("content", None)
        settings.update(changes)
        if isinstance(content, dict):
            settings.setdefault("content", {}).update(content)
        state["auditLog"].insert(
            0, self._audit_record(actor_id, "settings.updated", "settings", "global")
        )
        await self.save(state)
        return dict(settings)

    @staticmethod
    def _audit_record(
        actor_id: str, action: str, entity_type: str, entity_id: str
    ) -> dict:
        return {
            "id": str(uuid4()),
            "at": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()),
            "actorId": actor_id,
            "action": action,
            "entityType": entity_type,
            "entityId": entity_id,
        }
