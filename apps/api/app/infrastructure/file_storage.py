"""Validated local file storage with private URL resolution."""

import re
import socket
import struct
import subprocess
from pathlib import Path
from typing import Any, Protocol

from ..http.errors import ApiError

ALLOWED_TYPES = {
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "image/avif",
    "image/heic",
    "image/heif",
    "image/tiff",
    "image/bmp",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "video/mp4",
    "video/webm",
    "video/quicktime",
}
EXTENSIONS_BY_TYPE = {
    "image/png": {".png"},
    "image/jpeg": {".jpg", ".jpeg"},
    "image/webp": {".webp"},
    "image/gif": {".gif"},
    "image/avif": {".avif"},
    "image/heic": {".heic"},
    "image/heif": {".heif"},
    "image/tiff": {".tif", ".tiff"},
    "image/bmp": {".bmp"},
    "application/pdf": {".pdf"},
    "application/msword": {".doc"},
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
        ".docx"
    },
    "video/mp4": {".mp4"},
    "video/webm": {".webm"},
    "video/quicktime": {".mov"},
}

IMAGE_TYPES = {
    content_type for content_type in ALLOWED_TYPES if content_type.startswith("image/")
}


def _has_ftyp_brand(data: bytes, brands: set[bytes]) -> bool:
    if len(data) < 12 or data[4:8] != b"ftyp":
        return False
    candidate_brands = [data[8:12]]
    candidate_brands.extend(
        data[offset : offset + 4] for offset in range(16, min(len(data), 64), 4)
    )
    return any(brand in brands for brand in candidate_brands)


def _has_magic(content_type: str, data: bytes) -> bool:
    signatures = {
        "image/png": data[:8] == bytes.fromhex("89504e470d0a1a0a"),
        "image/jpeg": data[:3] == bytes.fromhex("ffd8ff"),
        "image/webp": data[:4] == b"RIFF" and data[8:12] == b"WEBP",
        "image/gif": data[:6] in {b"GIF87a", b"GIF89a"},
        "image/avif": _has_ftyp_brand(data, {b"avif", b"avis"}),
        "image/heic": _has_ftyp_brand(data, {b"heic", b"heix", b"hevc", b"hevx"}),
        "image/heif": _has_ftyp_brand(
            data, {b"mif1", b"msf1", b"heic", b"heix", b"hevc", b"hevx"}
        ),
        "image/tiff": data[:4] in {b"II*\x00", b"MM\x00*"},
        "image/bmp": data[:2] == b"BM",
        "application/pdf": data[:5] == b"%PDF-",
        "application/msword": data[:8] == bytes.fromhex("d0cf11e0a1b11ae1"),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": data[
            :2
        ]
        == b"PK",
        "video/mp4": data[4:8] == b"ftyp",
        "video/quicktime": data[4:8] == b"ftyp",
        "video/webm": data[:4] == bytes.fromhex("1a45dfa3"),
    }
    return signatures.get(content_type, False)


def scan_file(path: Path, scan_command: str, scan_required: bool) -> None:
    if not scan_required and not scan_command:
        return
    if not scan_command:
        raise ApiError(
            503, "Загрузка файлов временно недоступна: не настроен антивирусный сканер."
        )
    if scan_command.startswith(("tcp://", "clamav://")):
        _scan_file_clamav(path, scan_command)
        return
    try:
        result = subprocess.run(
            [scan_command, "--no-summary", "--infected", str(path)],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ApiError(
            503, "Загрузка файлов временно недоступна: проверка не выполнена."
        ) from exc
    if result.returncode == 1:
        raise ApiError(422, "Файл не прошёл антивирусную проверку.")
    if result.returncode != 0:
        raise ApiError(
            503, "Загрузка файлов временно недоступна: проверка не выполнена."
        )


def _scan_file_clamav(path: Path, endpoint: str) -> None:
    host_port = endpoint.split("://", 1)[1]
    host, _, port_text = host_port.rpartition(":")
    if not host or not port_text.isdigit():
        raise ApiError(
            503, "Загрузка файлов временно недоступна: неверный адрес сканера."
        )
    try:
        with socket.create_connection((host, int(port_text)), timeout=30) as connection:
            connection.sendall(b"zINSTREAM\0")
            with path.open("rb") as handle:
                while chunk := handle.read(1024 * 1024):
                    connection.sendall(struct.pack("!I", len(chunk)) + chunk)
            connection.sendall(struct.pack("!I", 0))
            response = connection.recv(4096).decode("utf-8", "replace").lower()
    except (OSError, ValueError) as exc:
        raise ApiError(
            503, "Загрузка файлов временно недоступна: проверка не выполнена."
        ) from exc
    if "found" in response:
        raise ApiError(422, "Файл не прошёл антивирусную проверку.")
    if "ok" not in response:
        raise ApiError(
            503, "Загрузка файлов временно недоступна: проверка не выполнена."
        )


def resolve_filename(url_path: str) -> str | None:
    filename = url_path.split("?", 1)[0].removeprefix("/uploads/")
    return (
        filename
        if re.fullmatch(
            r"[a-f0-9]{32,64}\.(?:png|jpe?g|webp|gif|avif|heic|heif|tiff?|bmp|pdf|docx?|mp4|webm|mov)",
            filename,
            re.I,
        )
        else None
    )


class FileStorage(Protocol):
    provider: str

    async def save_stream(
        self, chunks: Any, original_name: str, content_type: str, max_bytes: int
    ) -> dict[str, Any]: ...

    async def create_upload_intent(
        self, name: str, content_type: str, size: int, kind: str, owner_id: str = ""
    ) -> dict[str, Any]: ...

    async def complete_upload(
        self,
        upload_id: str,
        key: str,
        name: str,
        content_type: str,
        parts: list[dict[str, Any]],
        owner_id: str = "",
    ) -> dict[str, Any]: ...

    def resolve(self, url_path: str) -> dict[str, Any] | None: ...

    async def exists(self, resolved: dict[str, Any]) -> bool: ...

    async def read(self, resolved: dict[str, Any]) -> bytes: ...

    async def download_to_file(
        self, resolved: dict[str, Any], target: Path
    ) -> None: ...

    async def signed_url(self, resolved: dict[str, Any]) -> str | None: ...

    async def delete(self, url_path: str) -> None: ...

    async def ready(self) -> bool: ...

    async def cleanup_orphans(
        self, referenced_urls: set[str], grace_seconds: int = 3600
    ) -> int: ...

    def health(self) -> dict[str, Any]: ...


def create_file_storage(config: Any) -> FileStorage:
    if config.file_storage_provider == "s3":
        from .s3_storage import S3FileStorage

        return S3FileStorage(
            bucket=config.s3_bucket,
            region=config.s3_region,
            endpoint_url=config.s3_endpoint_url,
            access_key=config.s3_access_key,
            secret_key=config.s3_secret_key,
            prefix=config.s3_prefix,
            signed_url_ttl=config.s3_signed_url_ttl,
            temp_dir=config.upload_tmp_dir,
            server_side_encryption=config.s3_server_side_encryption,
            kms_key_id=config.s3_kms_key_id,
            scan_command=config.upload_scan_command,
            scan_required=config.upload_scan_required,
            intent_redis_url=config.redis_url,
        )
    from .local_storage import LocalFileStorage

    return LocalFileStorage(
        config.upload_dir,
        config.upload_scan_command,
        config.upload_scan_required,
        config.local_storage_encryption_key,
    )
