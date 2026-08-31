"""Background antivirus scanner for uploads already stored in object storage."""

import asyncio
import tempfile
from pathlib import Path
from typing import Any

from .file_storage import scan_file


class UploadScanWorker:
    def __init__(
        self,
        store: Any,
        storage: Any,
        scan_command: str,
        scan_required: bool,
        logger: Any,
    ) -> None:
        self.store = store
        self.storage = storage
        self.scan_command = scan_command
        self.scan_required = scan_required
        self.logger = logger
        self.stop_event = asyncio.Event()

    async def run(self, poll_seconds: float = 5.0) -> None:
        while not self.stop_event.is_set():
            try:
                processed = await self.run_once()
            except Exception as error:
                self.logger.error(
                    "upload.scan_loop_failed", {"error": str(error)[:500]}
                )
                processed = False
            if not processed:
                try:
                    await asyncio.wait_for(self.stop_event.wait(), poll_seconds)
                except asyncio.TimeoutError:
                    pass

    async def run_once(self) -> bool:
        upload = await self.store.claim_upload_for_scan()
        if not upload:
            return False
        upload_id = str(upload.get("uploadId") or upload.get("id") or upload.get("url"))
        temporary: Path | None = None
        try:
            resolved = self.storage.resolve(upload.get("url", ""))
            if not resolved:
                raise RuntimeError("upload storage key is invalid")
            with tempfile.NamedTemporaryFile(
                prefix="lug-scan-", suffix=".upload", delete=False
            ) as handle:
                temporary = Path(handle.name)
            download_to_file = getattr(self.storage, "download_to_file", None)
            if download_to_file:
                await download_to_file(resolved, temporary)
            else:
                data = await self.storage.read(resolved)
                await asyncio.to_thread(temporary.write_bytes, data)
            await asyncio.to_thread(
                scan_file, temporary, self.scan_command, self.scan_required
            )
        except Exception as error:
            message = str(error)[:500]
            rejected = (
                "не прошёл антивирус" in message.lower()
                or "infected" in message.lower()
            )
            await self.store.finish_upload_scan_atomic(
                upload_id,
                "rejected" if rejected else "uploaded",
                "rejected" if rejected else "error",
                message,
            )
            self.logger.error(
                "upload.scan_failed", {"uploadId": upload_id, "error": message}
            )
        else:
            await self.store.finish_upload_scan_atomic(upload_id, "clean", "clean")
            self.logger.info("upload.scan_clean", {"uploadId": upload_id})
        finally:
            if temporary:
                temporary.unlink(missing_ok=True)
        return True
