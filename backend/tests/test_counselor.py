import unittest

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
