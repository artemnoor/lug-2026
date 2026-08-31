"""Database and shared-cache configuration."""

from dataclasses import dataclass
from pathlib import Path
from typing import Mapping


@dataclass(frozen=True, slots=True)
class DatabaseSettings:
    provider: str
    url: str
    ssl_mode: str
    ssl_root_cert: str
    pool_min_size: int
    pool_max_size: int
    redis_url: str


def load(values: Mapping[str, str], node_env: str) -> DatabaseSettings:
    explicit_provider = values.get("LUG_DATABASE_PROVIDER")
    provider = explicit_provider or (
        "postgres"
        if values.get("LUG_DATABASE_URL")
        or (node_env == "production" and values.get("DATABASE_URL"))
        else "json"
    )
    url = (
        values.get("LUG_DATABASE_URL")
        or (values.get("DATABASE_URL", "") if provider == "postgres" else "")
    ).strip()
    if provider not in {"json", "postgres"}:
        raise ValueError("LUG_DATABASE_PROVIDER должен быть json или postgres.")
    ssl_mode = values.get("LUG_DATABASE_SSL_MODE", "disable").strip().lower()
    if ssl_mode not in {"disable", "require", "verify-ca", "verify-full"}:
        raise ValueError(
            "LUG_DATABASE_SSL_MODE должен быть disable, require, verify-ca или verify-full."
        )
    if node_env == "production" and ssl_mode != "verify-full":
        raise ValueError(
            "В production PostgreSQL должен использовать LUG_DATABASE_SSL_MODE=verify-full."
        )
    if node_env == "staging" and ssl_mode == "disable":
        raise ValueError(
            "В staging PostgreSQL должен использовать TLS: задайте LUG_DATABASE_SSL_MODE."
        )
    root_cert = values.get("LUG_DATABASE_SSL_ROOT_CERT", "").strip()
    if root_cert and not Path(root_cert).is_file():
        raise ValueError("LUG_DATABASE_SSL_ROOT_CERT указывает на отсутствующий файл.")
    redis_url = values.get("REDIS_URL", "").strip()
    if node_env == "production":
        if provider != "postgres" or not url:
            raise ValueError(
                "В production нужен PostgreSQL: LUG_DATABASE_URL или DATABASE_URL."
            )
        if not redis_url:
            raise ValueError("В production нужен REDIS_URL для общего rate limiter.")
    pool_min_size = max(1, int(values.get("LUG_DATABASE_POOL_MIN_SIZE", "2")))
    pool_max_size = max(
        pool_min_size, int(values.get("LUG_DATABASE_POOL_MAX_SIZE", "20"))
    )
    return DatabaseSettings(
        provider, url, ssl_mode, root_cert, pool_min_size, pool_max_size, redis_url
    )
