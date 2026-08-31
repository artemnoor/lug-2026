"""Normalized PostgreSQL persistence adapter."""

import json
import ssl
from typing import Any

from .postgres_admin_queries import PostgresAdminQueryMixin
from .postgres_entity_writes import PostgresEntityWriteMixin
from .postgres_queries import PostgresQueryMixin
from .postgres_registration import PostgresRegistrationMixin
from .postgres_review_writes import PostgresReviewMixin
from .postgres_user_writes import PostgresUserWriteMixin


def _postgres_ssl_context(mode: str, root_cert: str) -> ssl.SSLContext | None:
    normalized = str(mode or "disable").strip().lower()
    if normalized == "disable":
        return None
    if normalized not in {"require", "verify-ca", "verify-full"}:
        raise RuntimeError("Неподдерживаемый режим TLS PostgreSQL.")
    context = ssl.create_default_context(cafile=root_cert or None)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    if normalized == "require":
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
    elif normalized == "verify-ca":
        context.check_hostname = False
    return context


class PostgresStore(
    PostgresQueryMixin,
    PostgresAdminQueryMixin,
    PostgresRegistrationMixin,
    PostgresReviewMixin,
    PostgresEntityWriteMixin,
    PostgresUserWriteMixin,
):
    provider = "postgres"
    serializes_writes = False
    queues_email = True
    atomic_reviews = True
    atomic_password_reset = True
    atomic_registration = True

    def __init__(
        self, pool: Any, defaults: dict, email_outbox_encryption_key: bytes
    ) -> None:
        self.pool = pool
        self.defaults = defaults
        self.email_outbox_encryption_key = email_outbox_encryption_key

    @classmethod
    async def create(
        cls,
        database_url: str,
        defaults: dict,
        min_size: int = 2,
        max_size: int = 20,
        email_outbox_encryption_key: bytes | None = None,
        database_ssl_mode: str = "disable",
        database_ssl_root_cert: str = "",
    ) -> "PostgresStore":
        import asyncpg

        if (
            email_outbox_encryption_key is None
            or len(email_outbox_encryption_key) != 32
        ):
            raise RuntimeError(
                "PostgreSQL email outbox требует AES-256 encryption key."
            )
        ssl_context = _postgres_ssl_context(database_ssl_mode, database_ssl_root_cert)
        pool = await asyncpg.create_pool(
            database_url,
            min_size=min_size,
            max_size=max_size,
            timeout=5,
            ssl=ssl_context,
        )
        store = cls(pool, defaults, email_outbox_encryption_key)
        # Migrations own schema versioning. Runtime checks a stable capability,
        # not a release-specific Alembic revision, so adding a migration does
        # not require changing application code.
        schema_ready = await pool.fetchval(
            """SELECT to_regclass('public.lug_settings') IS NOT NULL
               AND to_regclass('public.lug_users') IS NOT NULL
               AND to_regclass('public.lug_teams') IS NOT NULL
               AND to_regclass('public.lug_uploads') IS NOT NULL"""
        )
        if not schema_ready:
            await pool.close()
            raise RuntimeError(
                "PostgreSQL schema не подготовлена. Выполните release migration: "
                "python scripts/migrate.py"
            )
        await pool.execute(
            """INSERT INTO lug_settings (id, payload) VALUES (1, $1::jsonb)
            ON CONFLICT (id) DO NOTHING""",
            json.dumps(defaults, ensure_ascii=False),
        )
        return store

    async def close(self) -> None:
        await self.pool.close()

    def health(self) -> dict[str, str]:
        return {"provider": self.provider, "schema": "normalized"}
