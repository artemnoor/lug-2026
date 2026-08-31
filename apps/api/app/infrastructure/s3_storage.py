"""Private S3-compatible object storage adapter with short-lived signed URLs."""

import asyncio
import json
from pathlib import Path
from typing import Any

from ..http.errors import ApiError
from .file_storage import (
    ALLOWED_TYPES,
    EXTENSIONS_BY_TYPE,
    resolve_filename,
)


class S3FileStorage:
    provider = "s3"

    def __init__(
        self,
        bucket: str,
        region: str,
        endpoint_url: str,
        access_key: str,
        secret_key: str,
        prefix: str,
        signed_url_ttl: int,
        temp_dir: Path,
        server_side_encryption: str = "AES256",
        kms_key_id: str = "",
        scan_command: str = "",
        scan_required: bool = False,
        intent_redis_url: str = "",
    ) -> None:
        import boto3

        self.bucket = bucket
        self.prefix = prefix.strip("/") or "uploads"
        self.signed_url_ttl = signed_url_ttl
        self.server_side_encryption = server_side_encryption
        self.kms_key_id = kms_key_id
        self.temp_dir = temp_dir
        self.scan_command = scan_command
        self.scan_required = scan_required
        self._multipart_intents: dict[str, dict[str, Any]] = {}
        self._intent_redis = None
        if intent_redis_url:
            import redis

            self._intent_redis = redis.Redis.from_url(
                intent_redis_url, decode_responses=True, socket_timeout=5
            )
        client_options = {
            "region_name": region or None,
            "endpoint_url": endpoint_url or None,
            "aws_access_key_id": access_key or None,
            "aws_secret_access_key": secret_key or None,
        }
        if endpoint_url:
            from botocore.client import Config

            client_options["config"] = Config(
                signature_version="s3v4", s3={"addressing_style": "path"}
            )
        self.client = boto3.client(
            "s3",
            **client_options,
        )
        temp_dir.mkdir(parents=True, exist_ok=True)

    async def save_stream(
        self, chunks: Any, original_name: str, content_type: str, max_bytes: int
    ) -> dict[str, Any]:
        raise ApiError(
            501, "Для object storage используйте presigned multipart upload."
        )

    async def create_upload_intent(
        self, name: str, content_type: str, size: int, kind: str, owner_id: str = ""
    ) -> dict[str, Any]:
        return await asyncio.to_thread(
            self._create_upload_intent_sync, name, content_type, size, kind, owner_id
        )

    def _create_upload_intent_sync(
        self, name: str, content_type: str, size: int, kind: str, owner_id: str
    ) -> dict[str, Any]:
        from uuid import uuid4

        content_type = content_type.strip().lower()
        extension = Path(name).suffix.lower()
        max_size = (
            50 * 1024 * 1024 if content_type.startswith("video/") else 5 * 1024 * 1024
        )
        if content_type not in ALLOWED_TYPES or extension not in EXTENSIONS_BY_TYPE.get(
            content_type, set()
        ):
            raise ApiError(422, "Расширение файла не соответствует его типу.")
        if size > max_size:
            raise ApiError(413, "Размер файла превышает допустимый лимит.")
        key = f"{self.prefix}/{uuid4().hex}{extension}"
        try:
            options = {
                "Bucket": self.bucket,
                "Key": key,
                "ContentType": content_type,
                "Metadata": {"original-name": name[:200], "upload-kind": kind[:32]},
            }
            if self.server_side_encryption:
                options["ServerSideEncryption"] = self.server_side_encryption
            if self.server_side_encryption == "aws:kms":
                options["SSEKMSKeyId"] = self.kms_key_id
            result = self.client.create_multipart_upload(**options)
            upload_id = result["UploadId"]
            intent = {
                "key": key,
                "name": name,
                "contentType": content_type,
                "size": size,
                "ownerId": owner_id,
            }
            self._store_intent(upload_id, intent)
            part_size = max(5 * 1024 * 1024, min(16 * 1024 * 1024, size))
            part_count = (size + part_size - 1) // part_size
            parts = [
                {
                    "partNumber": part,
                    "url": self.client.generate_presigned_url(
                        "upload_part",
                        Params={
                            "Bucket": self.bucket,
                            "Key": key,
                            "UploadId": upload_id,
                            "PartNumber": part,
                        },
                        ExpiresIn=900,
                    ),
                }
                for part in range(1, part_count + 1)
            ]
            return {
                "uploadId": upload_id,
                "key": key,
                "partSize": part_size,
                "parts": parts,
                "expiresIn": 900,
            }
        except Exception as exc:
            raise ApiError(
                503, "Не удалось подготовить загрузку в object storage."
            ) from exc

    async def complete_upload(
        self,
        upload_id: str,
        key: str,
        name: str,
        content_type: str,
        parts: list[dict[str, Any]],
        owner_id: str = "",
    ) -> dict[str, Any]:
        return await asyncio.to_thread(
            self._complete_upload_sync,
            upload_id,
            key,
            name,
            content_type,
            parts,
            owner_id,
        )

    def _complete_upload_sync(
        self,
        upload_id: str,
        key: str,
        name: str,
        content_type: str,
        parts: list[dict[str, Any]],
        owner_id: str,
    ) -> dict[str, Any]:
        intent = self._load_intent(upload_id)
        try:
            if (
                not intent
                or intent["key"] != key
                or intent["name"] != name
                or intent["contentType"] != content_type
                or intent["ownerId"] != owner_id
            ):
                raise ValueError("unknown or mismatched upload intent")
            if (
                not key.startswith(f"{self.prefix}/")
                or len(key) > len(self.prefix) + 80
            ):
                raise ValueError("invalid object key")
            normalized_parts = [
                {"PartNumber": int(part["partNumber"]), "ETag": str(part["etag"])}
                for part in parts
            ]
            if not normalized_parts or [
                part["PartNumber"] for part in normalized_parts
            ] != list(range(1, len(normalized_parts) + 1)):
                raise ValueError("multipart parts are required")
            self.client.complete_multipart_upload(
                Bucket=self.bucket,
                Key=key,
                UploadId=upload_id,
                MultipartUpload={"Parts": normalized_parts},
            )
            head = self.client.head_object(Bucket=self.bucket, Key=key)
            if int(head.get("ContentLength", 0)) != int(intent["size"]):
                raise ValueError("uploaded size does not match intent")
            self._delete_intent(upload_id)
            filename = key.rsplit("/", 1)[-1]
            return {
                "url": f"/uploads/{filename}",
                "key": key,
                "name": name,
                "type": head.get("ContentType", content_type),
                "size": int(head.get("ContentLength", 0)),
            }
        except Exception as exc:
            if intent and intent.get("key") == key:
                try:
                    self.client.abort_multipart_upload(
                        Bucket=self.bucket, Key=key, UploadId=upload_id
                    )
                except Exception:
                    pass
                self._delete_intent(upload_id)
            raise ApiError(
                422, "Загрузка файла не завершена или недействительна."
            ) from exc

    def _intent_key(self, upload_id: str) -> str:
        return f"lug:upload-intent:{upload_id}"

    def _store_intent(self, upload_id: str, intent: dict[str, Any]) -> None:
        if self._intent_redis is not None:
            self._intent_redis.set(
                self._intent_key(upload_id), json.dumps(intent), ex=900
            )
            return
        self._multipart_intents[upload_id] = intent

    def _load_intent(self, upload_id: str) -> dict[str, Any] | None:
        if self._intent_redis is not None:
            value = self._intent_redis.get(self._intent_key(upload_id))
            if not value:
                return None
            try:
                parsed = json.loads(value)
            except (TypeError, ValueError):
                return None
            return parsed if isinstance(parsed, dict) else None
        return self._multipart_intents.get(upload_id)

    def _delete_intent(self, upload_id: str) -> None:
        if self._intent_redis is not None:
            self._intent_redis.delete(self._intent_key(upload_id))
        self._multipart_intents.pop(upload_id, None)

    def resolve(self, url_path: str) -> dict[str, Any] | None:
        filename = resolve_filename(url_path)
        if not filename:
            return None
        return {"url": f"/uploads/{filename}", "key": f"{self.prefix}/{filename}"}

    async def exists(self, resolved: dict[str, Any]) -> bool:
        return await asyncio.to_thread(self._exists_sync, resolved["key"])

    async def read(self, resolved: dict[str, Any]) -> bytes:
        return await asyncio.to_thread(self._read_sync, resolved["key"])

    async def download_to_file(self, resolved: dict[str, Any], target: Path) -> None:
        await asyncio.to_thread(self._download_to_file_sync, resolved["key"], target)

    def _download_to_file_sync(self, key: str, target: Path) -> None:
        try:
            self.client.download_file(self.bucket, key, str(target))
        except Exception as exc:
            raise ApiError(503, "Object storage временно недоступно.") from exc

    def _read_sync(self, key: str) -> bytes:
        try:
            return self.client.get_object(Bucket=self.bucket, Key=key)["Body"].read()
        except Exception as exc:
            raise ApiError(503, "Object storage временно недоступно.") from exc

    def _exists_sync(self, key: str) -> bool:
        from botocore.exceptions import ClientError

        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
            return True
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in {"404", "NoSuchKey"}:
                return False
            raise ApiError(503, "Object storage временно недоступно.") from exc
        except Exception as exc:
            raise ApiError(503, "Object storage временно недоступно.") from exc

    async def signed_url(self, resolved: dict[str, Any]) -> str:
        try:
            return await asyncio.to_thread(
                self.client.generate_presigned_url,
                "get_object",
                Params={"Bucket": self.bucket, "Key": resolved["key"]},
                ExpiresIn=self.signed_url_ttl,
            )
        except Exception as exc:
            raise ApiError(503, "Object storage временно недоступно.") from exc

    async def delete(self, url_path: str) -> None:
        resolved = self.resolve(url_path)
        if resolved:
            try:
                await asyncio.to_thread(
                    self.client.delete_object, Bucket=self.bucket, Key=resolved["key"]
                )
            except Exception as exc:
                raise ApiError(503, "Object storage временно недоступно.") from exc

    async def ready(self) -> bool:
        return await asyncio.to_thread(self._ready_sync)

    async def cleanup_orphans(
        self, referenced_urls: set[str], grace_seconds: int = 3600
    ) -> int:
        return await asyncio.to_thread(
            self._cleanup_sync, referenced_urls, grace_seconds
        )

    def _cleanup_sync(self, referenced_urls: set[str], grace_seconds: int) -> int:
        from datetime import datetime, timezone

        cutoff = datetime.now(timezone.utc).timestamp() - max(0, grace_seconds)
        aborted = 0
        multipart_pages = self.client.get_paginator("list_multipart_uploads").paginate(
            Bucket=self.bucket, Prefix=f"{self.prefix}/"
        )
        for page in multipart_pages:
            for upload in page.get("Uploads", []):
                initiated = upload.get("Initiated")
                if initiated and initiated.timestamp() <= cutoff:
                    self.client.abort_multipart_upload(
                        Bucket=self.bucket,
                        Key=upload.get("Key", ""),
                        UploadId=upload["UploadId"],
                    )
                    aborted += 1
        pages = self.client.get_paginator("list_objects_v2").paginate(
            Bucket=self.bucket, Prefix=f"{self.prefix}/"
        )
        objects = [item for page in pages for item in page.get("Contents", [])]
        deleted = aborted
        for item in objects:
            key = item.get("Key", "")
            filename = key.removeprefix(f"{self.prefix}/")
            if not filename or f"/uploads/{filename}" in referenced_urls:
                continue
            modified = item.get("LastModified")
            if modified and modified.timestamp() > cutoff:
                continue
            self.client.delete_object(Bucket=self.bucket, Key=key)
            deleted += 1
        return deleted

    def _ready_sync(self) -> bool:
        try:
            self.client.head_bucket(Bucket=self.bucket)
            return True
        except Exception as exc:
            raise RuntimeError("S3 bucket is not reachable") from exc

    def health(self) -> dict[str, Any]:
        return {
            "provider": self.provider,
            "bucket": self.bucket,
            "prefix": self.prefix,
            "signedUrlTtl": self.signed_url_ttl,
            "serverSideEncryption": self.server_side_encryption,
        }
