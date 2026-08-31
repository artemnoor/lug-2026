"""Password, cookie session, CSRF and role helpers."""

import asyncio
import base64
import json
import secrets
from concurrent.futures import ThreadPoolExecutor
from hashlib import scrypt, sha256
from hmac import compare_digest
from hmac import new as hmac_new
from time import time
from typing import Any

from fastapi import Request

CSRF_COOKIE = "lug_csrf"
SESSION_COOKIE = "lug_session"
PRIVACY_VERSION = "1.0"
PRIVACY_PATH = "/privacy.html"
try:
    from argon2 import PasswordHasher
    from argon2.exceptions import (
        InvalidHashError,
        VerificationError,
        VerifyMismatchError,
    )

    PASSWORD_HASHER = PasswordHasher(
        time_cost=3, memory_cost=65_536, parallelism=2, hash_len=32, salt_len=16
    )
except ImportError:  # pragma: no cover - requirements install argon2 in deployments
    PASSWORD_HASHER = None

PASSWORD_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="lug-password")


def parse_cookies(request: Request) -> dict[str, str]:
    return dict(request.cookies)


def hash_token(token: str) -> str:
    return sha256(token.encode()).hexdigest()


def verification_code() -> str:
    return f"{secrets.randbelow(900000) + 100000:06d}"


def verification_code_hash(code: str, secret: str) -> str:
    return hmac_new(secret.encode("utf-8"), code.encode("ascii"), "sha256").hexdigest()


def issue_registration_upload_claim(
    secret: str, owner: str, url: str = "", key: str = "", ttl_seconds: int = 900
) -> str:
    body = {"owner": owner, "url": url, "key": key, "exp": int(time()) + ttl_seconds}
    encoded = (
        base64.urlsafe_b64encode(json.dumps(body, separators=(",", ":")).encode())
        .decode()
        .rstrip("=")
    )
    signature = hmac_new(secret.encode(), encoded.encode(), "sha256").hexdigest()
    return f"{encoded}.{signature}"


def verify_registration_upload_claim(token: str, secret: str) -> dict[str, Any] | None:
    encoded, separator, signature = str(token or "").partition(".")
    expected = hmac_new(secret.encode(), encoded.encode(), "sha256").hexdigest()
    if not separator or not encoded or not compare_digest(signature, expected):
        return None
    try:
        padding = "=" * (-len(encoded) % 4)
        body = json.loads(base64.urlsafe_b64decode((encoded + padding).encode()))
    except (ValueError, TypeError, json.JSONDecodeError):
        return None
    if not isinstance(body, dict) or int(body.get("exp", 0)) < int(time()):
        return None
    return body


def password_hash(password: str) -> str:
    if PASSWORD_HASHER is not None:
        return PASSWORD_HASHER.hash(password)
    salt = secrets.token_hex(16)
    digest = scrypt(password.encode(), salt=salt.encode(), n=16384, r=8, p=1, dklen=64)
    return f"{salt}:{digest.hex()}"


def password_matches(password: str, stored: str) -> bool:
    if str(stored).startswith("$argon2id$"):
        if PASSWORD_HASHER is None:
            return False
        try:
            return PASSWORD_HASHER.verify(stored, password)
        except (InvalidHashError, VerificationError, VerifyMismatchError):
            return False
    salt, separator, expected = str(stored).partition(":")
    if not separator or len(expected) != 128:
        return False
    try:
        actual = scrypt(
            password.encode(), salt=salt.encode(), n=16384, r=8, p=1, dklen=64
        ).hex()
    except (TypeError, ValueError):
        return False
    return compare_digest(actual, expected)


def password_needs_rehash(stored: str) -> bool:
    return bool(
        PASSWORD_HASHER is not None
        and str(stored).startswith("$argon2id$")
        and PASSWORD_HASHER.check_needs_rehash(stored)
    )


async def password_hash_async(password: str) -> str:
    """Run the memory/CPU-heavy password hash outside the event loop."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(PASSWORD_EXECUTOR, password_hash, password)


async def password_matches_async(password: str, stored: str) -> bool:
    """Run password verification in the bounded password executor."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        PASSWORD_EXECUTOR, password_matches, password, stored
    )


def csrf_valid(request: Request) -> bool:
    cookie = parse_cookies(request).get(CSRF_COOKIE, "")
    header = request.headers.get("x-csrf-token", "")
    return bool(cookie) and compare_digest(cookie, header)


def request_address(
    request: Request, trust_proxy: bool, trusted_proxy_ips: tuple[str, ...] = ()
) -> str:
    client_host = request.client.host if request.client else "unknown"
    if trust_proxy and client_host in trusted_proxy_ips:
        forwarded = request.headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
        if forwarded:
            return forwarded
    return client_host
