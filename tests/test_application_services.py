import unittest
from types import SimpleNamespace

from apps.api.app.application.admin_reviews import (
    AdminReviewService,
    AdminRuleViolation,
)
from apps.api.app.application.admin_settings import (
    AdminSettingsRuleViolation,
    AdminSettingsService,
)
from apps.api.app.application.participant_mutations import (
    ParticipantMutationService,
    ParticipantRuleViolation,
)
from apps.api.app.application.profile import ProfileRuleViolation, ProfileService
from apps.api.app.application.registration import (
    RegistrationRuleViolation,
    RegistrationService,
)
from apps.api.app.application.uploads import UploadRuleViolation, UploadService


class FakeStore:
    def __init__(self):
        self.result = None

    async def create_achievement_atomic(self, achievement, actor_id):
        self.result = ("achievement", achievement, actor_id)
        return achievement

    async def update_team_atomic(self, team_id, patch, actor_id):
        self.result = ("team", team_id, patch, actor_id)
        return {"id": team_id, **patch}

    async def update_video_atomic(self, team_id, video, actor_id, upload=None):
        self.result = ("video", team_id, video, actor_id)
        return video

    async def rotate_invite_atomic(self, team_id, invite_code, expires_at, actor_id):
        self.result = ("invite", team_id, invite_code, expires_at, actor_id)
        return {"inviteCode": invite_code, "inviteExpiresAt": expires_at}


class ParticipantMutationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.store = FakeStore()
        self.service = ParticipantMutationService(self.store)
        self.user = {"id": "u1", "role": "captain", "teamId": "t1"}
        self.state = {
            "settings": {
                "portfolioStart": "2026-01-01T00:00:00Z",
                "portfolioDeadline": "2999-01-01T00:00:00Z",
                "registrationStart": "2026-01-01T00:00:00Z",
                "registrationDeadline": "2999-01-01T00:00:00Z",
                "videoStart": "2026-01-01T00:00:00Z",
                "videoDeadline": "2999-01-01T00:00:00Z",
                "inviteLifetimeDays": 30,
            },
            "users": [self.user],
            "teams": [{"id": "t1", "group": "G", "captainId": "u1"}],
            "uploads": [{"url": "/uploads/proof.png", "userId": "u1"}],
        }

    async def test_create_achievement_is_atomic_and_owns_upload(self):
        result = await self.service.create_achievement(
            self.state,
            self.user,
            {
                "title": "Proof",
                "direction": "science",
                "category": "award",
                "fileUrl": "/uploads/proof.png",
            },
        )
        self.assertEqual(result["status"], "pending")
        self.assertEqual(self.store.result[0], "achievement")

    async def test_update_video_rejects_unsupported_url_with_code(self):
        with self.assertRaises(ParticipantRuleViolation) as error:
            await self.service.update_video(
                self.state, self.user, {"url": "https://example.invalid/video"}
            )
        self.assertEqual(error.exception.code, "VIDEO_URL_INVALID")


class AdminReviewServiceTests(unittest.IsolatedAsyncioTestCase):
    class Store:
        async def review_achievement_atomic(self, *args):
            return {"id": args[0], "status": args[1], "points": args[3]}

        async def review_video_atomic(self, *args):
            return {"status": args[1], "criteriaScores": args[3]}

        async def review_identity_atomic(self, *args):
            return ({"id": args[0], "identityStatus": args[1]}, [], {})

        async def review_team_atomic(self, *args):
            return ({"id": args[0]}, [], {})

        async def update_quota_atomic(self, *args):
            return {"id": args[0]}

        async def get_team_snapshot(self, team_id):
            return ({"id": team_id}, [], {})

        async def remove_team_member_atomic(self, *args):
            return True

    async def test_reject_requires_comment(self):
        with self.assertRaises(AdminRuleViolation) as error:
            await AdminReviewService(self.Store()).review_achievement(
                "a1", {"status": "rejected"}, "admin"
            )
        self.assertEqual(error.exception.code, "REVIEW_COMMENT_REQUIRED")

    async def test_video_scores_are_bounded_before_persistence(self):
        with self.assertRaises(AdminRuleViolation) as error:
            await AdminReviewService(self.Store()).review_video(
                "t1",
                {"status": "approved", "criteriaScores": {"topic": 99}},
                "admin",
            )
        self.assertEqual(error.exception.code, "VIDEO_SCORE_INVALID")

    async def test_captain_cannot_be_removed(self):
        class Store(self.Store):
            async def get_team_snapshot(self, team_id):
                return (
                    {"id": team_id, "captainId": "captain"},
                    [{"id": "captain"}],
                    {},
                )

        with self.assertRaises(AdminRuleViolation) as error:
            await AdminReviewService(Store()).remove_member("t1", "captain", "admin")
        self.assertEqual(error.exception.code, "CAPTAIN_CANNOT_BE_REMOVED")


class AdminSettingsServiceTests(unittest.IsolatedAsyncioTestCase):
    class Store:
        def __init__(self):
            self.saved = None

        async def get_settings(self):
            return {
                "registrationStart": "2026-01-01T00:00:00Z",
                "registrationDeadline": "2026-12-31T00:00:00Z",
                "portfolioStart": "2026-01-01T00:00:00Z",
                "portfolioDeadline": "2026-12-31T00:00:00Z",
                "videoStart": "2026-01-01T00:00:00Z",
                "videoDeadline": "2026-12-31T00:00:00Z",
                "resultsStart": "2026-01-01T00:00:00Z",
                "resultsDeadline": "2026-12-31T00:00:00Z",
                "content": {},
            }

        async def update_settings_atomic(self, patch, actor_id):
            self.saved = (patch, actor_id)
            return patch

    def setUp(self):
        self.store = self.Store()
        self.context = SimpleNamespace(
            store=self.store,
            config=SimpleNamespace(email_mode="disabled"),
        )

    async def test_settings_patch_is_atomic_and_does_not_mutate_snapshot(self):
        result = await AdminSettingsService(self.context).update(
            {"minTeamPercentage": 75, "content": {"manifestoLead": "  Lead  "}},
            "admin-1",
        )
        self.assertEqual(result["minTeamPercentage"], 75)
        self.assertEqual(result["content"], {"manifestoLead": "Lead"})
        self.assertEqual(self.store.saved[1], "admin-1")

    async def test_invalid_date_range_has_stable_error_code(self):
        with self.assertRaises(AdminSettingsRuleViolation) as error:
            await AdminSettingsService(self.context).update(
                {
                    "registrationStart": "2027-01-01T00:00:00Z",
                    "registrationDeadline": "2026-01-01T00:00:00Z",
                },
                "admin-1",
            )
        self.assertEqual(error.exception.code, "DATE_RANGE_INVALID")


class UploadServiceTests(unittest.IsolatedAsyncioTestCase):
    class Store:
        def __init__(self):
            self.uploads = []

        async def get_user_uploads(self, user_id):
            return [item for item in self.uploads if item.get("userId") == user_id]

        async def create_upload_atomic(self, upload, actor_id):
            self.uploads.append(upload)
            return upload

    class Storage:
        def __init__(self):
            self.deleted = []

        async def save_stream(self, chunks, name, content_type, max_bytes):
            data = b"".join([chunk async for chunk in chunks])
            return {"url": "/uploads/file.png", "size": len(data), "type": content_type}

        async def delete(self, url):
            self.deleted.append(url)

        async def create_upload_intent(self, *args):
            return {"uploadId": "intent-1", "key": "uploads/intent-1"}

        async def complete_upload(self, *args):
            return {
                "url": "/uploads/video.mp4",
                "key": "uploads/video.mp4",
                "size": 12,
            }

    def setUp(self):
        self.store = self.Store()
        self.storage = self.Storage()
        self.service = UploadService(
            self.store,
            self.storage,
            SimpleNamespace(
                max_upload_body=1024,
                max_uploads_per_user=2,
                max_upload_bytes_per_user=20,
            ),
        )
        self.user = {"id": "u1"}

    async def test_stream_persists_metadata_after_storage_write(self):
        async def chunks():
            yield b"png"

        result = await self.service.stream(
            chunks(), self.user, "proof.png", "image/png", "attachment", 3
        )
        self.assertEqual(result["size"], 3)
        self.assertEqual(self.store.uploads[0]["userId"], "u1")
        self.assertEqual(self.store.uploads[0]["status"], "uploaded")

    async def test_invalid_kind_is_rejected_before_storage(self):
        with self.assertRaises(UploadRuleViolation) as error:
            await self.service.create_intent(
                {
                    "name": "x.exe",
                    "contentType": "application/octet-stream",
                    "size": 1,
                    "kind": "binary",
                },
                self.user,
            )
        self.assertEqual(error.exception.code, "INVALID_UPLOAD_KIND")

    async def test_complete_persists_pending_scan_status(self):
        result = await self.service.complete(
            {
                "uploadId": "u1",
                "key": "uploads/video.mp4",
                "name": "video.mp4",
                "contentType": "video/mp4",
                "parts": [],
                "kind": "video",
            },
            self.user,
        )
        self.assertEqual(result["scanStatus"], "pending")
        self.assertEqual(self.store.uploads[0]["storageKey"], "uploads/video.mp4")


class ProfileServiceTests(unittest.IsolatedAsyncioTestCase):
    class Store:
        def __init__(self, phone_in_use=False):
            self.phone_in_use = phone_in_use
            self.saved = None

        async def is_phone_in_use(self, phone, user_id):
            return self.phone_in_use

        async def update_user_atomic(self, *args):
            self.saved = args
            return args[1]

    class Storage:
        def __init__(self):
            self.deleted = []

        async def delete(self, url):
            self.deleted.append(url)

    def _service(self, phone_in_use=False):
        self.store = self.Store(phone_in_use)
        return ProfileService(self.store, self.Storage())

    def _state(self):
        return {
            "uploads": [
                {
                    "url": "/uploads/card.png",
                    "userId": "u1",
                    "kind": "student-card",
                    "type": "image/png",
                    "size": 12,
                }
            ]
        }

    async def test_profile_update_is_delegated_to_atomic_repository(self):
        service = self._service()
        user = {
            "id": "u1",
            "fio": "Иванов Иван",
            "phone": "",
            "messengerContacts": {"telegram": "@ivan"},
        }
        result = await service.update(
            self._state(),
            user,
            {
                "fio": "Иванов Иван",
                "messenger": "telegram",
                "messengerContact": "@ivan",
            },
        )
        self.assertEqual(result["fio"], "Иванов Иван")
        self.assertEqual(self.store.saved[0], "u1")

    async def test_profile_rejects_duplicate_phone_in_service_layer(self):
        service = self._service(phone_in_use=True)
        with self.assertRaises(ProfileRuleViolation) as error:
            await service.update(
                self._state(),
                {
                    "id": "u1",
                    "fio": "Иванов",
                    "phone": "",
                    "messengerContacts": {"telegram": "@ivan"},
                },
                {
                    "phone": "+79991234567",
                    "messenger": "telegram",
                    "messengerContact": "@ivan",
                },
            )
        self.assertEqual(error.exception.code, "PHONE_ALREADY_IN_USE")


class RegistrationServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_pending_verification_requires_valid_upload_claim(self):
        class Store:
            queues_email = True

            async def get_email_verification_by_email(self, email):
                return None

        context = SimpleNamespace(
            store=Store(),
            config=SimpleNamespace(
                email_verification_secret="test-secret",
                email_verification_ttl_ms=60_000,
            ),
        )
        with self.assertRaises(RegistrationRuleViolation) as error:
            await RegistrationService(context).create_pending_verification(
                {
                    "email": "person@example.test",
                    "password": "Strong!Test1",
                    "studentCardFile": "/uploads/card.png",
                    "studentCardUploadToken": "invalid",
                },
                "team",
            )
        self.assertEqual(error.exception.code, "REGISTRATION_UPLOAD_CLAIM_INVALID")
