"""Encrypted local upload storage for development and controlled staging."""

import asyncio
import re
import secrets
from hashlib import sha256
from pathlib import Path
from typing import Any

from ..http.errors import ApiError
from ..security.encryption import LOCAL_UPLOAD_MAGIC, decrypt_bytes, encrypt_bytes
from .file_storage import decode_upload, resolve_filename, scan_file


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

    async def save(self, data_url: str, original_name: str) -> dict[str, Any]:
        return await asyncio.to_thread(self._save_sync, data_url, original_name)

    def _save_sync(self, data_url: str, original_name: str) -> dict[str, str]:
        data, content_type, extension = decode_upload(data_url, original_name)
        filename = f"{sha256(secrets.token_bytes(32)).hexdigest()}{extension}"
        target = self.upload_dir / filename
        temporary = self.upload_dir / f".{filename}.{secrets.token_hex(8)}.part"
        encrypted_temporary = self.upload_dir / f".{filename}.{secrets.token_hex(8)}.enc"
        try:
            with temporary.open("xb") as handle:
                handle.write(data)
            scan_file(temporary, self.scan_command, self.scan_required)
            stored = (
                encrypt_bytes(data, self.encryption_key, filename.encode("ascii"))
                if self.encryption_key
                else data
            )
            with encrypted_temporary.open("xb") as handle:
                handle.write(stored)
            encrypted_temporary.replace(target)
        except FileExistsError:
            raise ApiError(500, "Не удалось сохранить файл. Повторите попытку.")
        except OSError as exc:
            raise ApiError(500, "Не удалось сохранить файл. Повторите попытку.") from exc
        finally:
            temporary.unlink(missing_ok=True)
            encrypted_temporary.unlink(missing_ok=True)
        return {
            "url": f"/uploads/{filename}",
            "name": original_name,
            "type": content_type,
            "size": len(data),
        }

    @staticmethod
    def estimate_size(data_url: str) -> int:
        match = re.fullmatch(r"data:([^;]+);base64,(.+)", str(data_url or ""))
        if not match:
            return 0
        encoded = match.group(2)
        padding = len(encoded) - len(encoded.rstrip("="))
        return max(0, (len(encoded) * 3) // 4 - padding)

    def resolve(self, url_path: str) -> dict[str, Any] | None:
        filename = resolve_filename(url_path)
        if not filename:
            return None
        return {"url": f"/uploads/{filename}", "path": self.upload_dir / filename}

    async def exists(self, resolved: dict[str, Any]) -> bool:
        return await asyncio.to_thread(resolved["path"].is_file)

    async def read(self, resolved: dict[str, Any]) -> bytes:
        return await asyncio.to_thread(self._read_sync, resolved)

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

    async def cleanup_orphans(self, referenced_urls: set[str], grace_seconds: int = 3600) -> int:
        from time import time

        cutoff = time() - max(0, grace_seconds)

        def remove() -> int:
            removed = 0
            for path in self.upload_dir.iterdir():
                if not path.is_file() or not resolve_filename(f"/uploads/{path.name}"):
                    continue
                if f"/uploads/{path.name}" in referenced_urls or path.stat().st_mtime > cutoff:
                    continue
                path.unlink(missing_ok=True)
                removed += 1
            return removed

        return await asyncio.to_thread(remove)
