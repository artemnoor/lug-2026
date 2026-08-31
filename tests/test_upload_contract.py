import tempfile
import unittest
from pathlib import Path

from apps.api.app.http.errors import ApiError
from apps.api.app.infrastructure.local_storage import LocalFileStorage
from apps.api.app.infrastructure.persistence_errors import PersistenceError
from apps.api.app.infrastructure.postgres_entity_writes import upload_identity
from apps.api.app.infrastructure.s3_storage import S3FileStorage
from apps.api.app.infrastructure.upload_scan_worker import UploadScanWorker
from apps.api.app.security.auth import (
    issue_registration_upload_claim,
    verify_registration_upload_claim,
)


class UploadContractTests(unittest.IsolatedAsyncioTestCase):
    def test_postgres_upload_identity_is_uuid_and_not_url(self):
        upload_id = upload_identity(
            {"id": "12345678-1234-4234-8234-123456789abc", "url": "/uploads/file.png"}
        )
        self.assertEqual(upload_id, "12345678-1234-4234-8234-123456789abc")
        with self.assertRaises(PersistenceError):
            upload_identity({"id": "/uploads/file.png"})

    def test_s3_multipart_intent_can_be_stored_outside_process_memory(self):
        class Redis:
            def __init__(self):
                self.values = {}

            def set(self, key, value, ex):
                self.values[key] = value

            def get(self, key):
                return self.values.get(key)

            def delete(self, key):
                self.values.pop(key, None)

        storage = object.__new__(S3FileStorage)
        storage._intent_redis = Redis()
        storage._multipart_intents = {}
        intent = {"key": "uploads/a.mp4", "ownerId": "user-1", "size": 10}
        storage._store_intent("upload-1", intent)
        self.assertEqual(storage._load_intent("upload-1"), intent)
        storage._delete_intent("upload-1")
        self.assertIsNone(storage._load_intent("upload-1"))

    async def test_local_adapter_requires_object_storage_for_multipart(self):
        with tempfile.TemporaryDirectory() as directory:
            storage = LocalFileStorage(Path(directory))
            with self.assertRaises(ApiError) as error:
                await storage.create_upload_intent("video.mp4", "video/mp4", 1, "video")
            self.assertEqual(error.exception.status_code, 501)

    async def test_local_stream_does_not_require_base64_payload(self):
        async def chunks():
            yield bytes.fromhex("89504e470d0a1a0a")
            yield b"streamed-payload"

        with tempfile.TemporaryDirectory() as directory:
            storage = LocalFileStorage(Path(directory))
            uploaded = await storage.save_stream(
                chunks(), "proof.png", "image/png", 1024
            )
            self.assertEqual(uploaded["size"], 24)
            self.assertTrue(await storage.exists(storage.resolve(uploaded["url"])))

    async def test_upload_scan_worker_moves_pending_upload_to_clean(self):
        class Store:
            def __init__(self):
                self.upload = {
                    "id": "upload-1",
                    "url": "/uploads/file.png",
                    "status": "uploaded",
                    "scanStatus": "pending",
                }
                self.result = None

            async def claim_upload_for_scan(self):
                if self.upload:
                    item, self.upload = self.upload, None
                    return item
                return None

            async def finish_upload_scan_atomic(
                self, upload_id, status, scan_status, error=""
            ):
                self.result = (upload_id, status, scan_status, error)

        class Storage:
            def resolve(self, url):
                return {"url": url}

            async def read(self, resolved):
                return bytes.fromhex("89504e470d0a1a0a")

        class Logger:
            def info(self, *args):
                pass

            def error(self, *args):
                pass

        store = Store()
        worker = UploadScanWorker(store, Storage(), "", False, Logger())
        self.assertTrue(await worker.run_once())
        self.assertEqual(store.result[:3], ("upload-1", "clean", "clean"))

    def test_registration_upload_claim_is_bound_to_secret_and_expiry(self):
        token = issue_registration_upload_claim("s" * 32, "owner", "/uploads/a.png")
        self.assertEqual(
            verify_registration_upload_claim(token, "s" * 32)["url"], "/uploads/a.png"
        )
        self.assertIsNone(verify_registration_upload_claim(token + "x", "s" * 32))
        self.assertIsNone(verify_registration_upload_claim(token, "t" * 32))
