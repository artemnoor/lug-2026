"""Local and object-storage configuration."""

from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

from ..security.encryption import development_key, parse_aes256_key


@dataclass(frozen=True, slots=True)
class StorageSettings:
    data_dir: Path
    upload_dir: Path
    upload_tmp_dir: Path
    provider: str
    s3_bucket: str
    s3_region: str
    s3_endpoint_url: str
    s3_access_key: str
    s3_secret_key: str
    s3_prefix: str
    s3_server_side_encryption: str
    s3_kms_key_id: str
    local_encryption_key: bytes
    s3_signed_url_ttl: int
    max_uploads_per_user: int
    max_upload_bytes_per_user: int
    upload_rate_limit_per_ip: int
    upload_rate_limit_per_user: int
    upload_scan_command: str
    upload_scan_required: bool


def load(values: Mapping[str, str], root: Path, node_env: str) -> StorageSettings:
    hardened = node_env in {"staging", "production"}
    data_dir = Path(values.get("LUG_DATA_DIR", root / "data")).resolve()
    upload_dir = Path(values.get("LUG_UPLOAD_DIR", root / "uploads")).resolve()
    upload_tmp_dir = Path(
        values.get("LUG_UPLOAD_TMP_DIR", data_dir / "upload-tmp")
    ).resolve()
    provider = (
        values.get(
            "LUG_FILE_STORAGE_PROVIDER", "s3" if node_env == "production" else "local"
        )
        .strip()
        .lower()
    )
    if provider not in {"local", "s3"}:
        raise ValueError("LUG_FILE_STORAGE_PROVIDER должен быть local или s3.")
    bucket = values.get("LUG_S3_BUCKET", "").strip()
    endpoint = values.get("LUG_S3_ENDPOINT_URL", "").strip()
    access_key = values.get("LUG_S3_ACCESS_KEY", "").strip()
    secret_key = values.get("LUG_S3_SECRET_KEY", "")
    if node_env == "production" and provider != "s3":
        raise ValueError(
            "В production нужно использовать LUG_FILE_STORAGE_PROVIDER=s3."
        )
    if provider == "s3" and not bucket:
        raise ValueError("Для S3 storage нужно задать LUG_S3_BUCKET.")
    if hardened and endpoint and not endpoint.lower().startswith("https://"):
        raise ValueError("В staging/production endpoint S3 должен использовать HTTPS.")
    if bool(access_key) != bool(secret_key):
        raise ValueError(
            "LUG_S3_ACCESS_KEY и LUG_S3_SECRET_KEY должны задаваться вместе."
        )
    encryption = values.get("LUG_S3_SERVER_SIDE_ENCRYPTION", "AES256").strip().lower()
    encryption = "AES256" if encryption == "aes256" else encryption
    if encryption not in {"AES256", "aws:kms"}:
        raise ValueError(
            "LUG_S3_SERVER_SIDE_ENCRYPTION должен быть AES256 или aws:kms."
        )
    kms_key_id = values.get("LUG_S3_KMS_KEY_ID", "").strip()
    if encryption == "aws:kms" and not kms_key_id:
        raise ValueError(
            "Для LUG_S3_SERVER_SIDE_ENCRYPTION=aws:kms нужен LUG_S3_KMS_KEY_ID."
        )
    if (
        provider == "s3"
        and hardened
        and not values.get("LUG_S3_SERVER_SIDE_ENCRYPTION", "").strip()
    ):
        raise ValueError(
            "В staging/production нужно явно включить S3 server-side encryption."
        )
    local_key_value = values.get("LUG_LOCAL_STORAGE_ENCRYPTION_KEY", "").strip()
    if hardened and provider == "local" and not local_key_value:
        raise ValueError(
            "Для local storage в staging нужен LUG_LOCAL_STORAGE_ENCRYPTION_KEY."
        )
    local_key = (
        parse_aes256_key(local_key_value, "LUG_LOCAL_STORAGE_ENCRYPTION_KEY")
        if local_key_value
        else development_key("local-storage")
    )
    return StorageSettings(
        data_dir,
        upload_dir,
        upload_tmp_dir,
        provider,
        bucket,
        values.get("LUG_S3_REGION", "").strip(),
        endpoint,
        access_key,
        secret_key,
        values.get("LUG_S3_PREFIX", "uploads").strip("/") or "uploads",
        encryption,
        kms_key_id,
        local_key,
        max(60, int(values.get("LUG_S3_SIGNED_URL_TTL", "300"))),
        max(1, int(values.get("LUG_MAX_UPLOADS_PER_USER", "50"))),
        max(
            1, int(values.get("LUG_MAX_UPLOAD_BYTES_PER_USER", str(250 * 1024 * 1024)))
        ),
        max(1, int(values.get("LUG_UPLOAD_RATE_LIMIT_PER_IP", "30"))),
        max(1, int(values.get("LUG_UPLOAD_RATE_LIMIT_PER_USER", "30"))),
        values.get("LUG_UPLOAD_SCAN_COMMAND", "").strip(),
        values.get("LUG_UPLOAD_SCAN_REQUIRED", str(node_env == "production")).lower()
        in {"1", "true", "yes", "on"},
    )
