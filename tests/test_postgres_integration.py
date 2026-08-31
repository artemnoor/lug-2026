"""Optional PostgreSQL integration and concurrency tests."""

import asyncio
import json
import os
import unittest
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from apps.api.app.config import default_settings
from apps.api.app.infrastructure.postgres import PostgresStore
from apps.api.app.infrastructure.postgres_writes import PersistenceError
from apps.api.app.security.auth import password_hash

DATABASE_URL = os.getenv("LUG_TEST_DATABASE_URL") or os.getenv("TEST_DATABASE_URL")
EMAIL_OUTBOX_KEY = bytes(range(32))


@unittest.skipUnless(DATABASE_URL, "LUG_TEST_DATABASE_URL is not configured")
class PostgresConcurrencyTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self) -> None:
        self.store = await PostgresStore.create(
            DATABASE_URL, default_settings(), 2, 10, EMAIL_OUTBOX_KEY
        )
        await self.store.pool.execute(
            "TRUNCATE lug_email_outbox, lug_password_resets, lug_audit_log, lug_sessions, lug_uploads, "
            "lug_achievements, lug_users, lug_teams, lug_email_verifications RESTART IDENTITY CASCADE"
        )
        settings = default_settings()
        now = datetime.now(timezone.utc)
        settings["registrationStart"] = (now - timedelta(days=1)).isoformat()
        settings["registrationDeadline"] = (now + timedelta(days=1)).isoformat()
        await self.store.pool.execute(
            "UPDATE lug_settings SET payload = $1::jsonb WHERE id = 1",
            json.dumps(settings),
        )

    async def asyncTearDown(self) -> None:
        await self.store.close()

    async def test_join_capacity_is_serialized_by_team_row_lock(self) -> None:
        team_id = str(uuid4())
        invite = "INV-" + "A" * 32
        expires = (
            (datetime.now(timezone.utc) + timedelta(days=1))
            .isoformat()
            .replace("+00:00", "Z")
        )
        team = {
            "id": team_id,
            "name": "Concurrent",
            "group": "CONCURRENT",
            "totalStudentsInGroup": 1,
            "captainId": None,
            "inviteCode": invite,
            "inviteStatus": "active",
            "inviteExpiresAt": expires,
        }
        await self.store.pool.execute(
            "INSERT INTO lug_teams (id, group_name, invite_code, payload) VALUES ($1,$2,$3,$4::jsonb)",
            team_id,
            team["group"],
            invite,
            json.dumps(team),
        )

        async def pending(email: str) -> str:
            verification_id = str(uuid4())
            request = {
                "fio": email,
                "email": email,
                "passwordHash": password_hash("Strong!Test1"),
                "inviteCode": invite,
                "messenger": "telegram",
                "messengerContact": "@testuser",
            }
            record = {
                "id": verification_id,
                "kind": "participant",
                "email": email,
                "expiresAtMs": int(datetime.now(timezone.utc).timestamp() * 1000)
                + 900000,
                "payload": request,
                "studentCard": {
                    "url": f"/uploads/{email.replace('@', '-')}.png",
                    "size": 1,
                },
            }
            await self.store.replace_email_verification(record)
            return verification_id

        ids = await asyncio.gather(
            pending("one@example.test"), pending("two@example.test")
        )
        results = await asyncio.gather(
            *(self.store.commit_pending_atomic(item, 3600000) for item in ids),
            return_exceptions=True,
        )
        self.assertEqual(sum(isinstance(item, tuple) for item in results), 1)
        self.assertEqual(sum(isinstance(item, PersistenceError) for item in results), 1)
        self.assertEqual(
            await self.store.pool.fetchval("SELECT count(*) FROM lug_users"), 1
        )

    async def test_email_verification_attempts_and_commit_are_serialized(self) -> None:
        verification_id = str(uuid4())
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        pending = {
            "id": verification_id,
            "kind": "team",
            "email": "verified@example.test",
            "expiresAtMs": now_ms + 900000,
            "payload": {
                "fio": "Captain",
                "email": "verified@example.test",
                "passwordHash": password_hash("Strong!Test1"),
                "group": "VERIFY",
                "teamName": "Verify",
                "totalStudentsInGroup": 1,
                "messenger": "telegram",
                "messengerContact": "@verifyuser",
            },
            "studentCard": {"url": "/uploads/verified.png", "size": 1},
            "codeHash": "expected-code-hash",
            "attempts": 0,
        }
        await self.store.replace_email_verification(
            pending, {"code": "123456", "expiresMinutes": 15}
        )
        stored_outbox = await self.store.pool.fetchval(
            "SELECT payload FROM lug_email_outbox"
        )
        self.assertNotIn("123456", stored_outbox)
        self.assertNotIn('"code"', stored_outbox)
        results = await asyncio.gather(
            self.store.commit_pending_atomic(verification_id, 3600000, "wrong", 5),
            self.store.commit_pending_atomic(
                verification_id, 3600000, "expected-code-hash", 5
            ),
            return_exceptions=True,
        )
        self.assertEqual(sum(isinstance(item, PersistenceError) for item in results), 1)
        self.assertEqual(sum(isinstance(item, tuple) for item in results), 1)

    async def test_settings_updates_merge_under_row_lock(self) -> None:
        await asyncio.gather(
            self.store.update_settings_atomic({"isRegistrationOpen": False}, "admin-a"),
            self.store.update_settings_atomic({"minTeamPercentage": 75}, "admin-b"),
        )
        settings = await self.store.get_settings()
        self.assertFalse(settings["isRegistrationOpen"])
        self.assertEqual(settings["minTeamPercentage"], 75)

    async def test_password_reset_and_email_outbox_are_persistent(self) -> None:
        user_id = str(uuid4())
        email = "reset@example.test"
        user = {
            "id": user_id,
            "email": email,
            "emailVerified": True,
            "role": "participant",
            "teamId": None,
            "passwordHash": "old",
        }
        await self.store.pool.execute(
            "INSERT INTO lug_users (id,email,role,email_verified,payload) VALUES ($1,$2,$3,$4,$5::jsonb)",
            user_id,
            email,
            "participant",
            True,
            json.dumps(user),
        )
        reset = {
            "id": str(uuid4()),
            "email": email,
            "codeHash": "expected",
            "attempts": 0,
            "lastSentAtMs": 1,
            "expiresAtMs": int(datetime.now(timezone.utc).timestamp() * 1000) + 900000,
        }
        queued = await self.store.create_password_reset_atomic(
            email,
            reset,
            {"code": "123456", "expiresMinutes": 15},
            int(datetime.now(timezone.utc).timestamp() * 1000),
            60000,
        )
        self.assertTrue(queued)
        self.assertEqual(
            await self.store.pool.fetchval("SELECT count(*) FROM lug_email_outbox"), 1
        )
        message = await self.store.claim_email()
        self.assertEqual(message["purpose"], "password-reset")
        stored_payload = await self.store.pool.fetchval(
            "SELECT payload FROM lug_email_outbox"
        )
        self.assertNotIn("code", json.dumps(json.loads(stored_payload)))
        await self.store.finish_email(message["id"])
        redacted_payload = await self.store.pool.fetchval(
            "SELECT payload FROM lug_email_outbox"
        )
        self.assertTrue(json.loads(redacted_payload)["redacted"])
        changed = await self.store.reset_password_atomic(email, "expected", "new", 5)
        self.assertEqual(changed["passwordHash"], "new")
        self.assertEqual(
            await self.store.pool.fetchval("SELECT count(*) FROM lug_password_resets"),
            0,
        )

    async def test_atomic_entity_writes_populate_canonical_columns(self) -> None:
        user_id = str(uuid4())
        upload_url = "/uploads/canonical.png"
        await self.store.pool.execute(
            """INSERT INTO lug_users (id,email,role,email_verified,payload)
            VALUES ($1,$2,'participant',TRUE,$3::jsonb)""",
            user_id,
            "canonical@example.test",
            json.dumps(
                {
                    "id": user_id,
                    "email": "canonical@example.test",
                    "identityStatus": "approved",
                }
            ),
        )
        await self.store.pool.execute(
            """INSERT INTO lug_uploads (url,user_id,kind,status,scan_status,storage_key,mime_type,size_bytes,payload)
            VALUES ($1,$2,'achievement','clean','clean','uploads/canonical.png','image/png',12,$3::jsonb)""",
            upload_url,
            user_id,
            json.dumps({"url": upload_url, "userId": user_id}),
        )
        achievement = {
            "id": str(uuid4()),
            "userId": user_id,
            "direction": "science",
            "points": 42,
            "fileUrl": upload_url,
            "status": "pending",
        }
        await self.store.create_achievement_atomic(achievement, user_id)
        achievement_row = await self.store.pool.fetchrow(
            "SELECT direction, points, file_url FROM lug_achievements WHERE id=$1",
            achievement["id"],
        )
        self.assertEqual(
            dict(achievement_row),
            {"direction": "science", "points": 42, "file_url": upload_url},
        )

        team_id = str(uuid4())
        team = {
            "id": team_id,
            "name": "Canonical",
            "group": "CANONICAL",
            "totalStudentsInGroup": 3,
            "inviteCode": "CANONICAL-1",
            "inviteStatus": "active",
            "captainId": None,
            "flagUrl": "",
        }
        await self.store.pool.execute(
            "INSERT INTO lug_teams (id,group_name,invite_code,payload) VALUES ($1,$2,$3,$4::jsonb)",
            team_id,
            team["group"],
            team["inviteCode"],
            json.dumps(team),
        )
        await self.store.update_team_atomic(team_id, team, user_id)
        team_row = await self.store.pool.fetchrow(
            "SELECT name, member_limit FROM lug_teams WHERE id=$1", team_id
        )
        self.assertEqual(dict(team_row), {"name": "Canonical", "member_limit": 3})
        await self.store.update_quota_atomic(team_id, True, user_id)
        for field in ("name", "group", "flag", "description"):
            await self.store.review_team_atomic(team_id, field, "approved", "", user_id)
        workflow_row = await self.store.pool.fetchrow(
            """SELECT quota_confirmed, review_name_status, review_group_status,
            review_flag_status, review_description_status
            FROM lug_teams WHERE id=$1""",
            team_id,
        )
        self.assertEqual(
            dict(workflow_row),
            {
                "quota_confirmed": True,
                "review_name_status": "approved",
                "review_group_status": "approved",
                "review_flag_status": "approved",
                "review_description_status": "approved",
            },
        )
        team_search = await self.store.get_admin_collection("teams", query="Canonical")
        achievement_search = await self.store.get_admin_collection(
            "achievements", query="science"
        )
        self.assertEqual(team_search["total"], 1)
        self.assertEqual(achievement_search["total"], 1)
