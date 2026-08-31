"""Participant read model used by participant/captain use cases."""

from typing import Any


class ParticipantContextService:
    """Build the small participant projection required by write use cases."""

    def __init__(self, store: Any) -> None:
        self.store = store

    async def load(self, user: dict) -> dict:
        state = {
            "settings": await self.store.get_settings(),
            "users": [user],
            "teams": [],
            "uploads": await self.store.get_user_uploads(user["id"]),
        }
        if user.get("teamId"):
            snapshot = await self.store.get_team_snapshot(user["teamId"])
            if snapshot:
                team, members, _ = snapshot
                state["teams"] = [team]
                state["users"] = members
                if not any(item.get("id") == user.get("id") for item in members):
                    state["users"].append(user)
        return state
