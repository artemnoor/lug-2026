"""Authentication use cases independent from HTTP request/response concerns."""

from typing import Any

from ..security.auth import (
    password_hash_async,
    password_matches_async,
    password_needs_rehash,
)


class InvalidCredentials(Exception):
    """The caller supplied credentials that must not be distinguished."""


class AuthenticationService:
    def __init__(self, store: Any, session_ttl_ms: int) -> None:
        self.store = store
        self.session_ttl_ms = session_ttl_ms

    async def authenticate(self, email: str, password: str) -> tuple[dict, str]:
        user = await self.store.get_user_by_email(email)
        if not user or not user.get("emailVerified"):
            raise InvalidCredentials
        if not await password_matches_async(password, user.get("passwordHash", "")):
            raise InvalidCredentials
        if password_needs_rehash(user.get("passwordHash", "")):
            await self.store.rehash_password_atomic(
                user["id"], await password_hash_async(password)
            )
        token = await self.store.create_session_atomic(
            user["id"], self.session_ttl_ms, user["id"]
        )
        return user, token
