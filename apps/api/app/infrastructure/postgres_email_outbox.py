"""Encrypted, claim-safe PostgreSQL email outbox operations."""

import json
from typing import Any
from uuid import uuid4

from ..security.encryption import decrypt_json, encrypt_json
from .postgres_queries import payload


class PostgresEmailOutboxMixin:
    async def _enqueue_email(
        self, connection: Any, recipient: str, purpose: str, message: dict
    ) -> None:
        encrypted = encrypt_json(message, self.email_outbox_encryption_key)
        await connection.execute(
            """INSERT INTO lug_email_outbox (id, recipient, purpose, payload)
            VALUES ($1, $2, $3, $4::jsonb)""",
            uuid4(), recipient, purpose, json.dumps(encrypted, ensure_ascii=False),
        )

    async def enqueue_email(self, recipient: str, purpose: str, message: dict) -> None:
        async with self.pool.acquire() as connection:
            async with connection.transaction():
                await self._enqueue_email(connection, recipient, purpose, message)
                await self._bump_revision(connection)

    async def requeue_stale_emails(self) -> None:
        await self.pool.execute(
            """UPDATE lug_email_outbox SET status = 'pending', available_at = now()
            WHERE status = 'sending' AND created_at < now() - interval '10 minutes'"""
        )

    async def claim_email(self) -> dict | None:
        row = await self.pool.fetchrow(
            """WITH next_email AS (
                SELECT id FROM lug_email_outbox
                WHERE status IN ('pending', 'failed') AND available_at <= now()
                ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1
            )
            UPDATE lug_email_outbox AS outbox
            SET status = 'sending', attempts = attempts + 1
            FROM next_email WHERE outbox.id = next_email.id
            RETURNING outbox.id, outbox.recipient, outbox.purpose, outbox.payload,
                      outbox.attempts"""
        )
        if not row:
            return None
        try:
            decrypted_payload = decrypt_json(
                payload(row["payload"]), self.email_outbox_encryption_key
            )
        except ValueError as exc:
            await self.pool.execute(
                """UPDATE lug_email_outbox SET status = 'failed', last_error = $2,
                available_at = now() + interval '1 hour' WHERE id = $1""",
                row["id"], "email outbox encryption failure",
            )
            raise RuntimeError("Email outbox payload не удалось расшифровать.") from exc
        return {
            "id": row["id"],
            "recipient": row["recipient"],
            "purpose": row["purpose"],
            "payload": decrypted_payload,
            "attempts": row["attempts"],
        }

    async def finish_email(self, message_id: Any, error: str | None = None) -> None:
        if error:
            await self.pool.execute(
                """UPDATE lug_email_outbox SET status = 'failed', last_error = $2,
                available_at = now() + LEAST(interval '1 hour', interval '5 minutes' *
                GREATEST(attempts, 1)) WHERE id = $1""",
                message_id, error[:1000],
            )
            return
        await self.pool.execute(
            """UPDATE lug_email_outbox
            SET status = 'sent', sent_at = now(), last_error = NULL,
                payload = '{"redacted":true,"version":1}'::jsonb
            WHERE id = $1""",
            message_id,
        )
