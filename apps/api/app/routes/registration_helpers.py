"""Validation and persistence helpers for registration requests."""

from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from ..http.errors import ApiError
from ..security.auth import PRIVACY_PATH, PRIVACY_VERSION
from ..shared import domain


def validate_registration(payload: dict[str, Any], state: dict, is_team: bool) -> None:
    required = (
        ["fio", "group", "teamName", "email", "password", "studentCardFile"]
        if is_team
        else ["fio", "email", "password", "studentCardFile"]
    )
    if any(not str(payload.get(field) or "").strip() for field in required) or payload.get("consent") is not True:
        raise ApiError(422, "Заполните все обязательные поля и подтвердите согласие.")
    if not domain.valid_email(payload.get("email")):
        raise ApiError(422, "Укажите корректный адрес электронной почты.")
    if payload.get("phone") and not domain.valid_phone(payload.get("phone")):
        raise ApiError(422, "Если указываете телефон, проверьте его формат.")
    if not domain.strong_password(payload.get("password")):
        raise ApiError(422, "Пароль должен содержать минимум 8 символов, строчную и прописную букву, цифру и спецсимвол.")
    contacts = domain.normalize_messenger_contacts(payload)
    if not domain.validate_messenger_contacts(contacts):
        raise ApiError(422, "Выберите хотя бы один мессенджер и укажите корректный контакт.")
    if is_team:
        total = int(payload.get("totalStudentsInGroup") or 0)
        if total < 1 or total > 1000:
            raise ApiError(422, "Укажите количество студентов в группе от 1 до 1000.")
    email = domain.normalize_email(payload.get("email"))
    if any(domain.normalize_email(user.get("email")) == email for user in state["users"]):
        raise ApiError(409, "Этот адрес электронной почты уже зарегистрирован.")
    if is_team and any(
        team.get("group") == str(payload.get("group")).strip().upper()
        for team in state["teams"]
    ):
        raise ApiError(409, "Для этой учебной группы уже создана команда.")


def active_team(state: dict, code: Any) -> dict | None:
    normalized = str(code or "").strip().upper()
    if not domain.valid_invite_code(normalized):
        return None
    return next(
        (
            entry
            for entry in state["teams"]
            if entry.get("inviteCode") == normalized
            and entry.get("inviteStatus") == "active"
            and domain.timestamp(entry.get("inviteExpiresAt"))
            >= datetime.now(timezone.utc).timestamp() * 1000
        ),
        None,
    )


async def commit_pending(context, state: dict, pending: dict) -> dict:
    payload = dict(pending.get("payload") or {})
    is_team = pending.get("kind") == "team"
    if not domain.registration_open(state["settings"]):
        raise ApiError(403, "Регистрация завершена или ещё не началась.")
    if any(
        domain.normalize_email(user.get("email"))
        == domain.normalize_email(payload.get("email"))
        for user in state["users"]
    ):
        raise ApiError(409, "Этот адрес электронной почты уже зарегистрирован.")
    if is_team:
        if any(
            team.get("group") == str(payload.get("group")).strip().upper()
            for team in state["teams"]
        ):
            raise ApiError(409, "Для этой учебной группы уже создана команда.")
        team = make_team(payload, state)
    else:
        team = active_team(state, payload.get("inviteCode"))
        if not team:
            raise ApiError(404, "Приглашение неактивно.")
        if sum(user.get("teamId") == team.get("id") for user in state["users"]) >= int(
            team.get("totalStudentsInGroup") or 0
        ):
            raise ApiError(409, "В команде уже достигнута заявленная вместимость.")
    student_card = pending.get("studentCard") or {}
    user = make_user(payload, team, student_card, "captain" if is_team else "participant")
    state["uploads"].append(
        {
            "url": student_card["url"],
            "userId": user["id"],
            "kind": "student-card",
            "size": student_card["size"],
            "createdAt": domain.now(),
        }
    )
    if is_team:
        team["captainId"] = user["id"]
        state["teams"].append(team)
    state["users"].append(user)
    state["emailVerifications"] = [
        item
        for item in state.get("emailVerifications", [])
        if item.get("id") != pending.get("id")
    ]
    domain.audit(
        state,
        user["id"],
        "team.created" if is_team else "team.joined",
        "team",
        team["id"],
    )
    domain.notify_user(
        state,
        user["id"],
        "Заявка принята",
        "Команда создана. Оргкомитет проверит данные капитана."
        if is_team
        else "Вы добавлены в состав команды и ожидаете проверки личности.",
    )
    return user


def make_team(payload: dict[str, Any], state: dict) -> dict:
    group = str(payload["group"]).strip().upper()
    expires_at = (
        datetime.now(timezone.utc)
        + timedelta(days=state["settings"]["inviteLifetimeDays"])
    ).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return {
        "id": str(uuid4()),
        "name": str(payload["teamName"]).strip(),
        "group": group,
        "totalStudentsInGroup": int(payload["totalStudentsInGroup"]),
        "captainId": None,
        "description": "",
        "flagUrl": "",
        "inviteCode": domain.invite_code(group),
        "inviteStatus": "active",
        "inviteExpiresAt": expires_at,
        "videoCard": {"url": "", "status": "none", "score": None, "criteriaScores": {}},
        "createdAt": domain.now(),
    }


def make_user(
    payload: dict[str, Any], team: dict, student_card: dict, role: str
) -> dict:
    contacts = domain.normalize_messenger_contacts(payload)
    first_key, first_value = next(iter(contacts.items()))
    phone = (
        domain.normal_phone(payload.get("phone"))
        if domain.valid_phone(payload.get("phone"))
        else ""
    )
    return {
        "id": str(uuid4()),
        "fio": str(payload["fio"]).strip(),
        "group": team["group"],
        "email": domain.normalize_email(payload["email"]),
        "emailVerified": True,
        "emailVerifiedAt": domain.now(),
        "phone": phone,
        "messenger": first_key,
        "messengerContact": first_value,
        "messengerContacts": contacts,
        "telegramAccount": contacts.get("telegram", ""),
        "role": role,
        "teamId": team["id"],
        "studentCardFile": student_card["url"],
        "avatarUrl": "",
        "identityStatus": "pending",
        "identityComment": "",
        "consentAt": domain.now(),
        "consentVersion": PRIVACY_VERSION,
        "consentPolicy": PRIVACY_PATH,
        "passwordHash": payload["passwordHash"],
        "createdAt": domain.now(),
    }
