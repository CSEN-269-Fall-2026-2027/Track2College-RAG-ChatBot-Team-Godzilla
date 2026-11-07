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

    def test_trim_counts_words_across_paragraph_breaks(self) -> None:
        text = "\n\n".join(" ".join(["word"] * 100) + "." for _ in range(5))
        self.assertLessEqual(piq.word_count(piq._trim_to_limit(text)), piq.WORD_LIMIT)

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

    def test_used_activities_are_named_as_off_limits(self) -> None:
        with patch.object(piq, "_call_groq", return_value="word " * 300) as call:
            piq.draft_piq("talent", [], "Name: Maya", "- Soccer", used_activities=["soccer"])
        self.assertEqual(call.call_count, 1)
        self.assertIn("ALREADY USED", call.call_args[0][0][1]["content"])
        self.assertIn("soccer", call.call_args[0][0][1]["content"])

    def test_draft_that_repeats_an_activity_is_rewritten(self) -> None:
        bad = "On the Soccer field I grew. " + "word " * 300
        good = "word " * 300
        with patch.object(piq, "_call_groq", side_effect=[bad, good]) as call:
            out = piq.draft_piq("talent", [], "Name: Maya", "- Soccer", used_activities=["soccer"])
        self.assertEqual(call.call_count, 2)
        self.assertNotIn("Soccer", out["essay"])

    def test_no_used_activities_changes_nothing(self) -> None:
        with patch.object(piq, "_call_groq", return_value="word " * 300) as call:
            piq.draft_piq("talent", [], "Name: Maya", "- Soccer")
        self.assertNotIn("ALREADY USED", call.call_args[0][0][1]["content"])

    def test_invented_details_are_rewritten_then_removed(self) -> None:
        made_up = "I started tutoring in middle school. I love computer science. " + "word " * 300
        with patch.object(piq, "_call_groq", side_effect=[made_up, made_up, made_up]):
            out = piq.draft_piq("subject", [], "Intended major: Computer Science")
        self.assertNotIn("tutoring", out["essay"].lower())
        self.assertNotIn("middle school", out["essay"].lower())
        self.assertIn("computer science", out["essay"].lower())

    def test_details_the_student_gave_stay(self) -> None:
        with patch.object(piq, "_call_groq", return_value="I started tutoring last year. " + "word " * 300) as call:
            out = piq.draft_piq("community", [{"question": "Q", "answer": "I tutor math."}], "")
        self.assertEqual(call.call_count, 1)
        self.assertIn("tutoring", out["essay"])

    def test_essays_never_have_dashes_or_special_marks(self) -> None:
        with patch.object(piq, "_call_groq", return_value="I grew \u2014 slowly \u2013 as a first-generation student & more\u2026 " + "word " * 300):
            essay = piq.draft_piq("talent", [], "")["essay"]
        self.assertNotRegex(essay, "[-\u2010-\u2015&\u2026]")

    def test_unknown_id_rejected(self) -> None:
        with self.assertRaises(ValueError):
            piq.generate_piqs([{"id": "nope"}], "")


if __name__ == "__main__":
    unittest.main()
