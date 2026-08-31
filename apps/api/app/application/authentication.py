"""Authentication use cases independent from HTTP request/response concerns."""

from ..security.auth import (
    password_hash_async,
    password_matches_async,
    password_needs_rehash,
)
from .repositories import SessionRepository, UserRepository


class InvalidCredentials(Exception):
    """The caller supplied credentials that must not be distinguished."""


class AuthenticationService:
    def __init__(
        self,
        users: UserRepository,
        sessions: SessionRepository | int,
        session_ttl_ms: int | None = None,
    ) -> None:
        # The integer form keeps the small public service API source-compatible
        # for callers during the repository migration.
        if isinstance(sessions, int):
            self.users = users
            self.sessions = users  # type: ignore[assignment]
            self.session_ttl_ms = sessions
        else:
            self.users = users
            self.sessions = sessions
            self.session_ttl_ms = session_ttl_ms or 0

    async def authenticate(self, email: str, password: str) -> tuple[dict, str]:
        user = await self.users.get_user_by_email(email)
        if not user or not user.get("emailVerified"):
            raise InvalidCredentials
        if not await password_matches_async(password, user.get("passwordHash", "")):
            raise InvalidCredentials
        if password_needs_rehash(user.get("passwordHash", "")):
            await self.users.rehash_password_atomic(
                user["id"], await password_hash_async(password)
            )
        token = await self.sessions.create_session_atomic(
            user["id"], self.session_ttl_ms, user["id"]
        )
        return user, token
