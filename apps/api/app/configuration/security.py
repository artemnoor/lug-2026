"""HTTP, proxy and operational security configuration."""

from dataclasses import dataclass
from typing import Mapping


@dataclass(frozen=True, slots=True)
class SecuritySettings:
    allowed_hosts: tuple[str, ...]
    operations_token: str
    trusted_proxy_ips: tuple[str, ...]
    trust_proxy: bool
    request_timeout_ms: int
    max_json_body: int
    max_upload_body: int
    session_ttl_ms: int
    secure_cookies: bool


def load(values: Mapping[str, str], node_env: str) -> SecuritySettings:
    allowed_hosts = tuple(
        item.strip().lower().rstrip(".")
        for item in values.get(
            "LUG_ALLOWED_HOSTS",
            "" if node_env == "production" else "127.0.0.1,localhost",
        ).split(",")
        if item.strip()
    )
    operations_token = values.get("LUG_OPERATIONS_TOKEN", "").strip()
    if node_env == "production":
        if len(operations_token) < 32:
            raise ValueError(
                "В production нужен LUG_OPERATIONS_TOKEN длиной минимум 32 символа."
            )
        if not allowed_hosts or any("*" in host for host in allowed_hosts):
            raise ValueError("В production нужен явный LUG_ALLOWED_HOSTS без wildcard.")
    trusted_proxy_ips = tuple(
        item.strip()
        for item in values.get("LUG_TRUSTED_PROXY_IPS", "").split(",")
        if item.strip()
    )
    trust_proxy = values.get("LUG_TRUST_PROXY") == "true"
    if node_env in {"staging", "production"} and (
        not trust_proxy or not trusted_proxy_ips
    ):
        raise ValueError(
            "В staging/production нужны LUG_TRUST_PROXY=true и LUG_TRUSTED_PROXY_IPS."
        )
    return SecuritySettings(
        allowed_hosts=allowed_hosts,
        operations_token=operations_token,
        trusted_proxy_ips=trusted_proxy_ips,
        trust_proxy=trust_proxy,
        request_timeout_ms=int(values.get("LUG_REQUEST_TIMEOUT_MS", "30000")),
        max_json_body=2 * 1024 * 1024,
        max_upload_body=70 * 1024 * 1024,
        session_ttl_ms=7 * 24 * 60 * 60 * 1000,
        secure_cookies=values.get("LUG_SECURE_COOKIES") == "true"
        or node_env in {"staging", "production"},
    )
