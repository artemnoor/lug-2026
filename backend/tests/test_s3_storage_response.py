"""Private S3 uploads are streamed through the authenticated API."""

from __future__ import annotations

import asyncio
from io import BytesIO
from types import SimpleNamespace

import pytest
from starlette.requests import Request

from app.infrastructure.storage import S3Storage


class FakeS3Client:
    def __init__(self, content: bytes) -> None:
        self.content = content
        self.calls: list[dict[str, str]] = []

    def get_object(self, **params):
        self.calls.append(params)
        byte_range = params.get("Range")
        if byte_range:
            start_text, end_text = byte_range.removeprefix("bytes=").split("-", 1)
            start, end = int(start_text), int(end_text)
            body = self.content[start : end + 1]
        else:
            body = self.content
        return {"Body": BytesIO(body), "ContentType": "image/png"}


def _request(*, byte_range: str = "") -> Request:
    headers = [(b"range", byte_range.encode())] if byte_range else []
    return Request(
        {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": "/uploads/proof.png",
            "raw_path": b"/uploads/proof.png",
            "query_string": b"",
            "headers": headers,
            "client": ("127.0.0.1", 1234),
            "server": ("127.0.0.1", 8000),
            "state": {"request_id": "request-123"},
        }
    )


async def _response_body(response) -> bytes:
    return b"".join([chunk async for chunk in response.body_iterator])


@pytest.mark.asyncio
async def test_s3_private_upload_streams_through_api_and_supports_byte_ranges():
    client = FakeS3Client(b"abcdefghij")
    storage = object.__new__(S3Storage)
    storage.settings = SimpleNamespace(s3_bucket="test-bucket")
    storage.client = client
    upload = {
        "storage_key": "uploads/proof.png",
        "content_type": "image/png",
        "original_name": "proof image.png",
        "size_bytes": 10,
    }

    full_response = await storage.response(upload, _request())
    assert full_response.status_code == 200
    assert full_response.headers["content-length"] == "10"
    assert full_response.headers["cache-control"] == "private, no-store"
    assert full_response.headers["x-request-id"] == "request-123"
    assert full_response.headers["content-disposition"] == "inline; filename*=UTF-8''proof%20image.png"
    assert await _response_body(full_response) == b"abcdefghij"
    assert client.calls[-1] == {"Bucket": "test-bucket", "Key": "uploads/proof.png"}

    range_response = await storage.response(upload, _request(byte_range="bytes=2-5"))
    assert range_response.status_code == 206
    assert range_response.headers["content-range"] == "bytes 2-5/10"
    assert range_response.headers["content-length"] == "4"
    assert range_response.headers["accept-ranges"] == "bytes"
    assert await _response_body(range_response) == b"cdef"
    assert client.calls[-1]["Range"] == "bytes=2-5"


def test_s3_storage_response_rejects_unsatisfiable_ranges_without_fetching_object():
    client = FakeS3Client(b"abcdefghij")
    storage = object.__new__(S3Storage)
    storage.settings = SimpleNamespace(s3_bucket="test-bucket")
    storage.client = client

    response = asyncio.run(
        storage.response(
            {
                "storage_key": "uploads/proof.png",
                "content_type": "image/png",
                "original_name": "proof.png",
                "size_bytes": 10,
            },
            _request(byte_range="bytes=10-"),
        )
    )
    assert response.status_code == 416
    assert response.headers["content-range"] == "bytes */10"
    assert client.calls == []
