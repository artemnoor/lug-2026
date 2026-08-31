"""Persistence adapter factory and JSON compatibility implementation.

The application layer consumes narrow repository ports from
``application.repositories``. This module only owns adapter construction and
the deliberately transitional single-file JSON backend.
"""

import asyncio
import json
import os
import time
from pathlib import Path
from typing import Any, Protocol
from uuid import uuid4

from .json_review_commands import JsonReviewCommandMixin
from .json_store_commands import JsonStoreCommandMixin
from .json_store_queries import JsonStoreQueryMixin


class PersistenceBackend(Protocol):
    """Minimal lifecycle contract for the composition root."""

    provider: str
    serializes_writes: bool

    async def close(self) -> None: ...


class JsonDatabaseState(dict):
    """JSON adapter state retained only for development/compatibility."""


def normalize_db(data: Any, defaults: dict) -> JsonDatabaseState:
    settings = data.get("settings", {}) if isinstance(data, dict) else {}
    content = settings.get("content", {}) if isinstance(settings, dict) else {}
    state = JsonDatabaseState(
        settings={**defaults, **(settings if isinstance(settings, dict) else {})},
        users=[],
        teams=[],
        achievements=[],
        notifications=[],
        auditLog=[],
        sessions=[],
        uploads=[],
        emailVerifications=[],
        passwordResets=[],
    )
    state["settings"]["content"] = {
        **defaults["content"],
        **(content if isinstance(content, dict) else {}),
    }
    if isinstance(data, dict):
        state.update(data)
    for key in (
        "users",
        "teams",
        "achievements",
        "notifications",
        "auditLog",
        "sessions",
        "uploads",
        "emailVerifications",
        "passwordResets",
    ):
        if not isinstance(state.get(key), list):
            state[key] = []
    state["notifications"] = [
        item for item in state["notifications"] if item.get("kind") != "chat"
    ]
    state["sessions"] = [
        {key: value for key, value in item.items() if key != "token"}
        for item in state["sessions"]
        if isinstance(item, dict)
    ]
    return state


class JsonStore(JsonStoreQueryMixin, JsonStoreCommandMixin, JsonReviewCommandMixin):
    """Single-process development adapter; not a production persistence model."""

    provider = "json"
    serializes_writes = True
    queues_email = False
    atomic_reviews = True
    atomic_password_reset = True
    atomic_registration = True

    def __init__(self, data_dir: Path, defaults: dict) -> None:
        self.file = data_dir / "lug.json"
        self.defaults = defaults
        data_dir.mkdir(parents=True, exist_ok=True)
        self.lock = asyncio.Lock()

    async def load(self) -> JsonDatabaseState:
        return await asyncio.to_thread(self._load_sync)

    def _load_sync(self) -> JsonDatabaseState:
        if not self.file.exists():
            return normalize_db(None, self.defaults)
        try:
            data = json.loads(self.file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeError(
                "Не удалось прочитать data/lug.json. Восстановите файл из резервной копии."
            ) from exc
        return normalize_db(data, self.defaults)

    async def save(self, state: JsonDatabaseState) -> None:
        async with self.lock:
            await asyncio.to_thread(self._save_sync, state)

    def _save_sync(self, state: JsonDatabaseState) -> None:
        temporary = self.file.with_name(
            f"{self.file.name}.{os.getpid()}.{uuid4().hex}.tmp"
        )
        temporary.write_text(
            json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        os.replace(temporary, self.file)

    async def get_settings(self) -> dict:
        return (await self.load())["settings"]

    async def get_user_by_email(self, email: str) -> dict | None:
        normalized = str(email or "").strip().lower()
        state = await self.load()
        return next(
            (
                user
                for user in state["users"]
                if str(user.get("email", "")).strip().lower() == normalized
            ),
            None,
        )

    async def get_user_by_id(self, user_id: str) -> dict | None:
        state = await self.load()
        return next(
            (user for user in state["users"] if user.get("id") == user_id), None
        )

    async def get_user_by_session(self, token_hash: str) -> dict | None:
        state = await self.load()
        now_ms = int(time.time() * 1000)
        session = next(
            (
                item
                for item in state["sessions"]
                if item.get("tokenHash") == token_hash
                and int(item.get("expiresAt", 0) or 0) >= now_ms
            ),
            None,
        )
        if not session:
            return None
        return next(
            (
                user
                for user in state["users"]
                if user.get("id") == session.get("userId")
            ),
            None,
        )

    async def get_invite(self, code: str) -> dict | None:
        state = await self.load()
        now_ms = int(time.time() * 1000)
        return next(
            (
                team
                for team in state["teams"]
                if team.get("inviteCode") == code
                and team.get("inviteStatus") == "active"
                and _timestamp_ms(team.get("inviteExpiresAt")) >= now_ms
            ),
            None,
        )

    async def get_dashboard_projection(self, user_id: str) -> dict | None:
        state = await self.load()
        if not any(user.get("id") == user_id for user in state["users"]):
            return None
        return state

    async def get_admin_overview(self) -> dict:
        from ..shared.projections import admin_snapshot

        return admin_snapshot(await self.load())

    def health(self) -> dict[str, str]:
        return {"provider": self.provider, "file": str(self.file)}

    async def close(self) -> None:
        return None


def _timestamp_ms(value: Any) -> float:
    from datetime import datetime

    try:
        return (
            datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp() * 1000
        )
    except (TypeError, ValueError):
        return float("nan")


async def create_store(
    provider: str,
    data_dir: Path,
    database_url: str,
    defaults: dict,
    pool_min_size: int = 2,
    pool_max_size: int = 20,
    email_outbox_encryption_key: bytes | None = None,
    database_ssl_mode: str = "disable",
    database_ssl_root_cert: str = "",
) -> PersistenceBackend:
    if provider == "postgres":
        if not database_url:
            raise RuntimeError(
                "LUG_DATABASE_PROVIDER=postgres требует LUG_DATABASE_URL или DATABASE_URL."
            )
        from .postgres import PostgresStore

        return await PostgresStore.create(
            database_url,
            defaults,
            pool_min_size,
            pool_max_size,
            email_outbox_encryption_key,
            database_ssl_mode,
            database_ssl_root_cert,
        )
    return JsonStore(data_dir, defaults)
