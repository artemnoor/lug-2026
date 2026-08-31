"""Pure domain rules shared by all API route modules."""

import re
import secrets
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

MESSENGER_KEYS = {"telegram", "vk", "max"}
ALLOWED_DIRECTIONS = {"science", "public", "sport", "culture"}
REVIEW_STATUSES = {"pending", "approved", "rejected"}
EMAIL_PATTERN = re.compile(
    r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@"
    r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
    r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$"
)


def now() -> str:
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def timestamp(value: Any) -> float:
    if not isinstance(value, str) or not value:
        return float("nan")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000
    except ValueError:
        return float("nan")


def window_open(start: Any, end: Any) -> bool:
    start_at, end_at = timestamp(start), timestamp(end)
    now_ms = datetime.now(timezone.utc).timestamp() * 1000
    return (
        start_at == start_at
        and end_at == end_at
        and start_at <= end_at
        and start_at <= now_ms <= end_at
    )


def registration_open(settings: dict) -> bool:
    return settings.get("isRegistrationOpen") is True and window_open(
        settings.get("registrationStart"), settings.get("registrationDeadline")
    )


def portfolio_open(settings: dict) -> bool:
    return window_open(
        settings.get("portfolioStart"), settings.get("portfolioDeadline")
    )


def video_open(settings: dict) -> bool:
    return window_open(settings.get("videoStart"), settings.get("videoDeadline"))


def phone_digits(value: Any = "") -> str:
    return re.sub(r"\D", "", str(value))


def valid_phone(value: Any = "") -> bool:
    digits = phone_digits(value)
    return len(digits) == 11 and digits[:1] in {"7", "8"}


def normal_phone(value: Any = "") -> str:
    digits = phone_digits(value)
    return f"7{digits[1:]}" if len(digits) == 11 and digits.startswith("8") else digits


def normalize_email(value: Any = "") -> str:
    return str(value or "").strip().casefold()


def valid_email(value: Any = "") -> bool:
    email = normalize_email(value)
    return len(email) <= 254 and bool(EMAIL_PATTERN.fullmatch(email))


def strong_password(value: Any = "") -> bool:
    password = str(value)
    return (
        len(password) >= 8
        and bool(re.search(r"[a-zа-яё]", password))
        and bool(re.search(r"[A-ZА-ЯЁ]", password))
        and bool(re.search(r"\d", password))
        and bool(re.search(r"[^A-Za-zА-Яа-яЁё\d\s]", password))
    )


def supported_video_provider(value: Any = "") -> str | None:
    from urllib.parse import parse_qs, urlparse

    parsed = urlparse(str(value).strip())
    if parsed.scheme not in {"http", "https"}:
        return None
    host = (parsed.hostname or "").lower().removeprefix("www.")
    path = parsed.path
    if host == "rutube.ru" or host.endswith(".rutube.ru"):
        return (
            "rutube"
            if re.search(r"/(?:video|shorts|play/embed)/[a-z0-9_-]+", path, re.I)
            else None
        )
    if (
        host == "vk.com"
        or host.endswith(".vk.com")
        or host in {"vkvideo.ru", "vk.ru"}
        or host.endswith((".vkvideo.ru", ".vk.ru"))
    ):
        if re.search(r"/(?:video|clip)-?\d+_\d+", path, re.I) or (
            path.lower().endswith("/video_ext.php")
            and parse_qs(parsed.query).get("oid")
            and parse_qs(parsed.query).get("id")
        ):
            return "vk"
    if host in {"disk.yandex.ru", "yadi.sk"} or host.endswith(
        (".disk.yandex.ru", ".yadi.sk")
    ):
        return "yandex-disk" if re.search(r"/(?:d|i)/[^/]+", path, re.I) else None
    return None


def valid_iso_date(value: Any) -> bool:
    return (
        isinstance(value, str) and bool(value) and timestamp(value) == timestamp(value)
    )


def public_user(user: dict) -> dict:
    """Return the explicit API projection; never serialize persistence payload wholesale."""
    allowed = {
        "id",
        "fio",
        "group",
        "email",
        "emailVerified",
        "emailVerifiedAt",
        "phone",
        "messenger",
        "messengerContact",
        "telegramAccount",
        "messengerContacts",
        "role",
        "teamId",
        "avatarUrl",
        "studentCardFile",
        "studentCardFileName",
        "identityStatus",
        "identityComment",
        "isIdentityConfirmed",
        "createdAt",
    }
    safe = {key: deepcopy(value) for key, value in user.items() if key in allowed}
    safe["messengerContacts"] = normalize_messenger_contacts(user)
    return safe


def team_member_user(user: dict) -> dict:
    keys = ("id", "fio", "group", "role", "teamId", "avatarUrl", "identityStatus")
    return {key: user.get(key, "") for key in keys}


def normalize_messenger_key(value: Any = "") -> str:
    key = str(value).strip().lower()
    return {"telegram": "telegram", "vk": "vk", "вконтакте": "vk", "max": "max"}.get(
        key, ""
    )


def normalize_messenger_contacts(payload: dict | None = None) -> dict[str, str]:
    payload = payload or {}
    contacts_field = payload.get("messengerContacts")
    raw = contacts_field if isinstance(contacts_field, dict) else {}
    contacts: dict[str, str] = {}
    for key, value in raw.items():
        normalized = normalize_messenger_key(key)
        if normalized and str(value or "").strip():
            contacts[normalized] = str(value).strip()
    legacy = normalize_messenger_key(payload.get("messenger"))
    legacy_contact = str(payload.get("messengerContact") or "").strip()
    if legacy and legacy_contact:
        contacts.setdefault(legacy, legacy_contact)
    telegram = str(payload.get("telegramAccount") or "").strip()
    if telegram:
        contacts.setdefault("telegram", telegram)
    return contacts


def valid_messenger_contact(key: str, value: str) -> bool:
    if len(value) > 128:
        return False
    patterns = {
        "telegram": r"^@?[a-zA-Z0-9_]{4,32}$|^(?:https?://)?t\.me/[a-zA-Z0-9_]{4,32}$",
        "vk": r"^(?:(?:https?://)?(?:www\.)?vk\.com/)?[a-zA-Z0-9_.-]{2,64}$",
        "max": r"^(?:\+?\d[\d\s()\-]{8,}|@?[a-zA-Z0-9_.-]{3,64})$",
    }
    return bool(re.fullmatch(patterns.get(key, r"$^"), value))


def validate_messenger_contacts(contacts: dict[str, str]) -> bool:
    return bool(contacts) and all(
        key in MESSENGER_KEYS and valid_messenger_contact(key, value)
        for key, value in contacts.items()
    )


def invite_code(group: str) -> str:
    return f"INV-{secrets.token_hex(16).upper()}"


def valid_invite_code(value: Any = "") -> bool:
    return bool(re.fullmatch(r"INV-[A-F0-9]{32}", str(value).strip().upper()))


def team_for(state: dict, user: dict) -> dict | None:
    return next(
        (t for t in state.get("teams", []) if t.get("id") == user.get("teamId")),
        None,
    )


def team_quota(state: dict, team: dict, members: list[dict] | None = None) -> dict:
    members_count = (
        len(members)
        if members is not None
        else sum(u.get("teamId") == team.get("id") for u in state.get("users", []))
    )
    total = int(team.get("totalStudentsInGroup") or 0)
    required = -(-total * int(state["settings"].get("minTeamPercentage", 60)) // 100)
    return {
        "members": members_count,
        "required": required,
        "total": total,
        "eligible": members_count >= required,
    }


def audit(
    state: dict, actor_id: str, action: str, entity_type: str, entity_id: str
) -> None:
    state["auditLog"].insert(
        0,
        {
            "id": str(uuid4()),
            "at": now(),
            "actorId": actor_id,
            "action": action,
            "entityType": entity_type,
            "entityId": entity_id,
        },
    )
    del state["auditLog"][10000:]


def notify(
    state: dict,
    target_type: str,
    target_id: str | None,
    title: str,
    message: str,
) -> None:
    state["notifications"].insert(
        0,
        {
            "id": str(uuid4()),
            "targetType": target_type,
            "targetId": target_id,
            "title": title,
            "message": message,
            "kind": "system",
            "createdAt": now(),
            "readBy": [],
        },
    )


def notify_user(state: dict, user_id: str | None, title: str, message: str) -> None:
    if user_id:
        notify(state, "user", user_id, title, message)


def list_notifications(state: dict, user: dict) -> list[dict]:
    team = team_for(state, user)
    is_captain = bool(team and team.get("captainId") == user.get("id"))
    user_team, user_id = user.get("teamId"), user.get("id")

    def visible(item: dict) -> bool:
        kind, target = item.get("targetType"), item.get("targetId")
        return (
            kind == "all"
            or (kind == "teams" and user_team)
            or (kind == "team" and target == user_team)
            or (kind == "captain" and is_captain and target == user_team)
            or (kind == "captains" and is_captain)
            or (kind == "admins" and user.get("role") == "admin")
            or (kind == "user" and target == user_id)
        )

    return [item for item in state.get("notifications", []) if visible(item)]


def team_review_state(team: dict, members: list[dict]) -> dict:
    source = team.get("review") or {}
    review = {
        field: {
            "status": source.get(field, {}).get("status")
            if source.get(field, {}).get("status") in REVIEW_STATUSES
            else "pending",
            "comment": str(source.get(field, {}).get("comment") or ""),
            "updatedAt": source.get(field, {}).get("updatedAt"),
        }
        for field in ("name", "group", "flag", "description")
    }
    statuses = [member.get("identityStatus") for member in members]
    review["members"] = {
        "status": "approved"
        if members and all(value == "approved" for value in statuses)
        else "rejected"
        if "rejected" in statuses
        else "pending",
        "comment": "",
    }
    return review


def team_is_admitted(state: dict, team: dict, members: list[dict]) -> bool:
    review = team_review_state(team, members)
    return (
        team.get("isQuotaConfirmed") is True
        and team_quota(state, team, members)["eligible"]
        and all(
            review[field]["status"] == "approved"
            for field in ("name", "group", "flag", "description", "members")
        )
    )


def dashboard(state: dict, user: dict) -> dict:
    team = team_for(state, user)
    members = [
        m for m in state.get("users", []) if team and m.get("teamId") == team.get("id")
    ]
    team_payload = deepcopy(team) if team else None
    if team_payload:
        team_payload["quota"] = team_quota(state, team, members)
        team_payload["isAdmitted"] = team_is_admitted(state, team, members)
    return {
        "user": public_user(user),
        "team": team_payload,
        "achievements": [
            item
            for item in state.get("achievements", [])
            if item.get("userId") == user.get("id")
        ],
        "notifications": list_notifications(state, user),
        "settings": state["settings"],
        "members": [team_member_user(member) for member in members],
    }


def owns_upload(state: dict, user: dict, url: str) -> bool:
    return bool(
        user
        and any(
            item.get("userId") == user.get("id") and item.get("url") == url
            for item in state.get("uploads", [])
        )
    )


def upload_usage(state: dict, user_id: str) -> tuple[int, int]:
    uploads = [
        item for item in state.get("uploads", []) if item.get("userId") == user_id
    ]
    total_bytes = sum(max(0, int(item.get("size") or 0)) for item in uploads)
    return len(uploads), total_bytes


def upload_quota_available(
    state: dict, user_id: str, max_count: int, max_bytes: int, next_size: int
) -> bool:
    count, total_bytes = upload_usage(state, user_id)
    return count < max_count and total_bytes + max(0, next_size) <= max_bytes
