"""Authenticated encryption helpers for data that must be reversible."""

import base64
import binascii
import hashlib
import json
import os
from collections.abc import Mapping
from typing import Any

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

AES256_KEY_BYTES = 32
GCM_NONCE_BYTES = 12
EMAIL_OUTBOX_AAD = b"lug-email-outbox:v1"
LOCAL_UPLOAD_MAGIC = b"LUGENC1"


def development_key(name: str) -> bytes:
    """Return a stable, non-secret development key for local-only services."""

    return hashlib.sha256(f"lug-development:{name}".encode("utf-8")).digest()


def parse_aes256_key(value: str, name: str) -> bytes:
    """Decode a URL-safe base64 AES-256 key and reject weak/malformed values."""

    encoded = str(value or "").strip()
    if not encoded:
        raise ValueError(f"{name} должен быть задан.")
    padded = encoded + "=" * (-len(encoded) % 4)
    try:
        key = base64.b64decode(padded.encode("ascii"), altchars=b"-_", validate=True)
    except (UnicodeEncodeError, ValueError, binascii.Error) as exc:
        raise ValueError(f"{name} должен быть URL-safe base64.") from exc
    if len(key) != AES256_KEY_BYTES:
        raise ValueError(f"{name} должен декодироваться ровно в 32 байта.")
    return key


def _encoded(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _decoded(value: Any, field: str) -> bytes:
    encoded = str(value or "")
    if not encoded:
        raise ValueError(f"Зашифрованный payload не содержит {field}.")
    padded = encoded + "=" * (-len(encoded) % 4)
    try:
        return base64.b64decode(padded.encode("ascii"), altchars=b"-_", validate=True)
    except (UnicodeEncodeError, ValueError, binascii.Error) as exc:
        raise ValueError(f"Зашифрованный payload содержит некорректный {field}.") from exc


def encrypt_json(payload: Mapping[str, Any], key: bytes) -> dict[str, Any]:
    """Encrypt a JSON object with AES-256-GCM and authenticated metadata."""

    if len(key) != AES256_KEY_BYTES:
        raise ValueError("AES-256 требует ключ длиной 32 байта.")
    nonce = os.urandom(GCM_NONCE_BYTES)
    plaintext = json.dumps(
        dict(payload), ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8")
    ciphertext = AESGCM(key).encrypt(nonce, plaintext, EMAIL_OUTBOX_AAD)
    return {
        "version": 1,
        "algorithm": "AES-256-GCM",
        "nonce": _encoded(nonce),
        "ciphertext": _encoded(ciphertext),
    }


def decrypt_json(payload: Mapping[str, Any], key: bytes) -> dict[str, Any]:
    """Decrypt and validate an AES-256-GCM JSON envelope."""

    if len(key) != AES256_KEY_BYTES:
        raise ValueError("AES-256 требует ключ длиной 32 байта.")
    if payload.get("version") != 1 or payload.get("algorithm") != "AES-256-GCM":
        raise ValueError("Неподдерживаемая версия encrypted payload.")
    try:
        plaintext = AESGCM(key).decrypt(
            _decoded(payload.get("nonce"), "nonce"),
            _decoded(payload.get("ciphertext"), "ciphertext"),
            EMAIL_OUTBOX_AAD,
        )
        decoded = json.loads(plaintext.decode("utf-8"))
    except (InvalidTag, UnicodeDecodeError, json.JSONDecodeError, TypeError) as exc:
        raise ValueError("Не удалось расшифровать payload.") from exc
    if not isinstance(decoded, dict):
        raise ValueError("Расшифрованный payload должен быть объектом JSON.")
    return decoded


def encrypt_bytes(data: bytes, key: bytes, associated_data: bytes) -> bytes:
    """Encrypt binary data with an authenticated AES-256-GCM envelope."""

    if len(key) != AES256_KEY_BYTES:
        raise ValueError("AES-256 требует ключ длиной 32 байта.")
    nonce = os.urandom(GCM_NONCE_BYTES)
    return LOCAL_UPLOAD_MAGIC + nonce + AESGCM(key).encrypt(
        nonce, data, associated_data
    )


def decrypt_bytes(blob: bytes, key: bytes, associated_data: bytes) -> bytes:
    """Decrypt a local upload and reject tampering or malformed envelopes."""

    if len(key) != AES256_KEY_BYTES:
        raise ValueError("AES-256 требует ключ длиной 32 байта.")
    if not blob.startswith(LOCAL_UPLOAD_MAGIC):
        raise ValueError("Файл не содержит encrypted upload envelope.")
    offset = len(LOCAL_UPLOAD_MAGIC)
    nonce = blob[offset : offset + GCM_NONCE_BYTES]
    ciphertext = blob[offset + GCM_NONCE_BYTES :]
    if len(nonce) != GCM_NONCE_BYTES or not ciphertext:
        raise ValueError("Encrypted upload envelope повреждён.")
    try:
        return AESGCM(key).decrypt(nonce, ciphertext, associated_data)
    except InvalidTag as exc:
        raise ValueError("Encrypted upload не прошёл проверку целостности.") from exc
