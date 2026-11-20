import unittest

from unittest import mock

import counselor
from counselor import finish_email


class FinishEmailTest(unittest.TestCase):
    def test_replaces_model_sign_off_and_placeholders(self):
        body = "Dear Ms. Lee,\n\nI'm Maya, a [Grade] senior.\n\nSincerely,\nMaya [Last]"
        self.assertEqual(
            finish_email(body, "Maya Chen"),
            "Dear Ms. Lee,\n\nI'm Maya, a senior.\n\nSincerely,\nMaya Chen",
        )

    def test_signs_when_model_left_sign_off_out(self):
        self.assertEqual(finish_email("Dear Mr. Ruiz,\n\nThank you!", "Ana Ruiz"), "Dear Mr. Ruiz,\n\nThank you!\n\nSincerely,\nAna Ruiz")

    def test_no_name(self):
        self.assertEqual(finish_email("Hi,\n\nBest,\n[Your Name]", ""), "Hi,\n\nSincerely,")


if __name__ == "__main__":
    unittest.main()


class FindCounselorsRetryTests(unittest.TestCase):
    """The web search sometimes fails on its own (Groq 400: the model called a tool that doesn't exist)."""

    ROW = '{"counselors": [{"name": "Lindsay Rotter", "title": "Counselor", "email": "lrotter@fusdk12.net", "serves": "Si - Z", "match": false, "source_url": "https://example.org/counselors"}]}'

    def test_retries_an_empty_search_then_returns_the_counselors(self):
        replies = iter(["", self.ROW])
        with mock.patch.object(counselor, "complete", side_effect=lambda *a, **k: next(replies)), mock.patch.object(
            counselor, "last_failure", return_value="error"
        ):
            found = counselor.find_counselors("Mission San Jose High School", "Fremont", "CA", "")
        self.assertEqual([c["name"] for c in found], ["Lindsay Rotter"])
        self.assertEqual(found[0]["serves"], "Si - Z")

    def test_gives_up_after_a_few_tries_with_a_plain_message(self):
        calls = []
        with mock.patch.object(counselor, "complete", side_effect=lambda *a, **k: calls.append(1) or ""), mock.patch.object(
            counselor, "last_failure", return_value="error"
        ):
            with self.assertRaisesRegex(RuntimeError, "didn't finish"):
                counselor.find_counselors("Mission San Jose High School", "Fremont", "CA", "")
        self.assertEqual(len(calls), counselor.FIND_ATTEMPTS)

    def test_does_not_retry_a_missing_key(self):
        calls = []
        with mock.patch.object(counselor, "complete", side_effect=lambda *a, **k: calls.append(1) or ""), mock.patch.object(
            counselor, "last_failure", return_value="missing_key"
        ):
            with self.assertRaisesRegex(RuntimeError, "GROQ_API_KEY"):
                counselor.find_counselors("Mission San Jose High School", "Fremont", "CA", "")
        self.assertEqual(len(calls), 1)
