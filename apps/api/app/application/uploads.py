"""Application service for authenticated upload workflows."""

from typing import Any, AsyncIterable
from uuid import uuid4

from ..shared import domain


class UploadRuleViolation(Exception):
    def __init__(self, status_code: int, message: str, code: str):
        self.status_code = status_code
        self.message = message
        self.code = code
        super().__init__(message)


class UploadService:
    ALLOWED_KINDS = {"attachment", "video", "student-card"}

    def __init__(self, store: Any, file_storage: Any, config: Any):
        self.store = store
        self.file_storage = file_storage
        self.config = config

    async def stream(
        self,
        chunks: AsyncIterable[bytes],
        user: dict,
        name: str,
        content_type: str,
        kind: str,
        declared_size: int = 0,
    ) -> dict:
        self._validate_metadata(name, content_type, kind)
        uploads = await self.store.get_user_uploads(user["id"])
        if not self._quota_available(uploads, user["id"], declared_size):
            raise self._quota_error()
        uploaded = await self.file_storage.save_stream(
            chunks, name, content_type, self.config.max_upload_body
        )
        if not self._quota_available(uploads, user["id"], uploaded["size"]):
            await self.file_storage.delete(uploaded["url"])
            raise self._quota_error()
        record = {
            "id": str(uuid4()),
            "url": uploaded["url"],
            "userId": user["id"],
            "kind": kind,
            "size": uploaded["size"],
            "type": uploaded["type"],
            "status": "uploaded",
            "scanStatus": "clean",
            "createdAt": domain.now(),
        }
        await self.store.create_upload_atomic(record, user["id"])
        return uploaded

    async def create_intent(self, payload: dict, user: dict) -> dict:
        self._validate_metadata(
            payload["name"], payload["contentType"], payload["kind"]
        )
        uploads = await self.store.get_user_uploads(user["id"])
        if not self._quota_available(uploads, user["id"], payload["size"]):
            raise self._quota_error()
        return await self.file_storage.create_upload_intent(
            payload["name"],
            payload["contentType"],
            payload["size"],
            payload["kind"],
            user["id"],
        )

    async def complete(self, payload: dict, user: dict) -> dict:
        self._validate_metadata(
            payload["name"], payload["contentType"], payload["kind"]
        )
        uploaded = await self.file_storage.complete_upload(
            payload["uploadId"],
            payload["key"],
            payload["name"],
            payload["contentType"],
            payload["parts"],
            user["id"],
        )
        uploads = await self.store.get_user_uploads(user["id"])
        if not self._quota_available(uploads, user["id"], uploaded["size"]):
            await self.file_storage.delete(uploaded["url"])
            raise self._quota_error()
        record = {
            "id": str(uuid4()),
            "url": uploaded["url"],
            "userId": user["id"],
            "kind": payload["kind"],
            "size": uploaded["size"],
            "storageKey": uploaded["key"],
            "status": "uploaded",
            "scanStatus": "pending",
            "createdAt": domain.now(),
        }
        await self.store.create_upload_atomic(record, user["id"])
        return {
            **uploaded,
            "status": record["status"],
            "scanStatus": record["scanStatus"],
        }

    async def registration_stream(
        self, chunks: AsyncIterable[bytes], name: str, content_type: str, owner: str
    ) -> dict:
        self._validate_metadata(name, content_type, "student-card")
        self._validate_registration_image(content_type)
        uploaded = await self.file_storage.save_stream(
            chunks, name, content_type, 5 * 1024 * 1024
        )
        if not uploaded["type"].startswith("image/"):
            await self.file_storage.delete(uploaded["url"])
            raise UploadRuleViolation(
                422,
                "Прикрепите фотографию в формате изображения.",
                "UPLOAD_IMAGE_REQUIRED",
            )
        return uploaded

    async def registration_intent(self, payload: dict, owner: str) -> dict:
        if payload["kind"] != "student-card":
            raise UploadRuleViolation(
                422, "Для регистрации нужен файл изображения.", "UPLOAD_IMAGE_REQUIRED"
            )
        self._validate_metadata(payload["name"], payload["contentType"], "student-card")
        self._validate_registration_image(payload["contentType"])
        if payload["size"] > 5 * 1024 * 1024:
            raise UploadRuleViolation(
                413, "Размер фотографии не должен превышать 5 МБ.", "UPLOAD_TOO_LARGE"
            )
        return await self.file_storage.create_upload_intent(
            payload["name"],
            payload["contentType"],
            payload["size"],
            "student-card",
            owner,
        )

    async def registration_complete(self, payload: dict, owner: str) -> dict:
        if payload["kind"] != "student-card":
            raise UploadRuleViolation(
                422, "Для регистрации нужен файл изображения.", "UPLOAD_IMAGE_REQUIRED"
            )
        self._validate_metadata(payload["name"], payload["contentType"], "student-card")
        self._validate_registration_image(payload["contentType"])
        return await self.file_storage.complete_upload(
            payload["uploadId"],
            payload["key"],
            payload["name"],
            payload["contentType"],
            payload["parts"],
            owner,
        )

    def _quota_available(
        self, uploads: list[dict], user_id: str, next_size: int
    ) -> bool:
        return domain.upload_quota_available(
            {"uploads": uploads},
            user_id,
            self.config.max_uploads_per_user,
            self.config.max_upload_bytes_per_user,
            next_size,
        )

    def _validate_metadata(self, name: str, content_type: str, kind: str) -> None:
        if kind not in self.ALLOWED_KINDS:
            raise UploadRuleViolation(
                422, "Недопустимый тип загрузки.", "INVALID_UPLOAD_KIND"
            )
        if not name or not content_type:
            raise UploadRuleViolation(
                422, "Не указаны имя и тип файла.", "INVALID_UPLOAD_METADATA"
            )

    @staticmethod
    def _validate_registration_image(content_type: str) -> None:
        if not content_type.startswith("image/"):
            raise UploadRuleViolation(
                422, "Для регистрации нужен файл изображения.", "UPLOAD_IMAGE_REQUIRED"
            )

    @staticmethod
    def _quota_error() -> UploadRuleViolation:
        return UploadRuleViolation(
            413,
            "Достигнут лимит количества или общего размера файлов.",
            "UPLOAD_QUOTA_EXCEEDED",
        )
