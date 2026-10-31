import unittest
from unittest.mock import patch

import piq


class PiqTests(unittest.TestCase):
    def test_has_all_eight_official_questions(self) -> None:
        self.assertEqual(len(piq.PIQS), 8)
        self.assertEqual([p["number"] for p in piq.PIQS.values()], [str(n) for n in range(1, 9)])
        self.assertIn("helped resolve disputes", piq.PIQS["leadership"]["question"])

    def test_trim_keeps_whole_sentences_under_limit(self) -> None:
        text = " ".join(["This is a sentence of exactly ten words in it."] * 40)
        trimmed = piq._trim_to_limit(text)
        self.assertLessEqual(piq.word_count(trimmed), piq.WORD_LIMIT)
        self.assertTrue(trimmed.endswith("."))

    def test_overlong_draft_is_rewritten_then_capped(self) -> None:
        long = "word " * 420
        with patch.object(piq, "_call_groq", side_effect=[long, long]) as call:
            out = piq.draft_piq("talent", [{"question": "Q", "answer": "A"}], "Name: Maya")
        self.assertEqual(call.call_count, 2)
        self.assertLessEqual(out["word_count"], piq.WORD_LIMIT)

    def test_answers_and_official_question_are_in_the_prompt(self) -> None:
        good = "word " * 300
        with patch.object(piq, "_call_groq", return_value=good) as call:
            piq.draft_piq("community", [{"question": "What did you fix?", "answer": "Started a food pantry"}], "")
        user = call.call_args[0][0][1]["content"]
        self.assertIn("make your school or your community a better place", user)
        self.assertIn("Started a food pantry", user)

    def test_unknown_id_rejected(self) -> None:
        with self.assertRaises(ValueError):
            piq.generate_piqs([{"id": "nope"}], "")


if __name__ == "__main__":
    unittest.main()
