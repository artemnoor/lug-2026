"""Participant read model used by participant/captain use cases."""

from typing import Any, Mapping

from ..shared import domain
from ..shared.entities import ParticipantState, TeamModel, UploadedFile, UserModel
from .repositories import (
    ParticipantReadRepository,
    SettingsRepository,
    TeamRepository,
    UploadRepository,
)


class ParticipantContextService:
    """Build the small participant projection required by write use cases."""

    def __init__(
        self,
        settings: SettingsRepository,
        teams: TeamRepository | None = None,
        uploads: UploadRepository | None = None,
        reads: ParticipantReadRepository | None = None,
    ) -> None:
        # A one-argument form remains available for the compatibility tests and
        # for adapters that have not yet been split into physical repositories.
        self.settings = settings
        self.teams = teams or settings  # type: ignore[assignment]
        self.uploads = uploads or settings  # type: ignore[assignment]
        self.reads = reads or settings  # type: ignore[assignment]

    async def load(self, user: Mapping[str, Any]) -> ParticipantState:
        users = [UserModel.from_mapping(user)]
        teams: list[TeamModel] = []
        if user.get("teamId"):
            snapshot = await self.teams.get_team_snapshot(user["teamId"])
            if snapshot:
                team, members, _ = snapshot
                teams = [TeamModel.from_mapping(team)]
                users = [UserModel.from_mapping(member) for member in members]
                if not any(item.id == user.get("id") for item in users):
                    users.append(UserModel.from_mapping(user))
        return ParticipantState(
            settings=await self.settings.get_settings(),
            users=tuple(users),
            teams=tuple(teams),
            uploads=tuple(
                UploadedFile.from_mapping(item)
                for item in await self.uploads.get_user_uploads(user["id"])
            ),
        )

    async def dashboard(self, user: Mapping[str, Any]) -> dict | None:
        projection = await self.reads.get_dashboard_projection(user["id"])
        return (
            domain.dashboard(projection, dict(user)) if projection is not None else None
        )
