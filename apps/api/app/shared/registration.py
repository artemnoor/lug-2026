"""Domain factories for users and teams created by registration."""

from datetime import datetime, timedelta, timezone
from typing import Any, Mapping
from uuid import uuid4

from ..security.auth import PRIVACY_PATH, PRIVACY_VERSION
from . import domain


def make_team(
    payload: Mapping[str, Any], settings: Mapping[str, Any]
) -> dict[str, Any]:
    group = str(payload["group"]).strip().upper()
    expires_at = (
        (
            datetime.now(timezone.utc)
            + timedelta(days=int(settings["inviteLifetimeDays"]))
        )
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )
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
    payload: Mapping[str, Any],
    team: Mapping[str, Any],
    student_card: Mapping[str, Any],
    role: str,
) -> dict[str, Any]:
    contacts = domain.normalize_messenger_contacts(dict(payload))
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
