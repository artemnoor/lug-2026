"""Persistence protocol, JSON compatibility store, and provider factory."""

import asyncio
import json
import os
from pathlib import Path
from typing import Any, Protocol
from uuid import uuid4


class DatabaseState(dict):
    """JSON-compatible state with an internal optimistic-lock revision."""

    revision: int = 0


def normalize_db(data: Any, defaults: dict) -> DatabaseState:
    settings = data.get("settings", {}) if isinstance(data, dict) else {}
    content = settings.get("content", {}) if isinstance(settings, dict) else {}
    state = DatabaseState(
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
    # Переписки больше не являются частью продукта. Старые записи не должны
    # попадать ни в API, ни обратно в persistent store после следующей записи.
    state["notifications"] = [
        item for item in state["notifications"] if item.get("kind") != "chat"
    ]
    state["sessions"] = [
        {key: value for key, value in item.items() if key != "token"}
        for item in state["sessions"]
        if isinstance(item, dict)
    ]
    return state


class Store(Protocol):
    provider: str
    serializes_writes: bool

    async def load(self) -> DatabaseState: ...

    async def save(self, state: DatabaseState) -> None: ...

    async def close(self) -> None: ...


class JsonStore:
    provider = "json"
    serializes_writes = True

    def __init__(self, data_dir: Path, defaults: dict) -> None:
        self.file = data_dir / "lug.json"
        self.defaults = defaults
        data_dir.mkdir(parents=True, exist_ok=True)
        self.lock = asyncio.Lock()

    async def load(self) -> DatabaseState:
        return await asyncio.to_thread(self._load_sync)

    def _load_sync(self) -> DatabaseState:
        if not self.file.exists():
            return normalize_db(None, self.defaults)
        try:
            data = json.loads(self.file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeError(
                "Не удалось прочитать data/lug.json. Восстановите файл из резервной копии."
            ) from exc
        return normalize_db(data, self.defaults)

    async def save(self, state: DatabaseState) -> None:
        async with self.lock:
            await asyncio.to_thread(self._save_sync, state)

    def _save_sync(self, state: DatabaseState) -> None:
        temporary = self.file.with_name(
            f"{self.file.name}.{os.getpid()}.{uuid4().hex}.tmp"
        )
        temporary.write_text(
            json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        os.replace(temporary, self.file)

    async def close(self) -> None:
        return None

    def health(self) -> dict:
        return {"provider": self.provider, "file": str(self.file)}


async def create_store(
    provider: str,
    data_dir: Path,
    database_url: str,
    defaults: dict,
    pool_min_size: int = 2,
    pool_max_size: int = 20,
) -> Store:
    if provider == "postgres":
        if not database_url:
            raise RuntimeError(
                "LUG_DATABASE_PROVIDER=postgres требует LUG_DATABASE_URL или DATABASE_URL."
            )
        from .postgres import PostgresStore

        return await PostgresStore.create(
            database_url, defaults, pool_min_size, pool_max_size
        )
    return JsonStore(data_dir, defaults)
