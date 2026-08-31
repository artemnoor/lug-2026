import tempfile
import unittest
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from apps.api.app.config import default_settings
from apps.api.app.infrastructure.postgres_queries import _entity
from apps.api.app.infrastructure.store import JsonStore
from apps.api.app.security.auth import password_hash, password_matches_async


class JsonStoreContractTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.store = JsonStore(Path(self.temp_dir.name), default_settings())

    async def asyncTearDown(self):
        self.temp_dir.cleanup()

    async def test_lookup_and_session_interface(self):
        state = await self.store.load()
        password = password_hash("Strong!Test1")
        state["users"].append(
            {
                "id": "u1",
                "email": "Person@Example.test",
                "emailVerified": True,
                "passwordHash": password,
                "role": "participant",
            }
        )
        state["teams"].append(
            {
                "id": "t1",
                "inviteCode": "INV-123",
                "inviteStatus": "active",
                "inviteExpiresAt": "2999-01-01T00:00:00Z",
            }
        )
        await self.store.save(state)

        user = await self.store.get_user_by_email("person@example.test")
        self.assertEqual(user["id"], "u1")
        self.assertEqual((await self.store.get_invite("INV-123"))["id"], "t1")

        token = await self.store.create_session_atomic("u1", 60_000, "u1")
        self.assertIsNotNone(await self.store.get_user_by_session(_hash(token)))
        await self.store.remove_session_atomic(_hash(token))
        self.assertIsNone(await self.store.get_user_by_session(_hash(token)))

    async def test_password_verification_is_awaitable(self):
        stored = password_hash("Strong!Test1")
        self.assertTrue(await password_matches_async("Strong!Test1", stored))
        self.assertFalse(await password_matches_async("wrong", stored))

    async def test_session_count_is_bounded(self):
        for _ in range(7):
            await self.store.create_session_atomic("u1", 60_000, "u1")
        state = await self.store.load()
        self.assertLessEqual(
            sum(item.get("userId") == "u1" for item in state["sessions"]), 5
        )

    async def test_session_management_keeps_current_session(self):
        current = await self.store.create_session_atomic("u1", 60_000, "u1")
        await self.store.create_session_atomic("u1", 60_000, "u1")
        current_hash = _hash(current)
        sessions = await self.store.list_sessions("u1", current_hash)
        self.assertTrue(any(item["current"] for item in sessions))
        self.assertEqual(
            await self.store.remove_other_sessions_atomic("u1", current_hash), 1
        )
        sessions = await self.store.list_sessions("u1", current_hash)
        self.assertEqual(len(sessions), 1)
        self.assertTrue(sessions[0]["current"])

    async def test_expired_records_cleanup_is_explicit(self):
        state = await self.store.load()
        state["sessions"].append(
            {"tokenHash": "expired", "userId": "u1", "expiresAt": 0}
        )
        state["emailVerifications"].append({"id": "expired-v", "expiresAtMs": 0})
        state["passwordResets"].append({"id": "expired-r", "expiresAtMs": 0})
        await self.store.save(state)
        self.assertEqual(await self.store.cleanup_expired_records(), 3)
        self.assertEqual(len((await self.store.load())["sessions"]), 0)


class PostgresProjectionTests(unittest.TestCase):
    def test_canonical_values_override_payload_and_are_json_safe(self):
        row = {
            "payload": {"id": "u1", "points": 1, "createdAt": "legacy"},
            "id": "u1",
            "points": Decimal("42.5"),
            "created_at": datetime(2026, 1, 1, tzinfo=timezone.utc),
        }
        result = _entity(
            row,
            {"id": "id", "points": "points", "created_at": "createdAt"},
        )
        self.assertEqual(result["points"], 42.5)
        self.assertEqual(result["createdAt"], "2026-01-01T00:00:00Z")


def _hash(value: str) -> str:
    import hashlib

    return hashlib.sha256(value.encode()).hexdigest()
