"""One-shot maintenance tasks for object-storage orphan cleanup."""

import asyncio

from .config import create_config, default_settings
from .infrastructure.file_storage import create_file_storage
from .infrastructure.store import create_store


async def cleanup() -> int:
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
    storage = create_file_storage(config)
    try:
        expired = await store.cleanup_expired_records()
        referenced = await store.get_referenced_upload_urls()
        orphaned = await storage.cleanup_orphans(referenced)
        print(f"expired_records={expired} removed_orphans={orphaned}")
        return orphaned
    finally:
        await store.close()


if __name__ == "__main__":
    print(f"removed_orphans={asyncio.run(cleanup())}")
