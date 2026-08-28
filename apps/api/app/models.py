"""Pydantic request models for public authentication flows."""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class FlexibleModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LoginPayload(FlexibleModel):
    email: str = Field("", max_length=254)
    password: str = Field("", max_length=256)


class RegisterTeamPayload(FlexibleModel):
    fio: str = Field("", max_length=200)
    group: str = Field("", max_length=100)
    teamName: str = Field("", max_length=200)
    email: str = Field("", max_length=254)
    phone: str = Field("", max_length=32)
    messenger: str = Field("", max_length=32)
    messengerContact: str = Field("", max_length=128)
    messengerContacts: dict[str, str] = Field(default_factory=dict)
    telegramAccount: str = Field("", max_length=128)
    password: str = Field("", max_length=256)
    studentCardFile: str = Field("", max_length=12 * 1024 * 1024)
    studentCardFileName: str = Field("student-card", max_length=255)
    totalStudentsInGroup: Any = None
    consent: bool = False


class JoinTeamPayload(RegisterTeamPayload):
    inviteCode: str = Field("", max_length=80)


class EmailVerificationPayload(FlexibleModel):
    verificationId: str = Field("", max_length=80)
    code: str = Field("", min_length=6, max_length=6, pattern=r"\d{6}")


class ResendEmailVerificationPayload(FlexibleModel):
    verificationId: str = Field("", max_length=80)


class UploadPayload(FlexibleModel):
    data: str = Field("", max_length=96 * 1024 * 1024)
    name: str = Field("", max_length=255)


class AchievementPayload(FlexibleModel):
    title: str = Field("", max_length=200)
    direction: str = Field("", max_length=32)
    category: str = Field("", max_length=120)
    fileUrl: str = Field("", max_length=255)
    details: str = Field("", max_length=2000)
    fileName: str = Field("Документ", max_length=255)


class ReviewPayload(FlexibleModel):
    status: str = Field("", max_length=32)
    comment: str = Field("", max_length=2000)
    points: Any = None
    reviewStage: str = "received"
    criteriaScores: dict[str, Any] = Field(default_factory=dict)


def model_payload(model: BaseModel) -> dict[str, Any]:
    return model.model_dump(exclude_none=False)
