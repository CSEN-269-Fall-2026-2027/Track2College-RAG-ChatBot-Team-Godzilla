import unittest

from persona import extract_mood, normalize_persona, persona_prompt


class PersonaTests(unittest.TestCase):
    def test_unknown_persona_adds_nothing(self) -> None:
        self.assertIsNone(normalize_persona("bowser"))
        self.assertEqual(persona_prompt(None), "")
        self.assertEqual(persona_prompt("bowser"), "")

    def test_known_persona_is_case_insensitive(self) -> None:
        self.assertEqual(normalize_persona(" Penny "), "penny")
        self.assertIn("Penny", persona_prompt("PENNY"))
        self.assertIn("Mood:", persona_prompt("sage"))

    def test_guides_carry_their_focus(self) -> None:
        self.assertEqual(normalize_persona("Milo"), "milo")
        self.assertIn("Personal Insight Questions", persona_prompt("quill"))
        self.assertIn("financial aid", persona_prompt("penny"))
        self.assertNotIn("{focus}", persona_prompt("sage"))

    def test_extracts_trailing_mood_line(self) -> None:
        text = "Answer:\nFile early.\n\nFollow-up Questions you might have:\nQ1. When?\nMood: concerned"
        mood, cleaned = extract_mood(text)
        self.assertEqual(mood, "concerned")
        self.assertNotIn("Mood", cleaned)
        self.assertTrue(cleaned.endswith("Q1. When?"))

    def test_tolerates_markdown_bold_mood(self) -> None:
        mood, _ = extract_mood("Answer:\nYes!\n**Mood:** Excited")
        self.assertEqual(mood, "excited")

    def test_unknown_mood_word_is_dropped_but_line_removed(self) -> None:
        mood, cleaned = extract_mood("Answer:\nHi\nMood: furious")
        self.assertIsNone(mood)
        self.assertEqual(cleaned, "Answer:\nHi")

    def test_no_mood_line_leaves_text_alone(self) -> None:
        self.assertEqual(extract_mood("Answer:\nHi"), (None, "Answer:\nHi"))


if __name__ == "__main__":
    unittest.main()
