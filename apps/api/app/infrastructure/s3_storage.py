"""Private S3-compatible object storage adapter with short-lived signed URLs."""

import asyncio
import secrets
from hashlib import sha256
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any

from ..http.errors import ApiError
from .file_storage import decode_upload, resolve_filename, scan_file


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

    async def save(self, data_url: str, original_name: str) -> dict[str, Any]:
        return await asyncio.to_thread(self._save_sync, data_url, original_name)

    def _save_sync(self, data_url: str, original_name: str) -> dict[str, Any]:
        data, content_type, extension = decode_upload(data_url, original_name)
        filename = f"{sha256(secrets.token_bytes(32)).hexdigest()}{extension}"
        key = f"{self.prefix}/{filename}"
        temporary = None
        try:
            with NamedTemporaryFile(
                mode="wb", suffix=extension, dir=self.temp_dir, delete=False
            ) as handle:
                temporary = Path(handle.name)
                handle.write(data)
            scan_file(temporary, self.scan_command, self.scan_required)
            put_options = {
                "Bucket": self.bucket,
                "Key": key,
                "Body": data,
                "ContentType": content_type,
                "Metadata": {"original-extension": extension[1:]},
                "ServerSideEncryption": self.server_side_encryption,
            }
            if self.server_side_encryption == "aws:kms":
                put_options["SSEKMSKeyId"] = self.kms_key_id
            self.client.put_object(**put_options)
        except ApiError:
            raise
        except Exception as exc:
            raise ApiError(503, "Файл временно нельзя сохранить в object storage.") from exc
        finally:
            if temporary:
                temporary.unlink(missing_ok=True)
        return {
            "url": f"/uploads/{filename}",
            "name": original_name,
            "type": content_type,
            "size": len(data),
        }

    @staticmethod
    def estimate_size(data_url: str) -> int:
        from .local_storage import LocalFileStorage

        return LocalFileStorage.estimate_size(data_url)

    def resolve(self, url_path: str) -> dict[str, Any] | None:
        filename = resolve_filename(url_path)
        if not filename:
            return None
        return {"url": f"/uploads/{filename}", "key": f"{self.prefix}/{filename}"}

    async def exists(self, resolved: dict[str, Any]) -> bool:
        return await asyncio.to_thread(self._exists_sync, resolved["key"])

    async def read(self, resolved: dict[str, Any]) -> bytes:
        return await asyncio.to_thread(self._read_sync, resolved["key"])

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

    async def cleanup_orphans(self, referenced_urls: set[str], grace_seconds: int = 3600) -> int:
        return await asyncio.to_thread(self._cleanup_sync, referenced_urls, grace_seconds)

    def _cleanup_sync(self, referenced_urls: set[str], grace_seconds: int) -> int:
        from datetime import datetime, timezone

        cutoff = datetime.now(timezone.utc).timestamp() - max(0, grace_seconds)
        pages = self.client.get_paginator("list_objects_v2").paginate(
            Bucket=self.bucket, Prefix=f"{self.prefix}/"
        )
        objects = [item for page in pages for item in page.get("Contents", [])]
        deleted = 0
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
