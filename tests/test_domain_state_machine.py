import unittest

from apps.api.app.shared.state_machine import REVIEW_STATUSES, ensure_review_transition


class ReviewStateMachineTests(unittest.TestCase):
    def test_new_and_existing_reviews_allow_only_known_statuses(self):
        for current in ("", "pending", "approved", "rejected"):
            for target in REVIEW_STATUSES:
                ensure_review_transition(current, target)

    def test_unknown_status_is_rejected(self):
        with self.assertRaises(ValueError):
            ensure_review_transition("pending", "deleted")

    def test_unknown_current_state_is_rejected(self):
        with self.assertRaises(ValueError):
            ensure_review_transition("legacy", "approved")
