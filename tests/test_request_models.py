import unittest

from pydantic import ValidationError

from apps.api.app.models import RegisterTeamPayload, ReviewPayload
from apps.api.app.shared.domain import public_user


class RequestModelTests(unittest.TestCase):
    def test_group_size_is_normalized_and_positive(self):
        self.assertEqual(
            RegisterTeamPayload(totalStudentsInGroup="12").totalStudentsInGroup, 12
        )
        with self.assertRaises(ValidationError):
            RegisterTeamPayload(totalStudentsInGroup=0)

    def test_review_numbers_are_typed_and_bounded(self):
        self.assertEqual(ReviewPayload(points="12").points, 12)
        with self.assertRaises(ValidationError):
            ReviewPayload(points=101)

    def test_public_user_is_a_whitelist_projection(self):
        result = public_user(
            {
                "id": "u1",
                "fio": "User",
                "email": "user@example.test",
                "role": "participant",
                "passwordHash": "secret",
                "token": "token",
                "verificationCode": "123456",
                "studentCardFile": "/uploads/card.pdf",
                "futureSecret": "must-not-leak",
            }
        )
        self.assertEqual(result["id"], "u1")
        self.assertEqual(result["studentCardFile"], "/uploads/card.pdf")
        self.assertNotIn("passwordHash", result)
        self.assertNotIn("token", result)
        self.assertNotIn("verificationCode", result)
        self.assertNotIn("futureSecret", result)
