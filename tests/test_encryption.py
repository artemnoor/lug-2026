"""Authenticated encryption and local upload-at-rest tests."""

import asyncio
import base64
import tempfile
import unittest
from pathlib import Path

from apps.api.app.infrastructure.local_storage import LocalFileStorage
from apps.api.app.security.encryption import (
    decrypt_json,
    encrypt_json,
    parse_aes256_key,
)


class EncryptionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.key = bytes(range(32))

    def test_json_envelope_hides_payload_and_detects_tampering(self) -> None:
        encrypted = encrypt_json({"code": "123456", "expiresMinutes": 15}, self.key)
        self.assertNotIn("code", str(encrypted))
        self.assertEqual(
            decrypt_json(encrypted, self.key),
            {"code": "123456", "expiresMinutes": 15},
        )
        encrypted["ciphertext"] = (
            ("A" if encrypted["ciphertext"][0] != "A" else "B")
            + encrypted["ciphertext"][1:]
        )
        with self.assertRaises(ValueError):
            decrypt_json(encrypted, self.key)

    def test_local_upload_is_encrypted_before_it_reaches_target(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            storage = LocalFileStorage(Path(directory), encryption_key=self.key)
            data_url = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
            uploaded = asyncio.run(storage.save(data_url, "card.png"))
            stored = Path(directory, Path(uploaded["url"]).name).read_bytes()
            self.assertNotIn(b"PNG", stored)
            self.assertEqual(
                asyncio.run(storage.read(storage.resolve(uploaded["url"]))),
                base64.b64decode(data_url.split(",", 1)[1]),
            )

    def test_key_parser_requires_exactly_256_bits(self) -> None:
        with self.assertRaises(ValueError):
            parse_aes256_key("short", "TEST_KEY")


if __name__ == "__main__":
    unittest.main()
