import unittest

from persona import extract_mood, needs_campus_notes, number_suggested_essays, mode_prompt, normalize_mode, normalize_persona, persona_prompt


class PersonaTests(unittest.TestCase):
    def test_suggested_essays_get_uc_numbers(self) -> None:
        reply = (
            "**Top 4**\n1. **Leadership** – Captaining soccer.\n2. Academic subject – Why CS.\n"
            "3. **Community (Prompt 7)** – Helping out.\n4. what makes you stand out: You.\n\n"
            "**Backup**\n- Significant challenge – Something hard. Leadership matters here too."
        )
        self.assertEqual(
            number_suggested_essays("Suggest four essays for me.", reply),
            "**Top 4**\n1. **Leadership (Prompt #1)** – Captaining soccer.\n2. Academic subject (Prompt #6) – Why CS.\n"
            "3. **Community (Prompt #7)** – Helping out.\n4. What makes you stand out (Prompt #8): You.\n\n"
            "**Backup**\n- Significant challenge (Prompt #5) – Something hard. Leadership matters here too.",
        )

    def test_other_quill_answers_arent_numbered(self) -> None:
        self.assertEqual(number_suggested_essays("How do I write this?", "Leadership is about people."), "Leadership is about people.")

    def test_theo_leaves_out_campus_notes_when_picking_a_major(self) -> None:
        self.assertIn("Golden Bears", persona_prompt("theo"))
        self.assertNotIn("Golden Bears", persona_prompt("theo", campus_notes=False))
        self.assertIn("Mood:", persona_prompt("theo", campus_notes=False))
        self.assertFalse(needs_campus_notes(["Can you help me pick a major?", "", ""]))
        self.assertTrue(needs_campus_notes(["What's Biology like at UC Davis?", "", ""]))
        self.assertTrue(needs_campus_notes(["What about housing there?", "", ""]))

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

    def test_theo_knows_all_nine_campuses(self) -> None:
        self.assertEqual(normalize_persona(" Theo "), "theo")
        prompt = persona_prompt("theo")
        for campus in ("UC Berkeley", "UCLA", "UC San Diego", "UC Davis", "UC Irvine",
                       "UC Santa Barbara", "UC Santa Cruz", "UC Riverside", "UC Merced"):
            self.assertIn(f"- {campus}:", prompt)
        self.assertIn("Application Assistant", prompt)
        self.assertIn("Penny", prompt)

    def test_review_modes_set_the_task(self) -> None:
        self.assertEqual(mode_prompt(None), "")
        self.assertEqual(mode_prompt("pirate"), "")
        self.assertEqual(normalize_mode(" Counselor "), "counselor")
        self.assertIn("school counselor", mode_prompt("counselor"))
        self.assertIn("Join video call", mode_prompt("counselor"))
        self.assertIn("help me apply", mode_prompt("assistant"))

    def test_aid_modes_set_the_task(self) -> None:
        self.assertEqual(normalize_mode(" FAFSA "), "fafsa")
        self.assertEqual(normalize_mode("scholarships"), "scholarships")
        self.assertIn("California Dream Act", mode_prompt("fafsa"))
        self.assertIn("Cal Grant", mode_prompt("fafsa"))
        self.assertIn("never charge a fee", mode_prompt("scholarships"))
        self.assertNotIn("Scholarships (Financial Aid step)", mode_prompt("fafsa"))

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
