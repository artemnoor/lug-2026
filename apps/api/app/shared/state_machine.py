"""Explicit lifecycle transitions for reviewable domain entities."""

from typing import Any

REVIEW_STATUSES = {"pending", "approved", "rejected"}
REVIEW_TRANSITIONS = {
    "": REVIEW_STATUSES,
    "pending": REVIEW_STATUSES,
    "approved": {"pending", "approved", "rejected"},
    "rejected": {"pending", "approved", "rejected"},
}


def ensure_review_transition(current: Any, target: Any) -> None:
    current_status = str(current or "")
    target_status = str(target or "")
    if (
        target_status not in REVIEW_STATUSES
        or target_status not in REVIEW_TRANSITIONS.get(current_status, set())
    ):
        raise ValueError(
            f"Недопустимый переход review: {current_status or 'new'} → {target_status}."
        )
