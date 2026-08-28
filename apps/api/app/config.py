"""Environment-backed application configuration."""

import os
from dataclasses import dataclass
from pathlib import Path

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
    database_provider: str
    database_url: str
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
    provider = values.get("LUG_DATABASE_PROVIDER") or (
        "postgres" if values.get("LUG_DATABASE_URL") else "json"
    )
    database_url = values.get("LUG_DATABASE_URL", "")
    if provider == "postgres" and not database_url:
        database_url = values.get("DATABASE_URL", "")
    node_env = values.get("NODE_ENV", "development")
    file_storage_provider = values.get(
        "LUG_FILE_STORAGE_PROVIDER", "s3" if node_env == "production" else "local"
    ).strip().lower()
    if file_storage_provider not in {"local", "s3"}:
        raise ValueError("LUG_FILE_STORAGE_PROVIDER должен быть local или s3.")
    s3_bucket = values.get("LUG_S3_BUCKET", "").strip()
    s3_access_key = values.get("LUG_S3_ACCESS_KEY", "").strip()
    s3_secret_key = values.get("LUG_S3_SECRET_KEY", "")
    if node_env == "production" and file_storage_provider != "s3":
        raise ValueError("В production нужно использовать LUG_FILE_STORAGE_PROVIDER=s3.")
    if file_storage_provider == "s3" and not s3_bucket:
        raise ValueError("Для S3 storage нужно задать LUG_S3_BUCKET.")
    if bool(s3_access_key) != bool(s3_secret_key):
        raise ValueError("LUG_S3_ACCESS_KEY и LUG_S3_SECRET_KEY должны задаваться вместе.")
    email_mode = values.get(
        "LUG_EMAIL_MODE", "smtp" if node_env == "production" else "log"
    ).strip().lower()
    if email_mode not in {"smtp", "log"}:
        raise ValueError("LUG_EMAIL_MODE должен быть smtp или log.")
    if node_env == "production" and email_mode != "smtp":
        raise ValueError("В production доставка кодов должна использовать SMTP.")
    email_secret = values.get("LUG_EMAIL_VERIFICATION_SECRET", "").strip()
    if node_env == "production" and len(email_secret) < 32:
        raise ValueError(
            "LUG_EMAIL_VERIFICATION_SECRET должен содержать минимум 32 символа в production."
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
    if node_env == "production":
        if not smtp_host or not smtp_from:
            raise ValueError(
                "В production нужны LUG_SMTP_HOST и LUG_SMTP_FROM для доставки почты."
            )
        if not smtp_ssl and not smtp_starttls:
            raise ValueError(
                "SMTP в production должен использовать SSL или STARTTLS."
            )
        if bool(smtp_user) != bool(smtp_password):
            raise ValueError(
                "LUG_SMTP_USER и LUG_SMTP_PASSWORD должны задаваться вместе."
            )
    trusted_proxy_ips = tuple(
        item.strip()
        for item in values.get("LUG_TRUSTED_PROXY_IPS", "").split(",")
        if item.strip()
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
        trust_proxy=values.get("LUG_TRUST_PROXY") == "true",
        trusted_proxy_ips=trusted_proxy_ips,
        operations_token=values.get("LUG_OPERATIONS_TOKEN", "").strip(),
        database_provider=provider,
        database_url=database_url.strip(),
        database_pool_min_size=pool_min_size,
        database_pool_max_size=pool_max_size,
        redis_url=values.get("REDIS_URL", "").strip(),
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
        email_log_code=values.get(
            "LUG_EMAIL_LOG_CODE", "false" if node_env == "production" else "true"
        ).lower()
        in {"1", "true", "yes", "on"},
        request_timeout_ms=int(values.get("LUG_REQUEST_TIMEOUT_MS", "30000")),
        upload_scan_command=values.get("LUG_UPLOAD_SCAN_COMMAND", "").strip(),
        upload_scan_required=values.get(
            "LUG_UPLOAD_SCAN_REQUIRED", str(scan_required_default)
        ).lower()
        in {"1", "true", "yes", "on"},
        file_storage_provider=file_storage_provider,
        s3_bucket=s3_bucket,
        s3_region=values.get("LUG_S3_REGION", "").strip(),
        s3_endpoint_url=values.get("LUG_S3_ENDPOINT_URL", "").strip(),
        s3_access_key=s3_access_key,
        s3_secret_key=s3_secret_key,
        s3_prefix=values.get("LUG_S3_PREFIX", "uploads").strip("/") or "uploads",
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
        or node_env == "production",
    )
