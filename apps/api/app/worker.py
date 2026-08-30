"""Standalone email outbox deployment unit."""

import asyncio
import signal

from .config import create_config, default_settings
from .infrastructure.email import EmailService
from .infrastructure.email_outbox import EmailOutboxWorker
from .infrastructure.store import create_store
from .observability import Logger, configure_logging


async def main() -> None:
    configure_logging()
    config = create_config()
    store = await create_store(
        config.database_provider, config.data_dir, config.database_url,
        default_settings(), config.database_pool_min_size, config.database_pool_max_size,
        config.email_outbox_encryption_key, config.database_ssl_mode,
        config.database_ssl_root_cert,
    )
    logger = Logger("lug-email-worker")
    service = EmailService(
        config.email_mode, config.smtp_host, config.smtp_port, config.smtp_user,
        config.smtp_password, config.smtp_from, config.smtp_from_name, config.smtp_ssl,
        config.smtp_starttls, config.email_log_code, logger,
    )
    worker = EmailOutboxWorker(store, service, logger)
    loop = asyncio.get_running_loop()
    for signal_name in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(signal_name, worker.stop_event.set)
        except NotImplementedError:
            signal.signal(signal_name, lambda *_: worker.stop_event.set())
    try:
        await worker.run()
    finally:
        await store.close()


if __name__ == "__main__":
    asyncio.run(main())
