"""Small typed views of JSONB entities used by repositories and tests."""

from typing import NotRequired, TypedDict


class UserEntity(TypedDict):
    id: str
    email: str
    role: str
    teamId: NotRequired[str | None]
    emailVerified: NotRequired[bool]


class TeamEntity(TypedDict):
    id: str
    group: str
    name: str
    captainId: NotRequired[str | None]
    inviteCode: NotRequired[str]
    isQuotaConfirmed: NotRequired[bool]


class ReviewEntity(TypedDict):
    status: str
    comment: str
    updatedAt: NotRequired[str | None]
