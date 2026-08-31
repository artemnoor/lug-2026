"""Composition root for typed DB, security, storage and email settings."""

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from .configuration import database, email, security, storage

PROJECT_ROOT = Path(__file__).resolve().parents[3]


def default_settings() -> dict[str, Any]:
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


@dataclass(frozen=True, slots=True)
class AppConfig:
    """Stable application config with section objects and legacy aliases."""

    root: Path
    api_host: str
    api_port: int
    node_env: str
    database: database.DatabaseSettings
    security: security.SecuritySettings
    storage: storage.StorageSettings
    email: email.EmailSettings

    # Compatibility aliases keep the env/config contract stable while callers
    # migrate to config.database/config.security/config.storage/config.email.
    @property
    def data_dir(self) -> Path:
        return self.storage.data_dir

    @property
    def upload_dir(self) -> Path:
        return self.storage.upload_dir

    @property
    def upload_tmp_dir(self) -> Path:
        return self.storage.upload_tmp_dir

    @property
    def trust_proxy(self) -> bool:
        return self.security.trust_proxy

    @property
    def trusted_proxy_ips(self) -> tuple[str, ...]:
        return self.security.trusted_proxy_ips

    @property
    def operations_token(self) -> str:
        return self.security.operations_token

    @property
    def allowed_hosts(self) -> tuple[str, ...]:
        return self.security.allowed_hosts

    @property
    def database_provider(self) -> str:
        return self.database.provider

    @property
    def database_url(self) -> str:
        return self.database.url

    @property
    def database_ssl_mode(self) -> str:
        return self.database.ssl_mode

    @property
    def database_ssl_root_cert(self) -> str:
        return self.database.ssl_root_cert

    @property
    def database_pool_min_size(self) -> int:
        return self.database.pool_min_size

    @property
    def database_pool_max_size(self) -> int:
        return self.database.pool_max_size

    @property
    def redis_url(self) -> str:
        return self.database.redis_url

    @property
    def email_mode(self) -> str:
        return self.email.mode

    @property
    def smtp_host(self) -> str:
        return self.email.smtp_host

    @property
    def smtp_port(self) -> int:
        return self.email.smtp_port

    @property
    def smtp_user(self) -> str:
        return self.email.smtp_user

    @property
    def smtp_password(self) -> str:
        return self.email.smtp_password

    @property
    def smtp_from(self) -> str:
        return self.email.smtp_from

    @property
    def smtp_from_name(self) -> str:
        return self.email.smtp_from_name

    @property
    def smtp_ssl(self) -> bool:
        return self.email.smtp_ssl

    @property
    def smtp_starttls(self) -> bool:
        return self.email.smtp_starttls

    @property
    def email_verification_secret(self) -> str:
        return self.email.verification_secret

    @property
    def email_verification_ttl_ms(self) -> int:
        return self.email.verification_ttl_ms

    @property
    def email_verification_cooldown_ms(self) -> int:
        return self.email.verification_cooldown_ms

    @property
    def email_verification_max_attempts(self) -> int:
        return self.email.verification_max_attempts

    @property
    def email_log_code(self) -> bool:
        return self.email.log_code

    @property
    def email_outbox_encryption_key(self) -> bytes:
        return self.email.outbox_encryption_key

    @property
    def request_timeout_ms(self) -> int:
        return self.security.request_timeout_ms

    @property
    def upload_scan_command(self) -> str:
        return self.storage.upload_scan_command

    @property
    def upload_scan_required(self) -> bool:
        return self.storage.upload_scan_required

    @property
    def file_storage_provider(self) -> str:
        return self.storage.provider

    @property
    def s3_bucket(self) -> str:
        return self.storage.s3_bucket

    @property
    def s3_region(self) -> str:
        return self.storage.s3_region

    @property
    def s3_endpoint_url(self) -> str:
        return self.storage.s3_endpoint_url

    @property
    def s3_access_key(self) -> str:
        return self.storage.s3_access_key

    @property
    def s3_secret_key(self) -> str:
        return self.storage.s3_secret_key

    @property
    def s3_prefix(self) -> str:
        return self.storage.s3_prefix

    @property
    def s3_server_side_encryption(self) -> str:
        return self.storage.s3_server_side_encryption

    @property
    def s3_kms_key_id(self) -> str:
        return self.storage.s3_kms_key_id

    @property
    def local_storage_encryption_key(self) -> bytes:
        return self.storage.local_encryption_key

    @property
    def s3_signed_url_ttl(self) -> int:
        return self.storage.s3_signed_url_ttl

    @property
    def max_uploads_per_user(self) -> int:
        return self.storage.max_uploads_per_user

    @property
    def max_upload_bytes_per_user(self) -> int:
        return self.storage.max_upload_bytes_per_user

    @property
    def upload_rate_limit_per_ip(self) -> int:
        return self.storage.upload_rate_limit_per_ip

    @property
    def upload_rate_limit_per_user(self) -> int:
        return self.storage.upload_rate_limit_per_user

    @property
    def max_json_body(self) -> int:
        return self.security.max_json_body

    @property
    def max_upload_body(self) -> int:
        return self.security.max_upload_body

    @property
    def session_ttl_ms(self) -> int:
        return self.security.session_ttl_ms

    @property
    def secure_cookies(self) -> bool:
        return self.security.secure_cookies


def create_config(env: Mapping[str, str] | None = None) -> AppConfig:
    values = os.environ if env is None else env
    root = Path(values.get("LUG_ROOT", str(PROJECT_ROOT))).resolve()
    node_env = (
        values.get("LUG_ENV", values.get("NODE_ENV", "development")).strip().lower()
    )
    return AppConfig(
        root=root,
        api_host=values.get("LUG_API_HOST", "127.0.0.1"),
        api_port=int(values.get("LUG_API_PORT", "4174")),
        node_env=node_env,
        database=database.load(values, node_env),
        security=security.load(values, node_env),
        storage=storage.load(values, root, node_env),
        email=email.load(values, node_env),
    )
