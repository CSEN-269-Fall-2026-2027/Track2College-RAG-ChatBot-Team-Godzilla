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


class PiqRejectedSaveTest(unittest.TestCase):
    """UC staying on the answer page after Save used to crash on the next tick (pending.remove twice)."""

    def setUp(self):
        self.run_id = "piq-run"
        with uc_account._lock:
            uc_account._runs[self.run_id] = {
                "piq_report": {"entered": [], "skipped": [], "removed": []},
            }

    def tearDown(self):
        with uc_account._lock:
            uc_account._runs.pop(self.run_id, None)

    @patch.object(uc_account, "_set")
    @patch.object(uc_account, "_visible_error", return_value="Please write at least 250 words")
    @patch.object(uc_account.uc_sections, "show_banner")
    @patch.object(uc_account.uc_sections, "save_piq_answer", return_value=False)
    @patch.object(uc_account.uc_sections, "replace_piq_answer", return_value=True)
    @patch.object(uc_account.uc_sections, "piq_box_text", return_value="old essay on UC")
    @patch.object(uc_account.uc_sections, "piq_answer_code", return_value="02")
    def test_rejected_save_does_not_crash_on_retry(self, *_mocks):
        q = {"number": 1, "title": "Leadership", "text": "test1"}
        insight = uc_account._PersonalInsight(self.run_id, Mock(), [q])
        insight.answering = q
        insight.state = "questions"

        insight._answer()  # first attempt: UC rejects
        self.assertIsNone(insight.answering)
        self.assertEqual(insight.pending, [])
        self.assertEqual(
            uc_account._runs[self.run_id]["piq_report"]["skipped"][0],
            "Leadership (UC didn't accept it: Please write at least 250 words)",
        )

        # Same answer page next tick — must not raise list.remove ValueError.
        insight.answering = q
        insight._answer()
        self.assertIsNone(insight.answering)

    @patch.object(uc_account.uc_sections, "subpages")
    @patch.object(uc_account.uc_sections, "on_piq_answer_page", return_value=True)
    def test_step_waits_on_answer_page_after_handing_off(self, on_answer, subpages):
        subpages.return_value = [
            {"name": "Introduction", "url": "https://uc.example/intro"},
            {"name": "Personal insight questions", "url": "https://uc.example/piq"},
        ]
        page = Mock()
        page.url = "https://uc.example/answer"
        insight = uc_account._PersonalInsight(self.run_id, page, [{"number": 1, "title": "Leadership", "text": "test1"}])
        insight.state = "questions"
        insight.answering = None  # already handed off after a rejected save
        insight.pending = []
        insight.step()  # must return without cancelling or crashing
        on_answer.assert_called()


if __name__ == "__main__":
    unittest.main()
