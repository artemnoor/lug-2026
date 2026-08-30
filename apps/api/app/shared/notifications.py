"""Shared participant notification delivery helpers."""

import asyncio
from collections.abc import Iterable
from typing import Any

from . import domain


def target_users(
    state: dict, target_type: str, target_id: str | None = None
) -> list[dict]:
    """Return non-admin users addressed by an organizer notification."""
    users = [user for user in state.get("users", []) if user.get("role") != "admin"]
    if target_type == "all":
        return users
    if target_type == "teams":
        return [user for user in users if user.get("teamId")]
    if target_type == "team":
        return [user for user in users if user.get("teamId") == target_id]
    if target_type == "user":
        return [user for user in users if user.get("id") == target_id]

    teams = state.get("teams", [])
    captain_ids = {
        team.get("captainId")
        for team in teams
        if target_type == "captains" or team.get("id") == target_id
    }
    return [user for user in users if user.get("id") in captain_ids]


def verified_email_recipients(users: Iterable[dict]) -> list[str]:
    """Deduplicate only verified, syntactically valid participant addresses."""
    recipients: list[str] = []
    for user in users:
        email = domain.normalize_email(user.get("email"))
        if user.get("emailVerified") is True and domain.valid_email(email):
            if email not in recipients:
                recipients.append(email)
    return recipients


def _masked_email(email: str) -> str:
    local, separator, host = email.partition("@")
    if not separator:
        return "***"
    return f"{local[:2]}***@{host}"


async def send_notification_emails(
    context: Any,
    users: Iterable[dict],
    title: str,
    message: str,
    max_concurrency: int = 8,
) -> dict[str, int]:
    """Deliver notification mail with bounded concurrency and per-recipient isolation."""
    recipients = verified_email_recipients(users)
    if not recipients:
        return {"eligible": 0, "sent": 0, "failed": 0}

    if hasattr(context.store, "enqueue_email"):
        queued = 0
        for recipient in recipients:
            try:
                await context.store.enqueue_email(
                    recipient, "notification", {"title": title, "message": message}
                )
                queued += 1
            except Exception as exc:
                context.logger.error(
                    "email.notification_queue_failed",
                    {"recipient": _masked_email(recipient), "error": exc},
                )
        return {"eligible": len(recipients), "sent": 0, "failed": len(recipients) - queued}

    semaphore = asyncio.Semaphore(max(1, min(max_concurrency, len(recipients))))

    async def deliver(recipient: str) -> bool:
        async with semaphore:
            try:
                await context.email_service.send_notification(recipient, title, message)
                return True
            except Exception as exc:
                context.logger.error(
                    "email.notification_failed",
                    {
                        "recipient": _masked_email(recipient),
                        "error": exc,
                    },
                )
                return False

    delivered = await asyncio.gather(*(deliver(recipient) for recipient in recipients))
    sent = sum(delivered)
    return {"eligible": len(recipients), "sent": sent, "failed": len(recipients) - sent}


async def notify_user_with_email(
    context: Any, state: dict, user_id: str | None, title: str, message: str
) -> dict[str, int]:
    """Persist the in-app notification and best-effort deliver its email copy."""
    domain.notify_user(state, user_id, title, message)
    users = [
        user
        for user in state.get("users", [])
        if user.get("id") == user_id and user.get("role") != "admin"
    ]
    return await send_notification_emails(context, users, title, message, max_concurrency=1)
