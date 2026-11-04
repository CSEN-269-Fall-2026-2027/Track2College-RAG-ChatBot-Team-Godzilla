import unittest
from unittest.mock import Mock, patch

import uc_account


class VerificationNavigationTest(unittest.TestCase):
    def test_screen_detection_defers_during_navigation(self):
        page = Mock()
        page.evaluate.side_effect = RuntimeError("Execution context destroyed")
        self.assertEqual(uc_account._screen(page), "loading")

    @patch.object(uc_account, "_set")
    @patch.object(uc_account, "_visible_error", return_value="")
    @patch.object(uc_account, "_screen", side_effect=["loading", "sign_in"])
    def test_code_waits_through_navigation_before_accepting(self, screen, error, update):
        page = Mock()
        page.locator.return_value.count.return_value = 1
        uc_account._enter_code("run", page, "123456")
        self.assertEqual(screen.call_count, 2)
        self.assertEqual(update.call_args.args[1], "verified")
        self.assertTrue(update.call_args.kwargs["verified"])

    @patch.object(uc_account.time, "monotonic", side_effect=[0, 0, 7])
    @patch.object(uc_account, "_set")
    @patch.object(uc_account, "_screen", return_value="loading")
    def test_code_timeout_during_navigation_does_not_claim_acceptance(self, screen, update, clock):
        page = Mock()
        page.locator.return_value.count.return_value = 1
        uc_account._enter_code("run", page, "123456")
        self.assertEqual(update.call_args.args[1], "checking_code")
        self.assertNotIn("verified", update.call_args.kwargs)


if __name__ == "__main__":
    unittest.main()
