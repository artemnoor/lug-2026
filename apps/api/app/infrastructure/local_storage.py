"""Encrypted local upload storage for development and controlled staging."""

import asyncio
import secrets
from hashlib import sha256
from pathlib import Path
from typing import Any

from ..http.errors import ApiError
from ..security.encryption import LOCAL_UPLOAD_MAGIC, decrypt_bytes, encrypt_bytes
from .file_storage import (
    ALLOWED_TYPES,
    EXTENSIONS_BY_TYPE,
    _has_magic,
    resolve_filename,
    scan_file,
)


class LocalFileStorage:
    provider = "local"

    def __init__(
        self,
        upload_dir: Path,
        scan_command: str = "",
        scan_required: bool = False,
        encryption_key: bytes | None = None,
    ) -> None:
        self.upload_dir = upload_dir
        self.scan_command = scan_command
        self.scan_required = scan_required
        self.encryption_key = encryption_key
        upload_dir.mkdir(parents=True, exist_ok=True)

    async def save_stream(
        self, chunks: Any, original_name: str, content_type: str, max_bytes: int
    ) -> dict[str, Any]:
        """Persist a raw request stream without materialising the request body."""
        content_type = str(content_type or "").lower().strip()
        extension = Path(original_name).suffix.lower()
        if content_type not in ALLOWED_TYPES or extension not in EXTENSIONS_BY_TYPE.get(
            content_type, set()
        ):
            raise ApiError(422, "Расширение файла не соответствует его типу.")
        filename = f"{sha256(secrets.token_bytes(32)).hexdigest()}{extension}"
        temporary = self.upload_dir / f".{filename}.{secrets.token_hex(8)}.part"
        target = self.upload_dir / filename
        total = 0
        prefix = bytearray()
        try:
            with temporary.open("xb") as handle:
                async for chunk in chunks:
                    if not isinstance(chunk, bytes):
                        raise ApiError(400, "Некорректный поток загрузки.")
                    total += len(chunk)
                    if total > max_bytes:
                        raise ApiError(413, "Размер файла превышает допустимый лимит.")
                    if len(prefix) < 64:
                        prefix.extend(chunk[: 64 - len(prefix)])
                    handle.write(chunk)
            if not total or not _has_magic(content_type, bytes(prefix)):
                raise ApiError(422, "Файл не прошёл проверку содержимого.")
            await asyncio.to_thread(
                scan_file, temporary, self.scan_command, self.scan_required
            )
            if self.encryption_key:
                data = await asyncio.to_thread(temporary.read_bytes)
                stored = await asyncio.to_thread(
                    encrypt_bytes, data, self.encryption_key, filename.encode("ascii")
                )
                await asyncio.to_thread(target.write_bytes, stored)
                temporary.unlink(missing_ok=True)
            else:
                temporary.replace(target)
        except FileExistsError as exc:
            raise ApiError(
                500, "Не удалось сохранить файл. Повторите попытку."
            ) from exc
        except OSError as exc:
            raise ApiError(
                500, "Не удалось сохранить файл. Повторите попытку."
            ) from exc
        finally:
            temporary.unlink(missing_ok=True)
        return {
            "url": f"/uploads/{filename}",
            "name": original_name,
            "type": content_type,
            "size": total,
        }

    async def create_upload_intent(
        self, name: str, content_type: str, size: int, kind: str, owner_id: str = ""
    ) -> dict[str, Any]:
        raise ApiError(
            501, "Direct multipart upload доступен только для object storage."
        )

    async def complete_upload(
        self,
        upload_id: str,
        key: str,
        name: str,
        content_type: str,
        parts: list[dict[str, Any]],
        owner_id: str = "",
    ) -> dict[str, Any]:
        raise ApiError(
            501, "Direct multipart upload доступен только для object storage."
        )

    def resolve(self, url_path: str) -> dict[str, Any] | None:
        filename = resolve_filename(url_path)
        if not filename:
            return None
        return {"url": f"/uploads/{filename}", "path": self.upload_dir / filename}

    async def exists(self, resolved: dict[str, Any]) -> bool:
        return await asyncio.to_thread(resolved["path"].is_file)

    async def read(self, resolved: dict[str, Any]) -> bytes:
        return await asyncio.to_thread(self._read_sync, resolved)

    async def download_to_file(self, resolved: dict[str, Any], target: Path) -> None:
        data = await self.read(resolved)
        await asyncio.to_thread(target.write_bytes, data)

    def _read_sync(self, resolved: dict[str, Any]) -> bytes:
        data = resolved["path"].read_bytes()
        if not data.startswith(LOCAL_UPLOAD_MAGIC):
            if self.encryption_key:
                raise ApiError(503, "Файл не зашифрован или повреждён.")
            return data
        if not self.encryption_key:
            raise ApiError(503, "Не настроен ключ расшифровки файла.")
        try:
            return decrypt_bytes(
                data,
                self.encryption_key,
                Path(resolved["url"]).name.encode("ascii"),
            )
        except ValueError as exc:
            raise ApiError(503, "Файл не прошёл проверку целостности.") from exc

    async def signed_url(self, resolved: dict[str, Any]) -> str | None:
        return None

    async def delete(self, url_path: str) -> None:
        resolved = self.resolve(url_path)
        if resolved:
            await asyncio.to_thread(resolved["path"].unlink, missing_ok=True)

    def health(self) -> dict[str, str]:
        return {
            "provider": self.provider,
            "uploadDir": str(self.upload_dir),
            "encryption": "AES-256-GCM" if self.encryption_key else "disabled",
        }

    async def ready(self) -> bool:
        return True

    async def cleanup_orphans(
        self, referenced_urls: set[str], grace_seconds: int = 3600
    ) -> int:
        from time import time

        cutoff = time() - max(0, grace_seconds)

        def remove() -> int:
            removed = 0
            for path in self.upload_dir.iterdir():
                if not path.is_file() or not resolve_filename(f"/uploads/{path.name}"):
                    continue
                if (
                    f"/uploads/{path.name}" in referenced_urls
                    or path.stat().st_mtime > cutoff
                ):
                    continue
                path.unlink(missing_ok=True)
                removed += 1
            return removed

        return await asyncio.to_thread(remove)
