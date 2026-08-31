"""Import a legacy ``lug.json`` into the normalized PostgreSQL schema once.

Run ``python scripts/migrate.py`` before this command. The importer deliberately
does not execute DDL: schema ownership stays with Alembic and the release job.
"""

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import asyncpg

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "apps" / "api"))

from app.config import default_settings  # noqa: E402
from app.infrastructure.postgres import _postgres_ssl_context  # noqa: E402
from app.infrastructure.store import normalize_db  # noqa: E402


def _json(value: Any) -> str:
    return json.dumps(value if isinstance(value, dict) else {}, ensure_ascii=False)


def _text(value: Any) -> str:
    return str(value or "")


def _number(value: Any, default: int = 0) -> int:
    try:
        return int(value or default)
    except (TypeError, ValueError):
        return default


def _decimal(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _timestamp(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    raw = _text(value)
    if raw:
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def _upload_id(item: dict[str, Any]) -> str:
    for candidate in (item.get("uploadId"), item.get("id")):
        try:
            return str(UUID(str(candidate)))
        except (ValueError, TypeError, AttributeError):
            continue
    return str(uuid4())


async def _require_schema(connection: asyncpg.Connection) -> None:
    tables = (
        "lug_settings",
        "lug_users",
        "lug_teams",
        "lug_achievements",
        "lug_notifications",
        "lug_sessions",
        "lug_uploads",
        "lug_email_verifications",
        "lug_password_resets",
        "lug_audit_log",
        "lug_email_outbox",
    )
    missing = await connection.fetch(
        """
        SELECT table_name
        FROM unnest($1::text[]) AS requested(table_name)
        WHERE to_regclass('public.' || requested.table_name) IS NULL
        """,
        list(tables),
    )
    if missing:
        names = ", ".join(row["table_name"] for row in missing)
        raise RuntimeError(
            "Нормализованная схема не готова. Выполните миграции перед импортом: "
            f"{names}"
        )


async def _insert_settings(connection: asyncpg.Connection, settings: dict) -> None:
    await connection.execute(
        "INSERT INTO lug_settings (id, payload) VALUES (1, $1::jsonb)",
        _json(settings),
    )


async def _insert_teams(connection: asyncpg.Connection, teams: list[dict]) -> None:
    for team in teams:
        review = team.get("review") or {}
        video = team.get("videoCard") or {}
        await connection.execute(
            """
            INSERT INTO lug_teams
            (id, name, group_name, member_limit, invite_code, captain_id,
             invite_status, flag_url, video_url, video_status, video_score,
             quota_confirmed, review_name_status, review_group_status,
             review_flag_status, review_description_status, payload)
            VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)
            """,
            _text(team.get("id")),
            _text(team.get("name")),
            _text(team.get("group")),
            max(1, _number(team.get("totalStudentsInGroup"), 1)),
            _text(team.get("inviteCode")),
            _text(team.get("inviteStatus")) or "active",
            _text(team.get("flagUrl")),
            _text(video.get("url")),
            _text(video.get("status")),
            _decimal(video.get("score")),
            bool(team.get("isQuotaConfirmed", False)),
            _text((review.get("name") or {}).get("status")),
            _text((review.get("group") or {}).get("status")),
            _text((review.get("flag") or {}).get("status")),
            _text((review.get("description") or {}).get("status")),
            _json(team),
        )


async def _insert_users(connection: asyncpg.Connection, users: list[dict]) -> None:
    for user in users:
        await connection.execute(
            """
            INSERT INTO lug_users
            (id,email,phone,role,team_id,email_verified,fio,identity_status,
             avatar_url,student_card_file,payload)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
            """,
            _text(user.get("id")),
            _text(user.get("email")),
            _text(user.get("phone")),
            _text(user.get("role")),
            _text(user.get("teamId")) or None,
            user.get("emailVerified") is True,
            _text(user.get("fio")),
            _text(user.get("identityStatus")),
            _text(user.get("avatarUrl")),
            _text(user.get("studentCardFile")),
            _json(user),
        )
    for user in users:
        if user.get("role") == "captain" and user.get("teamId"):
            await connection.execute(
                "UPDATE lug_teams SET captain_id = $2 WHERE id = $1",
                _text(user.get("teamId")),
                _text(user.get("id")),
            )


async def _insert_uploads(
    connection: asyncpg.Connection, uploads: list[dict]
) -> dict[str, str]:
    by_url: dict[str, str] = {}
    for item in uploads:
        url = _text(item.get("url"))
        if not url:
            continue
        upload_id = _upload_id(item)
        by_url[url] = upload_id
        payload = {**item, "id": upload_id, "uploadId": upload_id}
        await connection.execute(
            """
            INSERT INTO lug_uploads
            (upload_id,url,user_id,kind,status,scan_status,storage_key,mime_type,
             size_bytes,created_at,payload)
            VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
            """,
            upload_id,
            url,
            _text(item.get("userId")),
            _text(item.get("kind")) or "attachment",
            _text(item.get("status")) or "uploaded",
            _text(item.get("scanStatus")) or "clean",
            _text(item.get("storageKey")),
            _text(item.get("type")),
            max(0, _number(item.get("size"))),
            _timestamp(item.get("createdAt")),
            _json(payload),
        )
    return by_url


async def _insert_achievements(
    connection: asyncpg.Connection,
    achievements: list[dict],
    upload_ids: dict[str, str],
) -> None:
    for item in achievements:
        file_url = _text(item.get("fileUrl"))
        await connection.execute(
            """
            INSERT INTO lug_achievements
            (id,user_id,status,direction,points,file_url,file_upload_id,title,payload)
            VALUES ($1,$2,$3,$4,$5,$6,$7::uuid,$8,$9::jsonb)
            """,
            _text(item.get("id")) or str(uuid4()),
            _text(item.get("userId")),
            _text(item.get("status")),
            _text(item.get("direction")),
            _decimal(item.get("points")),
            file_url,
            upload_ids.get(file_url),
            _text(item.get("title")),
            _json(item),
        )


async def _insert_notifications(
    connection: asyncpg.Connection, notifications: list[dict]
) -> None:
    for item in notifications:
        await connection.execute(
            """
            INSERT INTO lug_notifications
            (id,target_type,target_id,kind,title,message,created_at,payload)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
            """,
            _text(item.get("id")) or str(uuid4()),
            _text(item.get("targetType")),
            _text(item.get("targetId")) or None,
            _text(item.get("kind")) or "system",
            _text(item.get("title")),
            _text(item.get("message")),
            _timestamp(item.get("createdAt")),
            _json(item),
        )


async def _insert_sessions(
    connection: asyncpg.Connection, sessions: list[dict]
) -> None:
    for item in sessions:
        token_hash = _text(item.get("tokenHash"))
        if not token_hash:
            continue
        await connection.execute(
            """
            INSERT INTO lug_sessions (id,token_hash,user_id,expires_at_ms,payload)
            VALUES ($1,$2,$3,$4,$5::jsonb)
            """,
            _text(item.get("id")) or token_hash,
            token_hash,
            _text(item.get("userId")),
            _number(item.get("expiresAtMs")),
            _json(item),
        )


async def _insert_expiring_rows(
    connection: asyncpg.Connection,
    table: str,
    rows: list[dict],
) -> None:
    statement = (
        f"INSERT INTO {table} (id,email,expires_at_ms,payload) "
        "VALUES ($1,$2,$3,$4::jsonb)"
    )
    for item in rows:
        await connection.execute(
            statement,
            _text(item.get("id")) or str(uuid4()),
            _text(item.get("email")),
            _number(item.get("expiresAtMs")),
            _json(item),
        )


async def _insert_audit_log(connection: asyncpg.Connection, rows: list[dict]) -> None:
    for item in rows:
        await connection.execute(
            """
            INSERT INTO lug_audit_log
            (id,actor_id,action,entity_type,entity_id,at,payload)
            VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
            """,
            _text(item.get("id")) or str(uuid4()),
            _text(item.get("actorId")),
            _text(item.get("action")),
            _text(item.get("entityType")),
            _text(item.get("entityId")),
            _timestamp(item.get("at")),
            _json(item),
        )


async def _insert_email_outbox(
    connection: asyncpg.Connection, rows: list[dict]
) -> None:
    for item in rows:
        try:
            item_id = str(UUID(_text(item.get("id"))))
        except (ValueError, TypeError):
            item_id = str(uuid4())
        await connection.execute(
            """
            INSERT INTO lug_email_outbox
            (id,recipient,purpose,payload,status,attempts,available_at,sent_at,last_error)
            VALUES ($1::uuid,$2,$3,$4::jsonb,$5,$6,$7,$8,$9)
            """,
            item_id,
            _text(item.get("recipient")),
            _text(item.get("purpose")) or "notification",
            _json(item.get("payload") or item),
            _text(item.get("status")) or "pending",
            max(0, _number(item.get("attempts"))),
            _timestamp(item.get("availableAt")),
            _timestamp(item.get("sentAt")) if item.get("sentAt") else None,
            _text(item.get("lastError")) or None,
        )


async def import_state(database_url: str, source: Path) -> None:
    raw = source.read_text(encoding="utf-8")
    data = json.loads(raw)
    if not isinstance(data, dict):
        raise RuntimeError("Исходный JSON должен содержать объект состояния.")

    state = normalize_db(data, default_settings())
    pool = await asyncpg.create_pool(
        database_url,
        min_size=1,
        max_size=2,
        timeout=10,
        ssl=_postgres_ssl_context(
            os.getenv("LUG_DATABASE_SSL_MODE", "disable"),
            os.getenv("LUG_DATABASE_SSL_ROOT_CERT", ""),
        ),
    )
    try:
        async with pool.acquire() as connection:
            await _require_schema(connection)
            if await connection.fetchval(
                "SELECT EXISTS (SELECT 1 FROM lug_settings WHERE id = 1)"
            ):
                raise RuntimeError("PostgreSQL уже инициализирован; импорт остановлен.")
            async with connection.transaction():
                await _insert_settings(connection, state["settings"])
                await _insert_teams(connection, state["teams"])
                await _insert_users(connection, state["users"])
                upload_ids = await _insert_uploads(connection, state["uploads"])
                await _insert_achievements(
                    connection, state["achievements"], upload_ids
                )
                await _insert_notifications(connection, state["notifications"])
                await _insert_sessions(connection, state["sessions"])
                await _insert_expiring_rows(
                    connection, "lug_email_verifications", state["emailVerifications"]
                )
                await _insert_expiring_rows(
                    connection, "lug_password_resets", state["passwordResets"]
                )
                await _insert_audit_log(connection, state["auditLog"])
                outbox = data.get("emailOutbox", [])
                await _insert_email_outbox(
                    connection, outbox if isinstance(outbox, list) else []
                )
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
