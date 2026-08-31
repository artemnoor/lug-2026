"""Pydantic request models for public authentication flows."""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator


class FlexibleModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LoginPayload(FlexibleModel):
    email: str = Field("", max_length=254)
    password: str = Field("", max_length=256)


class PasswordResetRequestPayload(FlexibleModel):
    email: str = Field("", max_length=254)


class PasswordResetPayload(FlexibleModel):
    email: str = Field("", max_length=254)
    code: str = Field("", min_length=6, max_length=6, pattern=r"\d{6}")
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
    studentCardUploadToken: str = Field("", max_length=512)
    studentCardSize: int = Field(0, ge=0, le=250 * 1024 * 1024)
    studentCardType: str = Field("", max_length=160)
    totalStudentsInGroup: int | str | None = None
    consent: bool = False

    @field_validator("totalStudentsInGroup", mode="before")
    @classmethod
    def normalize_group_size(cls, value):
        if value is None or value == "":
            return None
        if isinstance(value, str) and len(value) > 8:
            raise ValueError("Количество студентов имеет слишком большую длину.")
        try:
            number = int(value)
        except (TypeError, ValueError) as exc:
            raise ValueError("Количество студентов должно быть целым числом.") from exc
        if number <= 0:
            raise ValueError("Количество студентов должно быть больше нуля.")
        return number


class JoinTeamPayload(RegisterTeamPayload):
    inviteCode: str = Field("", max_length=80)


class EmailVerificationPayload(FlexibleModel):
    verificationId: str = Field("", max_length=80)
    code: str = Field("", min_length=6, max_length=6, pattern=r"\d{6}")


class ResendEmailVerificationPayload(FlexibleModel):
    verificationId: str = Field("", max_length=80)


class UploadIntentPayload(FlexibleModel):
    name: str = Field("", min_length=1, max_length=255)
    contentType: str = Field("", min_length=1, max_length=160)
    size: int = Field(..., gt=0, le=250 * 1024 * 1024)
    kind: str = Field("attachment", max_length=32)


class UploadCompletePayload(FlexibleModel):
    uploadId: str = Field(..., min_length=1, max_length=200)
    key: str = Field(..., min_length=1, max_length=500)
    name: str = Field("", min_length=1, max_length=255)
    contentType: str = Field("", min_length=1, max_length=160)
    kind: str = Field("attachment", max_length=32)
    parts: list[dict[str, int | str]] = Field(default_factory=list, max_length=10000)
    registrationToken: str = Field("", max_length=512)


class AchievementPayload(FlexibleModel):
    title: str = Field("", max_length=200)
    direction: str = Field("", max_length=32)
    category: str = Field("", max_length=120)
    fileUrl: str = Field("", max_length=255)
    details: str = Field("", max_length=2000)
    fileName: str = Field("Документ", max_length=255)


class ReviewPayload(FlexibleModel):
    field: str = Field("", max_length=32)
    status: str = Field("", max_length=32)
    comment: str = Field("", max_length=2000)
    points: float | None = Field(None, ge=0, le=100)
    reviewStage: str = "received"
    criteriaScores: dict[str, float] = Field(default_factory=dict)


def model_payload(model: BaseModel) -> dict[str, Any]:
    return model.model_dump(exclude_none=False)
