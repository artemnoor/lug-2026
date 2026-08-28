"""Password, cookie session, CSRF and role helpers."""

import secrets
from hashlib import scrypt, sha256
from hmac import compare_digest
from hmac import new as hmac_new
from time import time
from typing import Any

from fastapi import Request

from ..http.errors import ApiError

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


def parse_cookies(request: Request) -> dict[str, str]:
    result: dict[str, str] = {}
    for part in request.headers.get("cookie", "").split(";"):
        key, separator, value = part.strip().partition("=")
        if separator and key:
            result[key] = value
    return result


def hash_token(token: str) -> str:
    return sha256(token.encode()).hexdigest()


def verification_code() -> str:
    return f"{secrets.randbelow(900000) + 100000:06d}"


def verification_code_hash(code: str, secret: str) -> str:
    return hmac_new(
        secret.encode("utf-8"), code.encode("ascii"), "sha256"
    ).hexdigest()


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


def current_user(request: Request, state: dict[str, Any]) -> dict[str, Any] | None:
    token = parse_cookies(request).get(SESSION_COOKIE)
    if not token:
        return None
    token_hash = hash_token(token)
    session = next(
        (
            item
            for item in state.get("sessions", [])
            if item.get("tokenHash") == token_hash
        ),
        None,
    )
    if not session or int(session.get("expiresAt", 0)) < time() * 1000:
        return None
    return next(
        (
            user
            for user in state.get("users", [])
            if user.get("id") == session.get("userId")
        ),
        None,
    )


def require_user(request: Request, state: dict[str, Any]) -> dict[str, Any]:
    user = current_user(request, state)
    if not user:
        raise ApiError(401, "Требуется вход в личный кабинет.")
    return user


def require_admin(request: Request, state: dict[str, Any]) -> dict[str, Any]:
    user = require_user(request, state)
    if user.get("role") != "admin":
        raise ApiError(403, "Доступ разрешён только организаторам.")
    return user


def new_session(state: dict[str, Any], user: dict[str, Any], ttl_ms: int) -> str:
    now_ms = int(time() * 1000)
    state["sessions"] = [
        item
        for item in state.get("sessions", [])
        if int(item.get("expiresAt", 0)) >= now_ms
    ]
    token = secrets.token_hex(32)
    state["sessions"].append(
        {
            "tokenHash": hash_token(token),
            "userId": user["id"],
            "expiresAt": now_ms + ttl_ms,
        }
    )
    return token


def remove_session(state: dict[str, Any], request: Request) -> None:
    token = parse_cookies(request).get(SESSION_COOKIE)
    if not token:
        return
    token_hash = hash_token(token)
    state["sessions"] = [
        item
        for item in state.get("sessions", [])
        if item.get("tokenHash") != token_hash
    ]
