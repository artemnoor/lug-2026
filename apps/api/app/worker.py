"""Standalone email outbox deployment unit."""

import asyncio
import os
import signal
from pathlib import Path

from .config import create_config, default_settings
from .infrastructure.email import EmailService
from .infrastructure.email_outbox import EmailOutboxWorker
from .infrastructure.file_storage import create_file_storage
from .infrastructure.store import create_store
from .infrastructure.upload_scan_worker import UploadScanWorker
from .observability import Logger, configure_logging


async def main() -> None:
    configure_logging()
    config = create_config()
    store = await create_store(
        config.database_provider,
        config.data_dir,
        config.database_url,
        default_settings(),
        config.database_pool_min_size,
        config.database_pool_max_size,
        config.email_outbox_encryption_key,
        config.database_ssl_mode,
        config.database_ssl_root_cert,
    )
    logger = Logger(
        "lug-email-worker",
        allow_sensitive_codes=config.email_log_code
        and os.getenv("LUG_ENV", os.getenv("NODE_ENV", "development")).lower()
        not in {"production", "staging"},
    )
    service = EmailService(
        config.email_mode,
        config.smtp_host,
        config.smtp_port,
        config.smtp_user,
        config.smtp_password,
        config.smtp_from,
        config.smtp_from_name,
        config.smtp_ssl,
        config.smtp_starttls,
        config.email_log_code,
        logger,
    )
    worker = EmailOutboxWorker(store, service, logger)
    scan_worker = UploadScanWorker(
        store,
        create_file_storage(config),
        config.upload_scan_command,
        config.upload_scan_required,
        logger,
    )
    heartbeat = Path(
        os.getenv("LUG_WORKER_HEARTBEAT", "/tmp/lug-email-worker.heartbeat")
    )

    async def heartbeat_loop() -> None:
        while not worker.stop_event.is_set():
            try:
                heartbeat.touch()
            except OSError:
                logger.warning("worker.heartbeat_failed")
            try:
                await asyncio.wait_for(worker.stop_event.wait(), 15)
            except asyncio.TimeoutError:
                pass

    loop = asyncio.get_running_loop()
    for signal_name in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(signal_name, worker.stop_event.set)
        except NotImplementedError:
            signal.signal(signal_name, lambda *_: worker.stop_event.set())
    try:
        heartbeat_task = asyncio.create_task(heartbeat_loop())
        try:
            scan_task = asyncio.create_task(scan_worker.run())
            try:
                await worker.run()
            finally:
                scan_worker.stop_event.set()
                await asyncio.gather(scan_task, return_exceptions=True)
        finally:
            heartbeat_task.cancel()
            await asyncio.gather(heartbeat_task, return_exceptions=True)
    finally:
        await store.close()


if __name__ == "__main__":
    asyncio.run(main())
