"""Optional real S3-compatible multipart integration test (MinIO in CI/local)."""

import os
import tempfile
import unittest
from pathlib import Path
from urllib.request import Request, urlopen

from apps.api.app.infrastructure.s3_storage import S3FileStorage

S3_ENDPOINT = os.getenv("LUG_TEST_S3_ENDPOINT")


@unittest.skipUnless(S3_ENDPOINT, "LUG_TEST_S3_ENDPOINT is not configured")
class S3MultipartIntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.storage = S3FileStorage(
            bucket=os.getenv("LUG_TEST_S3_BUCKET", "lug-test"),
            region="us-east-1",
            endpoint_url=S3_ENDPOINT,
            access_key=os.getenv("LUG_TEST_S3_ACCESS_KEY", "minioadmin"),
            secret_key=os.getenv("LUG_TEST_S3_SECRET_KEY", "minioadmin"),
            prefix="integration",
            signed_url_ttl=300,
            temp_dir=Path(self.temp_dir.name),
            server_side_encryption="",
            intent_redis_url=os.getenv("LUG_TEST_REDIS_URL", ""),
        )
        try:
            self.storage.client.create_bucket(Bucket=self.storage.bucket)
        except self.storage.client.exceptions.BucketAlreadyOwnedByYou:
            pass

    async def asyncTearDown(self) -> None:
        self.temp_dir.cleanup()

    async def test_presigned_multipart_round_trip(self) -> None:
        size = 5 * 1024 * 1024
        data = b"M" * size
        intent = await self.storage.create_upload_intent(
            "video.mp4", "video/mp4", size, "video", "user-1"
        )
        request = Request(intent["parts"][0]["url"], data=data, method="PUT")
        with urlopen(request, timeout=30) as response:
            etag = response.headers["ETag"]
        completed = await self.storage.complete_upload(
            intent["uploadId"],
            intent["key"],
            "video.mp4",
            "video/mp4",
            [{"partNumber": 1, "etag": etag}],
            "user-1",
        )
        resolved = self.storage.resolve(completed["url"])
        self.assertEqual(await self.storage.read(resolved), data)
        self.assertIsNone(self.storage._load_intent(intent["uploadId"]))
        self.storage.client.delete_object(Bucket=self.storage.bucket, Key=intent["key"])


if __name__ == "__main__":
    unittest.main()
