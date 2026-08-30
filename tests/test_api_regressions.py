"""Regression tests for API payload contracts and persistence invariants."""

import unittest

from apps.api.app.models import ReviewPayload


class ReviewPayloadRegressionTests(unittest.TestCase):
    def test_team_review_field_is_accepted(self) -> None:
        payload = ReviewPayload.model_validate(
            {"field": "description", "status": "approved", "comment": ""}
        )

        self.assertEqual(payload.field, "description")
        self.assertEqual(payload.status, "approved")

    def test_unknown_review_fields_are_still_rejected(self) -> None:
        with self.assertRaises(ValueError):
            ReviewPayload.model_validate({"field": "description", "unexpected": True})
