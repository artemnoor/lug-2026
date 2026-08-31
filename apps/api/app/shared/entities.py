"""Typed internal views used between use cases and persistence adapters."""

from dataclasses import dataclass, field
from typing import Any, Mapping


@dataclass(frozen=True, slots=True)
class UserModel:
    """Canonical user view with compatibility fields kept in ``values``."""

    id: str
    email: str = ""
    role: str = "participant"
    team_id: str | None = None
    email_verified: bool = False
    values: Mapping[str, Any] = field(default_factory=dict)

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "UserModel":
        return cls(
            id=str(value.get("id") or ""),
            email=str(value.get("email") or ""),
            role=str(value.get("role") or "participant"),
            team_id=value.get("teamId"),
            email_verified=value.get("emailVerified") is True,
            values=dict(value),
        )

    def as_mapping(self) -> dict[str, Any]:
        return {
            **self.values,
            "id": self.id,
            "email": self.email,
            "role": self.role,
            "teamId": self.team_id,
            "emailVerified": self.email_verified,
        }


@dataclass(frozen=True, slots=True)
class TeamModel:
    """Canonical team view with compatibility fields kept in ``values``."""

    id: str
    group: str = ""
    name: str = ""
    values: Mapping[str, Any] = field(default_factory=dict)

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "TeamModel":
        return cls(
            id=str(value.get("id") or ""),
            group=str(value.get("group") or ""),
            name=str(value.get("name") or ""),
            values=dict(value),
        )

    def as_mapping(self) -> dict[str, Any]:
        return {**self.values, "id": self.id, "group": self.group, "name": self.name}


@dataclass(frozen=True, slots=True)
class ParticipantState:
    """The bounded read model required by participant mutations."""

    settings: Mapping[str, Any]
    users: tuple[UserModel, ...]
    teams: tuple[TeamModel, ...]
    uploads: tuple["UploadedFile", ...]

    def as_mapping(self) -> dict[str, Any]:
        """Compatibility view for legacy domain functions during migration."""

        return {
            "settings": dict(self.settings),
            "users": [user.as_mapping() for user in self.users],
            "teams": [team.as_mapping() for team in self.teams],
            "uploads": [upload.as_mapping() for upload in self.uploads],
        }


@dataclass(frozen=True, slots=True)
class UploadedFile:
    url: str
    size: int
    content_type: str = ""
    storage_key: str = ""
    values: Mapping[str, Any] = field(default_factory=dict)

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "UploadedFile":
        return cls(
            url=str(value.get("url") or ""),
            size=int(value.get("size") or 0),
            content_type=str(value.get("type") or value.get("contentType") or ""),
            storage_key=str(value.get("storageKey") or value.get("key") or ""),
            values=dict(value),
        )

    def as_mapping(self) -> dict[str, Any]:
        return {
            **self.values,
            "url": self.url,
            "size": self.size,
            "type": self.content_type,
            "storageKey": self.storage_key,
        }
