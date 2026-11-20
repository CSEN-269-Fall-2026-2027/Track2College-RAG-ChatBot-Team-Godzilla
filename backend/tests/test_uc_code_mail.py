import time
import unittest
from unittest import mock

import uc_account
import uc_code_mail


class CodeInTest(unittest.TestCase):
    def test_reads_ucs_real_verification_email(self):
        # Subject + Gmail snippet of UC's actual email (from noreply@ucop.edu), with a made-up code.
        text = (
            "UC application – Verify your account\n"
            "University of California application Thanks for creating your account for the University of "
            "California application. Your verification code is 12345678, enter this 8-digit code into the verification"
        )
        self.assertEqual(uc_code_mail.code_in(text), "12345678")
        self.assertIn("from:noreply@ucop.edu", uc_code_mail.UC_CODE_QUERY)
        self.assertIn('subject:"verify your account"', uc_code_mail.UC_CODE_QUERY)

    def test_an_8_digit_code_counts_even_without_the_word_code(self):
        self.assertEqual(uc_code_mail.code_in("Enter 87654321 to finish signing up."), "87654321")

    def test_reads_codes_the_way_verification_emails_word_them(self):
        self.assertEqual(uc_code_mail.code_in("Your verification code is 845210. It expires in 10 minutes."), "845210")
        self.assertEqual(uc_code_mail.code_in("Use the code below to verify your account:\n\n  A7K29Q"), "A7K29Q")
        self.assertEqual(uc_code_mail.code_in("Verification code: 4821"), "4821")
        # Words near "code" are never taken for one (a code has a digit).
        self.assertEqual(uc_code_mail.code_in("Enter the code below. Thanks!"), None)
        # A plain 6-digit number still counts when the email doesn't say "code".
        self.assertEqual(uc_code_mail.code_in("Welcome to UC! 913374 is your one-time PIN"), "913374")


class RunSearchTest(unittest.TestCase):
    def _run(self):
        run_id = "r1"
        uc_account._runs[run_id] = {
            "owner": "student", "status": "needs_code", "detail": "UC emailed you a verification code. Type it in here.",
            "open": True, "cancelled": False, "code": None, "code_search": False, "tried_codes": [],
            "code_asked_at": 0.0, "searched_for": -1, "auto_codes": 0,
        }
        self.addCleanup(uc_account._runs.pop, run_id, None)
        return run_id

    def _wait(self, run_id):
        deadline = time.monotonic() + 3
        while uc_account._runs[run_id]["code_search"] and time.monotonic() < deadline:
            time.sleep(0.01)

    def test_fills_in_the_code_found_in_gmail_like_a_typed_one(self):
        run_id = self._run()
        with mock.patch.object(uc_code_mail, "find_code", return_value="845210"):
            uc_account._start_code_search(run_id)
            self._wait(run_id)
        run = uc_account._runs[run_id]
        self.assertEqual(run["code"], "845210")
        self.assertEqual(run["status"], "checking_code")
        # Never sent to the browser.
        self.assertNotIn("tried_codes", uc_account.status(run_id, "student"))
        self.assertNotIn("code", uc_account.status(run_id, "student"))

    def test_asks_the_student_when_nothing_turns_up_and_searches_only_once_per_code_screen(self):
        run_id = self._run()
        calls = []
        with mock.patch.object(uc_code_mail, "find_code", side_effect=lambda *a: calls.append(1)), mock.patch.object(
            uc_account, "CODE_SEARCH_S", 0.05
        ), mock.patch.object(uc_account, "CODE_POLL_S", 0.01):
            uc_account._start_code_search(run_id)
            self._wait(run_id)
            uc_account._start_code_search(run_id)  # same code screen: no second search
            self._wait(run_id)
        run = uc_account._runs[run_id]
        self.assertIsNone(run["code"])
        self.assertEqual(run["detail"], "UC emailed you a verification code. Type it in here.")
        self.assertEqual(run["searched_for"], 0)
        self.assertGreater(len(calls), 0)


if __name__ == "__main__":
    unittest.main()
