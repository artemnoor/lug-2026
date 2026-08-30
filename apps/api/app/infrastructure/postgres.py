"""Normalized PostgreSQL persistence with legacy JSONB migration support."""

import json
import ssl
from datetime import datetime, timezone
from typing import Any

from ..security.encryption import encrypt_json
from .postgres_password_reset import PASSWORD_RESET_SCHEMA
from .postgres_queries import PostgresQueryMixin
from .postgres_registration import PostgresRegistrationMixin
from .postgres_review_writes import PostgresReviewMixin
from .postgres_schema import INTEGRITY_SCHEMA, OUTBOX_INTEGRITY_SCHEMA, SCHEMA
from .postgres_writes import PersistenceError
from .store import DatabaseState, normalize_db

ENTITY_TABLES = {
    "users": "lug_users",
    "teams": "lug_teams",
    "achievements": "lug_achievements",
    "notifications": "lug_notifications",
    "sessions": "lug_sessions",
    "uploads": "lug_uploads",
    "emailVerifications": "lug_email_verifications",
    "passwordResets": "lug_password_resets",
}

def _json_payload(value: Any) -> dict:
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return {}
    return value if isinstance(value, dict) else {}

def _fingerprint(value: Any) -> str:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    )

def _entity_id(key: str, item: dict) -> str:
    return str(item.get("tokenHash") if key == "sessions" else item.get("url" if key == "uploads" else "id") or "")


def _snapshot(state: DatabaseState) -> dict[str, Any]:
    return {
        key: {
            _entity_id(key, item): _fingerprint(item)
            for item in state.get(key, [])
            if isinstance(item, dict) and _entity_id(key, item)
        }
        for key in ENTITY_TABLES
    } | {"settings": _fingerprint(state.get("settings", {})), "auditLog": {
        _entity_id("auditLog", item): _fingerprint(item)
        for item in state.get("auditLog", [])
        if isinstance(item, dict) and _entity_id("auditLog", item)
    }}


def _indexed_values(key: str, item: dict) -> tuple[Any, ...]:
    if key == "users":
        return (
            item.get("email", ""), item.get("phone", ""), item.get("role", ""),
            item.get("teamId") or None, item.get("emailVerified") is True,
        )
    if key == "teams":
        return (
            item.get("group", ""), item.get("inviteCode", ""), item.get("captainId") or None,
            item.get("inviteStatus", "active"),
        )
    if key == "achievements":
        return (item.get("userId") or None, item.get("status", ""))
    if key == "notifications":
        return (item.get("targetType", ""), item.get("targetId"), item.get("kind", ""))
    if key == "sessions":
        return (item.get("tokenHash", ""), item.get("userId") or None, int(item.get("expiresAt", 0) or 0))
    if key == "uploads":
        return (item.get("userId") or None, item.get("kind", ""))
    return (item.get("email", ""), int(item.get("expiresAtMs", 0) or 0))


def _audit_at(value: Any) -> datetime:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return datetime.now(timezone.utc)


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


class PostgresStore(PostgresQueryMixin, PostgresRegistrationMixin, PostgresReviewMixin):
    provider = "postgres"
    serializes_writes = False

    def __init__(self, pool: Any, defaults: dict, email_outbox_encryption_key: bytes) -> None:
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

        if email_outbox_encryption_key is None or len(email_outbox_encryption_key) != 32:
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
        await pool.execute(SCHEMA)
        await pool.execute(INTEGRITY_SCHEMA)
        await pool.execute(PASSWORD_RESET_SCHEMA)
        await pool.execute(
            "INSERT INTO lug_meta (id) VALUES ('primary') ON CONFLICT (id) DO NOTHING"
        )
        await store._migrate_legacy()
        await store._encrypt_legacy_email_outbox()
        await pool.execute(OUTBOX_INTEGRITY_SCHEMA)
        if not await pool.fetchval("SELECT EXISTS (SELECT 1 FROM lug_settings WHERE id = 1)"):
            await store.save(normalize_db(None, defaults))
        return store

    async def _encrypt_legacy_email_outbox(self) -> None:
        """Upgrade pre-encryption outbox rows before the worker can claim them."""

        async with self.pool.acquire() as connection:
            async with connection.transaction():
                rows = await connection.fetch(
                    "SELECT id, status, payload FROM lug_email_outbox "
                    "WHERE payload->>'algorithm' IS DISTINCT FROM 'AES-256-GCM'"
                )
                for row in rows:
                    if row["status"] == "sent":
                        encrypted_payload = {"redacted": True, "version": 1}
                    else:
                        encrypted_payload = encrypt_json(
                            _json_payload(row["payload"]),
                            self.email_outbox_encryption_key,
                        )
                    await connection.execute(
                        "UPDATE lug_email_outbox SET payload = $2::jsonb WHERE id = $1",
                        row["id"], json.dumps(encrypted_payload, ensure_ascii=False),
                    )
    async def _migrate_legacy(self) -> None:
        settings_exists = await self.pool.fetchval(
            "SELECT EXISTS (SELECT 1 FROM lug_settings WHERE id = 1)"
        )
        if settings_exists:
            return
        legacy_exists = await self.pool.fetchval(
            "SELECT to_regclass('public.lug_state') IS NOT NULL"
        )
        if not legacy_exists:
            return
        row = await self.pool.fetchrow(
            "SELECT payload FROM lug_state WHERE id = 'primary'"
        )
        if not row:
            return
        state = normalize_db(_json_payload(row["payload"]), self.defaults)
        # The normalized meta revision starts at zero and is advanced by this write.
        state.revision = 0
        await self.save(state)

    async def load(self) -> DatabaseState:
        async with self.pool.acquire() as connection:
            settings = await connection.fetchval(
                "SELECT payload FROM lug_settings WHERE id = 1"
            )
            data: dict[str, Any] = {"settings": _json_payload(settings)}
            for key, table in ENTITY_TABLES.items():
                rows = await connection.fetch(
                    f"SELECT payload FROM {table} ORDER BY updated_at DESC"
                )
                data[key] = [_json_payload(row["payload"]) for row in rows]
            rows = await connection.fetch(
                "SELECT payload FROM lug_audit_log ORDER BY at DESC LIMIT 10000"
            )
            data["auditLog"] = [_json_payload(row["payload"]) for row in rows]
        state = normalize_db(data, self.defaults)
        state.revision = int(
            await self.pool.fetchval(
                "SELECT revision FROM lug_meta WHERE id = 'primary'"
            )
            or 0
        )
        state._postgres_snapshot = _snapshot(state)
        return state

    async def save(self, state: DatabaseState) -> None:
        previous = getattr(state, "_postgres_snapshot", {})
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                current_revision = int(
                    await connection.fetchval(
                        "SELECT revision FROM lug_meta WHERE id = 'primary' FOR UPDATE"
                    )
                    or 0
                )
                if int(getattr(state, "revision", 0)) != current_revision:
                    raise PersistenceError(
                        "Данные были изменены другим запросом. Повторите действие.", 409
                    )
                await connection.execute(
                    """INSERT INTO lug_settings (id, payload) VALUES (1, $1::jsonb)
                    ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload,
                    updated_at = now()""",
                    json.dumps(state.get("settings", {}), ensure_ascii=False),
                )
                for key, table in ENTITY_TABLES.items():
                    await self._sync_entities(connection, key, table, state, previous.get(key, {}))
                await self._sync_audit(connection, state, previous.get("auditLog", {}))
                revision = await connection.fetchval(
                    "UPDATE lug_meta SET revision = revision + 1, updated_at = now() "
                    "WHERE id = 'primary' RETURNING revision"
                )
                await connection.execute(
                    "DELETE FROM lug_sessions WHERE expires_at_ms < $1",
                    int(datetime.now(timezone.utc).timestamp() * 1000),
                )
                await connection.execute(
                    "DELETE FROM lug_audit_log WHERE at < now() - interval '730 days'"
                )
        state.revision = int(revision or 0)
        state._postgres_snapshot = _snapshot(state)

    async def _sync_entities(
        self, connection: Any, key: str, table: str, state: DatabaseState, previous: dict
    ) -> None:
        current = {
            _entity_id(key, item): item
            for item in state.get(key, [])
            if isinstance(item, dict) and _entity_id(key, item)
        }
        removed = set(previous) - set(current)
        if removed:
            key_column = "token_hash" if key == "sessions" else "url" if key == "uploads" else "id"
            await connection.executemany(
                f"DELETE FROM {table} WHERE {key_column} = $1",
                [(item_id,) for item_id in removed],
            )
        for item_id, item in current.items():
            if previous.get(item_id) == _fingerprint(item):
                continue
            values = _indexed_values(key, item)
            if key == "users":
                query = """INSERT INTO lug_users (id,email,phone,role,team_id,email_verified,payload)
                    VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT (id) DO UPDATE SET
                    email=EXCLUDED.email,phone=EXCLUDED.phone,role=EXCLUDED.role,
                    team_id=EXCLUDED.team_id,email_verified=EXCLUDED.email_verified,
                    payload=EXCLUDED.payload,updated_at=now()"""
            elif key == "teams":
                query = """INSERT INTO lug_teams (id,group_name,invite_code,captain_id,invite_status,payload)
                    VALUES ($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT (id) DO UPDATE SET
                    group_name=EXCLUDED.group_name,invite_code=EXCLUDED.invite_code,
                    captain_id=EXCLUDED.captain_id,invite_status=EXCLUDED.invite_status,
                    payload=EXCLUDED.payload,updated_at=now()"""
            elif key == "achievements":
                query = """INSERT INTO lug_achievements (id,user_id,status,payload)
                    VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (id) DO UPDATE SET
                    user_id=EXCLUDED.user_id,status=EXCLUDED.status,payload=EXCLUDED.payload,updated_at=now()"""
            elif key == "notifications":
                query = """INSERT INTO lug_notifications (id,target_type,target_id,kind,payload)
                    VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (id) DO UPDATE SET
                    target_type=EXCLUDED.target_type,target_id=EXCLUDED.target_id,
                    kind=EXCLUDED.kind,payload=EXCLUDED.payload,updated_at=now()"""
            elif key == "sessions":
                query = """INSERT INTO lug_sessions (id,token_hash,user_id,expires_at_ms,payload)
                    VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (id) DO UPDATE SET
                    token_hash=EXCLUDED.token_hash,user_id=EXCLUDED.user_id,
                    expires_at_ms=EXCLUDED.expires_at_ms,payload=EXCLUDED.payload,updated_at=now()"""
            elif key == "uploads":
                query = """INSERT INTO lug_uploads (url,user_id,kind,payload)
                    VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (url) DO UPDATE SET
                    user_id=EXCLUDED.user_id,kind=EXCLUDED.kind,payload=EXCLUDED.payload,updated_at=now()"""
            elif key == "passwordResets":
                query = """INSERT INTO lug_password_resets (id,email,expires_at_ms,payload)
                    VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (id) DO UPDATE SET
                    email=EXCLUDED.email,expires_at_ms=EXCLUDED.expires_at_ms,
                    payload=EXCLUDED.payload,updated_at=now()"""
            else:
                query = """INSERT INTO lug_email_verifications (id,email,expires_at_ms,payload)
                    VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (id) DO UPDATE SET
                    email=EXCLUDED.email,expires_at_ms=EXCLUDED.expires_at_ms,
                    payload=EXCLUDED.payload,updated_at=now()"""
            await connection.execute(query, item_id, *values, json.dumps(item, ensure_ascii=False))

    async def _sync_audit(self, connection: Any, state: DatabaseState, previous: dict) -> None:
        for item in state.get("auditLog", []):
            item_id = _entity_id("auditLog", item)
            if not item_id or previous.get(item_id) == _fingerprint(item):
                continue
            await connection.execute(
                """INSERT INTO lug_audit_log
                (id,actor_id,action,entity_type,entity_id,at,payload)
                VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT (id) DO NOTHING""",
                item_id, item.get("actorId", ""), item.get("action", ""),
                item.get("entityType", ""), item.get("entityId", ""),
                _audit_at(item.get("at")), json.dumps(item, ensure_ascii=False),
            )

    async def close(self) -> None:
        await self.pool.close()
    def health(self) -> dict[str, str]:
        return {"provider": self.provider, "schema": "normalized"}
