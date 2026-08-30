"""Validated local file storage with private URL resolution."""

import base64
import binascii
import re
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
ALLOWED_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".gif",
    ".avif",
    ".heic",
    ".heif",
    ".tif",
    ".tiff",
    ".bmp",
    ".pdf",
    ".doc",
    ".docx",
    ".mp4",
    ".webm",
    ".mov",
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

IMAGE_TYPES = {content_type for content_type in ALLOWED_TYPES if content_type.startswith("image/")}
TYPE_BY_EXTENSION = {
    extension: content_type
    for content_type, extensions in EXTENSIONS_BY_TYPE.items()
    for extension in extensions
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
        "image/heic": _has_ftyp_brand(
            data, {b"heic", b"heix", b"hevc", b"hevx"}
        ),
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


def decode_upload(data_url: str, original_name: str) -> tuple[bytes, str, str]:
    match = re.fullmatch(r"data:([^;]+);base64,(.+)", str(data_url or ""))
    if not match or not original_name:
        raise ApiError(422, "Выберите файл для загрузки.")
    content_type, encoded = match.groups()
    content_type = content_type.strip().lower()
    if content_type not in ALLOWED_TYPES:
        extension = Path(original_name).suffix.lower()
        if content_type in {"image/jpg", "application/octet-stream", "binary/octet-stream"}:
            content_type = TYPE_BY_EXTENSION.get(extension, content_type)
    if content_type not in ALLOWED_TYPES:
        raise ApiError(422, "Поддерживаются распространённые форматы изображений, PDF, DOC, DOCX, MP4, WEBM и MOV.")
    extension = Path(original_name).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS or extension not in EXTENSIONS_BY_TYPE[content_type]:
        raise ApiError(422, "Расширение файла не соответствует его типу.")
    max_bytes = (
        50 * 1024 * 1024
        if content_type.startswith("video/")
        else 5 * 1024 * 1024
    )
    try:
        if len(encoded) > ((max_bytes + 2) // 3) * 4:
            raise ApiError(413, "Размер файла превышает допустимый лимит.")
        data = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ApiError(422, "Некорректное содержимое файла.") from exc
    if not data or not _has_magic(content_type, data):
        raise ApiError(422, "Файл не прошёл проверку содержимого.")
    if len(data) > max_bytes:
        limit = 50 if content_type.startswith("video/") else 5
        raise ApiError(413, f"Размер файла не должен превышать {limit} МБ.")
    return data, content_type, extension


def scan_file(path: Path, scan_command: str, scan_required: bool) -> None:
    if not scan_required and not scan_command:
        return
    if not scan_command:
        raise ApiError(503, "Загрузка файлов временно недоступна: не настроен антивирусный сканер.")
    try:
        result = subprocess.run(
            [scan_command, "--no-summary", "--infected", str(path)],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ApiError(503, "Загрузка файлов временно недоступна: проверка не выполнена.") from exc
    if result.returncode == 1:
        raise ApiError(422, "Файл не прошёл антивирусную проверку.")
    if result.returncode != 0:
        raise ApiError(503, "Загрузка файлов временно недоступна: проверка не выполнена.")


def resolve_filename(url_path: str) -> str | None:
    filename = url_path.split("?", 1)[0].removeprefix("/uploads/")
    return filename if re.fullmatch(
        r"[a-f0-9]{64}\.(?:png|jpe?g|webp|gif|avif|heic|heif|tiff?|bmp|pdf|docx?|mp4|webm|mov)",
        filename,
        re.I,
    ) else None


class FileStorage(Protocol):
    provider: str

    async def save(self, data_url: str, original_name: str) -> dict[str, Any]: ...

    @staticmethod
    def estimate_size(data_url: str) -> int: ...

    def resolve(self, url_path: str) -> dict[str, Any] | None: ...

    async def exists(self, resolved: dict[str, Any]) -> bool: ...

    async def read(self, resolved: dict[str, Any]) -> bytes: ...

    async def signed_url(self, resolved: dict[str, Any]) -> str | None: ...

    async def delete(self, url_path: str) -> None: ...

    async def ready(self) -> bool: ...

    async def cleanup_orphans(self, referenced_urls: set[str], grace_seconds: int = 3600) -> int: ...

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
        )
    from .local_storage import LocalFileStorage

    return LocalFileStorage(
        config.upload_dir,
        config.upload_scan_command,
        config.upload_scan_required,
        config.local_storage_encryption_key,
    )
