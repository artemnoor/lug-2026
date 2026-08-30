"""Environment-backed application configuration."""

import os
from dataclasses import dataclass
from pathlib import Path

from .security.encryption import development_key, parse_aes256_key

PROJECT_ROOT = Path(__file__).resolve().parents[3]


def default_settings() -> dict:
    return {
        "registrationStart": "2026-06-25T00:00:00+03:00",
        "registrationDeadline": "2026-09-03T23:59:59+03:00",
        "portfolioStart": "2026-09-15T00:00:00+03:00",
        "portfolioDeadline": "2026-09-29T23:59:59+03:00",
        "videoStart": "2026-09-15T00:00:00+03:00",
        "videoDeadline": "2026-09-29T23:59:59+03:00",
        "resultsStart": "2026-10-23T00:00:00+03:00",
        "resultsDeadline": "2026-10-30T23:59:59+03:00",
        "content": {
            "manifestoLead": "Четыре направления конкурса",
            "manifestoNote": "Наука, общественная деятельность, спорт и творчество — достижения группы оцениваются по всем направлениям.",
            "registrationHeadline": "Приём заявок открыт до 3 сентября",
        },
        "isRegistrationOpen": True,
        "minTeamPercentage": 60,
        "inviteLifetimeDays": 30,
    }


@dataclass(frozen=True)
class AppConfig:
    root: Path
    data_dir: Path
    upload_dir: Path
    upload_tmp_dir: Path
    api_host: str
    api_port: int
    node_env: str
    trust_proxy: bool
    trusted_proxy_ips: tuple[str, ...]
    operations_token: str
    allowed_hosts: tuple[str, ...]
    database_provider: str
    database_url: str
    database_ssl_mode: str
    database_ssl_root_cert: str
    database_pool_min_size: int
    database_pool_max_size: int
    redis_url: str
    email_mode: str
    smtp_host: str
    smtp_port: int
    smtp_user: str
    smtp_password: str
    smtp_from: str
    smtp_from_name: str
    smtp_ssl: bool
    smtp_starttls: bool
    email_verification_secret: str
    email_verification_ttl_ms: int
    email_verification_cooldown_ms: int
    email_verification_max_attempts: int
    email_log_code: bool
    email_outbox_encryption_key: bytes
    request_timeout_ms: int
    upload_scan_command: str
    upload_scan_required: bool
    file_storage_provider: str = "local"
    s3_bucket: str = ""
    s3_region: str = ""
    s3_endpoint_url: str = ""
    s3_access_key: str = ""
    s3_secret_key: str = ""
    s3_prefix: str = "uploads"
    s3_server_side_encryption: str = "AES256"
    s3_kms_key_id: str = ""
    local_storage_encryption_key: bytes = b""
    s3_signed_url_ttl: int = 300
    max_uploads_per_user: int = 50
    max_upload_bytes_per_user: int = 250 * 1024 * 1024
    upload_rate_limit_per_ip: int = 30
    upload_rate_limit_per_user: int = 30
    max_json_body: int = 2 * 1024 * 1024
    max_upload_body: int = 70 * 1024 * 1024
    session_ttl_ms: int = 7 * 24 * 60 * 60 * 1000
    secure_cookies: bool = False


def create_config(env: dict[str, str] | None = None) -> AppConfig:
    values = os.environ if env is None else env
    root = Path(values.get("LUG_ROOT", PROJECT_ROOT)).resolve()
    node_env = values.get("NODE_ENV", "development").strip().lower()
    hardened_env = node_env in {"staging", "production"}
    explicit_provider = values.get("LUG_DATABASE_PROVIDER")
    provider = explicit_provider or (
        "postgres"
        if values.get("LUG_DATABASE_URL") or (node_env == "production" and values.get("DATABASE_URL"))
        else "json"
    )
    database_url = (
        values.get("LUG_DATABASE_URL")
        or (values.get("DATABASE_URL", "") if provider == "postgres" else "")
    ).strip()
    if provider not in {"json", "postgres"}:
        raise ValueError("LUG_DATABASE_PROVIDER должен быть json или postgres.")
    database_ssl_mode = values.get(
        "LUG_DATABASE_SSL_MODE", "disable"
    ).strip().lower()
    if database_ssl_mode not in {"disable", "require", "verify-ca", "verify-full"}:
        raise ValueError(
            "LUG_DATABASE_SSL_MODE должен быть disable, require, verify-ca или verify-full."
        )
    if node_env == "production" and database_ssl_mode != "verify-full":
        raise ValueError(
            "В production PostgreSQL должен использовать LUG_DATABASE_SSL_MODE=verify-full."
        )
    if node_env == "staging" and database_ssl_mode == "disable":
        raise ValueError(
            "В staging PostgreSQL должен использовать TLS: задайте LUG_DATABASE_SSL_MODE."
        )
    database_ssl_root_cert = values.get("LUG_DATABASE_SSL_ROOT_CERT", "").strip()
    if database_ssl_root_cert and not Path(database_ssl_root_cert).is_file():
        raise ValueError("LUG_DATABASE_SSL_ROOT_CERT указывает на отсутствующий файл.")
    allowed_hosts = tuple(
        item.strip().lower().rstrip(".")
        for item in values.get(
            "LUG_ALLOWED_HOSTS", "" if node_env == "production" else "127.0.0.1,localhost"
        ).split(",")
        if item.strip()
    )
    operations_token = values.get("LUG_OPERATIONS_TOKEN", "").strip()
    redis_url = values.get("REDIS_URL", "").strip()
    if node_env == "production":
        if provider != "postgres" or not database_url:
            raise ValueError("В production нужен PostgreSQL: LUG_DATABASE_URL или DATABASE_URL.")
        if len(operations_token) < 32:
            raise ValueError("В production нужен LUG_OPERATIONS_TOKEN длиной минимум 32 символа.")
        if not redis_url:
            raise ValueError("В production нужен REDIS_URL для общего rate limiter.")
        if not allowed_hosts or any("*" in host for host in allowed_hosts):
            raise ValueError("В production нужен явный LUG_ALLOWED_HOSTS без wildcard.")
    outbox_key_value = values.get("LUG_EMAIL_OUTBOX_ENCRYPTION_KEY", "").strip()
    if hardened_env and not outbox_key_value:
        raise ValueError(
            "В staging/production нужен LUG_EMAIL_OUTBOX_ENCRYPTION_KEY (32 bytes, base64)."
        )
    email_outbox_encryption_key = (
        parse_aes256_key(outbox_key_value, "LUG_EMAIL_OUTBOX_ENCRYPTION_KEY")
        if outbox_key_value
        else development_key("email-outbox")
    )
    file_storage_provider = values.get(
        "LUG_FILE_STORAGE_PROVIDER", "s3" if node_env == "production" else "local"
    ).strip().lower()
    if file_storage_provider not in {"local", "s3"}:
        raise ValueError("LUG_FILE_STORAGE_PROVIDER должен быть local или s3.")
    s3_bucket = values.get("LUG_S3_BUCKET", "").strip()
    s3_endpoint_url = values.get("LUG_S3_ENDPOINT_URL", "").strip()
    s3_access_key = values.get("LUG_S3_ACCESS_KEY", "").strip()
    s3_secret_key = values.get("LUG_S3_SECRET_KEY", "")
    if node_env == "production" and file_storage_provider != "s3":
        raise ValueError("В production нужно использовать LUG_FILE_STORAGE_PROVIDER=s3.")
    if file_storage_provider == "s3" and not s3_bucket:
        raise ValueError("Для S3 storage нужно задать LUG_S3_BUCKET.")
    if hardened_env and s3_endpoint_url and not s3_endpoint_url.lower().startswith("https://"):
        raise ValueError("В staging/production endpoint S3 должен использовать HTTPS.")
    if bool(s3_access_key) != bool(s3_secret_key):
        raise ValueError("LUG_S3_ACCESS_KEY и LUG_S3_SECRET_KEY должны задаваться вместе.")
    s3_server_side_encryption = values.get(
        "LUG_S3_SERVER_SIDE_ENCRYPTION", "AES256"
    ).strip().lower()
    if s3_server_side_encryption == "aes256":
        s3_server_side_encryption = "AES256"
    if s3_server_side_encryption not in {"AES256", "aws:kms"}:
        raise ValueError(
            "LUG_S3_SERVER_SIDE_ENCRYPTION должен быть AES256 или aws:kms."
        )
    s3_kms_key_id = values.get("LUG_S3_KMS_KEY_ID", "").strip()
    if s3_server_side_encryption == "aws:kms" and not s3_kms_key_id:
        raise ValueError(
            "Для LUG_S3_SERVER_SIDE_ENCRYPTION=aws:kms нужен LUG_S3_KMS_KEY_ID."
        )
    if file_storage_provider == "s3" and hardened_env and not values.get(
        "LUG_S3_SERVER_SIDE_ENCRYPTION", ""
    ).strip():
        raise ValueError(
            "В staging/production нужно явно включить S3 server-side encryption."
        )
    local_storage_key_value = values.get("LUG_LOCAL_STORAGE_ENCRYPTION_KEY", "").strip()
    if hardened_env and file_storage_provider == "local" and not local_storage_key_value:
        raise ValueError(
            "Для local storage в staging нужен LUG_LOCAL_STORAGE_ENCRYPTION_KEY."
        )
    local_storage_encryption_key = (
        parse_aes256_key(local_storage_key_value, "LUG_LOCAL_STORAGE_ENCRYPTION_KEY")
        if local_storage_key_value
        else development_key("local-storage")
    )
    email_mode = values.get(
        "LUG_EMAIL_MODE", "smtp" if hardened_env else "log"
    ).strip().lower()
    if email_mode not in {"smtp", "log"}:
        raise ValueError("LUG_EMAIL_MODE должен быть smtp или log.")
    if hardened_env and email_mode != "smtp":
        raise ValueError("В staging/production доставка кодов должна использовать SMTP.")
    email_secret = values.get("LUG_EMAIL_VERIFICATION_SECRET", "").strip()
    if hardened_env and len(email_secret) < 32:
        raise ValueError(
            "LUG_EMAIL_VERIFICATION_SECRET должен содержать минимум 32 символа в staging/production."
        )
    smtp_host = values.get("LUG_SMTP_HOST", "").strip()
    smtp_user = values.get("LUG_SMTP_USER", "").strip()
    smtp_password = values.get("LUG_SMTP_PASSWORD", "")
    smtp_from = values.get("LUG_SMTP_FROM", "").strip()
    smtp_ssl = values.get("LUG_SMTP_SSL", "false").lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    smtp_starttls = values.get("LUG_SMTP_STARTTLS", "true").lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    if hardened_env:
        if not smtp_host or not smtp_from:
            raise ValueError(
                "В staging/production нужны LUG_SMTP_HOST и LUG_SMTP_FROM для доставки почты."
            )
        if not smtp_ssl and not smtp_starttls:
            raise ValueError(
                "SMTP в staging/production должен использовать SSL или STARTTLS."
            )
        if bool(smtp_user) != bool(smtp_password):
            raise ValueError(
                "LUG_SMTP_USER и LUG_SMTP_PASSWORD должны задаваться вместе."
            )
    email_log_code = values.get(
        "LUG_EMAIL_LOG_CODE", "false" if hardened_env else "true"
    ).lower() in {"1", "true", "yes", "on"}
    if hardened_env and email_log_code:
        raise ValueError("В staging/production нельзя писать коды подтверждения в лог.")
    trusted_proxy_ips = tuple(
        item.strip()
        for item in values.get("LUG_TRUSTED_PROXY_IPS", "").split(",")
        if item.strip()
    )
    trust_proxy = values.get("LUG_TRUST_PROXY") == "true"
    if hardened_env and (not trust_proxy or not trusted_proxy_ips):
        raise ValueError(
            "В staging/production нужны LUG_TRUST_PROXY=true и LUG_TRUSTED_PROXY_IPS."
        )
    pool_min_size = max(1, int(values.get("LUG_DATABASE_POOL_MIN_SIZE", "2")))
    pool_max_size = max(
        pool_min_size, int(values.get("LUG_DATABASE_POOL_MAX_SIZE", "20"))
    )
    scan_required_default = node_env == "production"
    return AppConfig(
        root=root,
        data_dir=Path(values.get("LUG_DATA_DIR", root / "data")).resolve(),
        upload_dir=Path(values.get("LUG_UPLOAD_DIR", root / "uploads")).resolve(),
        upload_tmp_dir=Path(
            values.get("LUG_UPLOAD_TMP_DIR", Path(values.get("LUG_DATA_DIR", root / "data")) / "upload-tmp")
        ).resolve(),
        api_host=values.get("LUG_API_HOST", "127.0.0.1"),
        api_port=int(values.get("LUG_API_PORT", "4174")),
        node_env=node_env,
        trust_proxy=trust_proxy,
        trusted_proxy_ips=trusted_proxy_ips,
        operations_token=operations_token,
        allowed_hosts=allowed_hosts,
        database_provider=provider,
        database_url=database_url.strip(),
        database_ssl_mode=database_ssl_mode,
        database_ssl_root_cert=database_ssl_root_cert,
        database_pool_min_size=pool_min_size,
        database_pool_max_size=pool_max_size,
        redis_url=redis_url,
        email_mode=email_mode,
        smtp_host=smtp_host,
        smtp_port=int(values.get("LUG_SMTP_PORT", "465" if smtp_ssl else "587")),
        smtp_user=smtp_user,
        smtp_password=smtp_password,
        smtp_from=smtp_from,
        smtp_from_name=values.get("LUG_SMTP_FROM_NAME", "ЛУГ 2026").strip(),
        smtp_ssl=smtp_ssl,
        smtp_starttls=smtp_starttls,
        email_verification_secret=email_secret
        or ("local-development-email-secret" if node_env != "production" else ""),
        email_verification_ttl_ms=max(
            60_000, int(values.get("LUG_EMAIL_VERIFICATION_TTL_MS", "900000"))
        ),
        email_verification_cooldown_ms=max(
            10_000, int(values.get("LUG_EMAIL_VERIFICATION_COOLDOWN_MS", "60000"))
        ),
        email_verification_max_attempts=max(
            1, int(values.get("LUG_EMAIL_VERIFICATION_MAX_ATTEMPTS", "5"))
        ),
        email_log_code=email_log_code,
        email_outbox_encryption_key=email_outbox_encryption_key,
        request_timeout_ms=int(values.get("LUG_REQUEST_TIMEOUT_MS", "30000")),
        upload_scan_command=values.get("LUG_UPLOAD_SCAN_COMMAND", "").strip(),
        upload_scan_required=values.get(
            "LUG_UPLOAD_SCAN_REQUIRED", str(scan_required_default)
        ).lower()
        in {"1", "true", "yes", "on"},
        file_storage_provider=file_storage_provider,
        s3_bucket=s3_bucket,
        s3_region=values.get("LUG_S3_REGION", "").strip(),
        s3_endpoint_url=s3_endpoint_url,
        s3_access_key=s3_access_key,
        s3_secret_key=s3_secret_key,
        s3_prefix=values.get("LUG_S3_PREFIX", "uploads").strip("/") or "uploads",
        s3_server_side_encryption=s3_server_side_encryption,
        s3_kms_key_id=s3_kms_key_id,
        local_storage_encryption_key=local_storage_encryption_key,
        s3_signed_url_ttl=max(60, int(values.get("LUG_S3_SIGNED_URL_TTL", "300"))),
        max_uploads_per_user=max(1, int(values.get("LUG_MAX_UPLOADS_PER_USER", "50"))),
        max_upload_bytes_per_user=max(
            1,
            int(
                values.get(
                    "LUG_MAX_UPLOAD_BYTES_PER_USER", str(250 * 1024 * 1024)
                )
            ),
        ),
        upload_rate_limit_per_ip=max(
            1, int(values.get("LUG_UPLOAD_RATE_LIMIT_PER_IP", "30"))
        ),
        upload_rate_limit_per_user=max(
            1, int(values.get("LUG_UPLOAD_RATE_LIMIT_PER_USER", "30"))
        ),
        secure_cookies=values.get("LUG_SECURE_COOKIES") == "true"
        or hardened_env,
    )
