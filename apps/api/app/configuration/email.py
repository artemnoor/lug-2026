"""SMTP, verification and encrypted outbox configuration."""

from dataclasses import dataclass
from typing import Mapping

from ..security.encryption import development_key, parse_aes256_key


@dataclass(frozen=True, slots=True)
class EmailSettings:
    mode: str
    smtp_host: str
    smtp_port: int
    smtp_user: str
    smtp_password: str
    smtp_from: str
    smtp_from_name: str
    smtp_ssl: bool
    smtp_starttls: bool
    verification_secret: str
    verification_ttl_ms: int
    verification_cooldown_ms: int
    verification_max_attempts: int
    log_code: bool
    outbox_encryption_key: bytes


def load(values: Mapping[str, str], node_env: str) -> EmailSettings:
    hardened = node_env in {"staging", "production"}
    outbox_value = values.get("LUG_EMAIL_OUTBOX_ENCRYPTION_KEY", "").strip()
    if hardened and not outbox_value:
        raise ValueError(
            "В staging/production нужен LUG_EMAIL_OUTBOX_ENCRYPTION_KEY (32 bytes, base64)."
        )
    outbox_key = (
        parse_aes256_key(outbox_value, "LUG_EMAIL_OUTBOX_ENCRYPTION_KEY")
        if outbox_value
        else development_key("email-outbox")
    )
    mode = values.get("LUG_EMAIL_MODE", "smtp" if hardened else "log").strip().lower()
    if mode not in {"smtp", "log"}:
        raise ValueError("LUG_EMAIL_MODE должен быть smtp или log.")
    if hardened and mode != "smtp":
        raise ValueError(
            "В staging/production доставка кодов должна использовать SMTP."
        )
    secret = values.get("LUG_EMAIL_VERIFICATION_SECRET", "").strip()
    if hardened and len(secret) < 32:
        raise ValueError(
            "LUG_EMAIL_VERIFICATION_SECRET должен содержать минимум 32 символа в staging/production."
        )
    smtp_host = values.get("LUG_SMTP_HOST", "").strip()
    smtp_user = values.get("LUG_SMTP_USER", "").strip()
    smtp_password = values.get("LUG_SMTP_PASSWORD", "")
    smtp_from = values.get("LUG_SMTP_FROM", "").strip()
    smtp_ssl = values.get("LUG_SMTP_SSL", "false").lower() in {"1", "true", "yes", "on"}
    smtp_starttls = values.get("LUG_SMTP_STARTTLS", "true").lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    if hardened:
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
    log_code = values.get(
        "LUG_EMAIL_LOG_CODE", "false" if hardened else "true"
    ).lower() in {"1", "true", "yes", "on"}
    if hardened and log_code:
        raise ValueError("В staging/production нельзя писать коды подтверждения в лог.")
    return EmailSettings(
        mode,
        smtp_host,
        int(values.get("LUG_SMTP_PORT", "465" if smtp_ssl else "587")),
        smtp_user,
        smtp_password,
        smtp_from,
        values.get("LUG_SMTP_FROM_NAME", "ЛУГ 2026").strip(),
        smtp_ssl,
        smtp_starttls,
        secret
        or ("local-development-email-secret" if node_env != "production" else ""),
        max(60_000, int(values.get("LUG_EMAIL_VERIFICATION_TTL_MS", "900000"))),
        max(10_000, int(values.get("LUG_EMAIL_VERIFICATION_COOLDOWN_MS", "60000"))),
        max(1, int(values.get("LUG_EMAIL_VERIFICATION_MAX_ATTEMPTS", "5"))),
        log_code,
        outbox_key,
    )
