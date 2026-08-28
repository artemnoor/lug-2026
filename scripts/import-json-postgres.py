"""Import a legacy lug.json into the normalized PostgreSQL adapter once."""

import argparse
import asyncio
import json
from pathlib import Path

import asyncpg
from app.config import default_settings
from app.infrastructure.postgres import SCHEMA, PostgresStore
from app.infrastructure.store import normalize_db


async def import_state(database_url: str, source: Path) -> None:
    raw = source.read_text(encoding="utf-8")
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise RuntimeError("Исходный JSON должен содержать объект состояния.")
    pool = await asyncpg.create_pool(database_url, min_size=1, max_size=2, timeout=10)
    try:
        await pool.execute(SCHEMA)
        initialized = await pool.fetchval(
            "SELECT EXISTS (SELECT 1 FROM lug_settings WHERE id = 1)"
        )
        if initialized:
            raise RuntimeError("PostgreSQL уже инициализирован; импорт остановлен.")
        state = normalize_db(data, default_settings())
        await pool.execute(
            """CREATE TABLE IF NOT EXISTS lug_state (
                id text PRIMARY KEY,
                revision bigint NOT NULL,
                payload jsonb NOT NULL,
                updated_at timestamptz NOT NULL DEFAULT now()
            )"""
        )
        await pool.execute(
            """INSERT INTO lug_state (id, revision, payload)
            VALUES ('primary', 0, $1::jsonb)
            ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload""",
            json.dumps(state, ensure_ascii=False),
        )
        store = PostgresStore(pool, default_settings())
        await store._migrate_legacy()
        await pool.execute("DROP TABLE lug_state")
    finally:
        await pool.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--database-url", required=True)
    args = parser.parse_args()
    asyncio.run(import_state(args.database_url, args.source.resolve()))
    print("JSON imported into normalized PostgreSQL")


if __name__ == "__main__":
    main()
