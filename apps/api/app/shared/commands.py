"""Typed domain commands crossing HTTP and persistence boundaries."""

from dataclasses import dataclass
from dataclasses import field as dataclass_field
from typing import Any


@dataclass(frozen=True, slots=True)
class ReviewCommand:
    status: str
    comment: str = ""
    field: str = ""
    points: float | None = None
    review_stage: str = "received"
    criteria_scores: dict[str, Any] = dataclass_field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class SettingsPatch:
    values: dict[str, Any]

    def as_dict(self) -> dict[str, Any]:
        return dict(self.values)


@dataclass(frozen=True, slots=True)
class QuotaCommand:
    team_id: str
    confirmed: bool


@dataclass(frozen=True, slots=True)
class RegistrationCommand:
    """Validated registration input kept out of the HTTP request object."""

    values: dict[str, Any]

    def as_mapping(self) -> dict[str, Any]:
        return dict(self.values)
