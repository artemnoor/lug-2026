"""Durable PostgreSQL email outbox worker."""

import asyncio
from typing import Any


class EmailOutboxWorker:
    def __init__(self, store: Any, email_service: Any, logger: Any) -> None:
        self.store = store
        self.email_service = email_service
        self.logger = logger
        self.stop_event = asyncio.Event()

    async def run(self, poll_seconds: float = 2.0) -> None:
        await self.store.requeue_stale_emails()
        while not self.stop_event.is_set():
            processed = await self.run_once()
            if not processed:
                try:
                    await asyncio.wait_for(self.stop_event.wait(), poll_seconds)
                except asyncio.TimeoutError:
                    pass

    async def run_once(self) -> bool:
        try:
            message = await self.store.claim_email()
        except Exception as error:
            self.logger.error("email.outbox_claim_failed", {"error": str(error)[:1000]})
            return False
        if not message:
            return False
        try:
            payload = message["payload"]
            if message["purpose"] == "verification":
                await self.email_service.send_verification_code(
                    message["recipient"], payload["code"], payload["expiresMinutes"]
                )
            elif message["purpose"] == "password-reset":
                await self.email_service.send_password_reset_code(
                    message["recipient"], payload["code"], payload["expiresMinutes"]
                )
            else:
                await self.email_service.send_notification(
                    message["recipient"], payload["title"], payload["message"]
                )
        except Exception as error:
            self.logger.error(
                "email.outbox_failed",
                {"messageId": str(message["id"]), "error": str(error)[:1000]},
            )
            await self.store.finish_email(message["id"], str(error))
        else:
            await self.store.finish_email(message["id"])
        return True
