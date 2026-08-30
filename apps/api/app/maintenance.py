"""One-shot maintenance tasks for object-storage orphan cleanup."""

import asyncio
from time import time

from .config import create_config, default_settings
from .infrastructure.file_storage import create_file_storage
from .infrastructure.store import create_store


async def cleanup() -> int:
    config = create_config()
    store = await create_store(
        config.database_provider, config.data_dir, config.database_url,
        default_settings(), config.database_pool_min_size, config.database_pool_max_size,
        config.email_outbox_encryption_key, config.database_ssl_mode,
        config.database_ssl_root_cert,
    )
    storage = create_file_storage(config)
    try:
        if hasattr(store, "get_referenced_upload_urls"):
            referenced = await store.get_referenced_upload_urls()
        else:
            state = await store.load()
            referenced = {
                value
                for collection, key in (
                    (state.get("users", []), "studentCardFile"),
                    (state.get("achievements", []), "fileUrl"),
                    (state.get("teams", []), "flagUrl"),
                )
                for item in collection
                if (value := item.get(key))
            }
            referenced.update(
                (item.get("videoCard") or {}).get("url", "")
                for item in state.get("teams", [])
                if (item.get("videoCard") or {}).get("url")
            )
            referenced.update(
                (item.get("studentCard") or {}).get("url", "")
                for item in state.get("emailVerifications", [])
                if int(item.get("expiresAtMs", 0)) >= int(time() * 1000)
            )
            referenced.update(
                item.get("url", "")
                for item in state.get("uploads", [])
                if item.get("url")
            )
        return await storage.cleanup_orphans(referenced)
    finally:
        await store.close()


if __name__ == "__main__":
    print(f"removed_orphans={asyncio.run(cleanup())}")
