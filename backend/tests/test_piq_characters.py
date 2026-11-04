"""UC refuses a Personal Insight answer over a single special character."""

import re
import unittest
from unittest.mock import patch

import piq

ALLOWED = re.compile(r"^[A-Za-z0-9 \n.,!?';:()]*$")


class PlainCharactersTest(unittest.TestCase):
    def test_dashes_and_hyphens_never_survive(self):
        for text, expected in [
            ("I learned \u2014 slowly \u2014 to lead.", "I learned, slowly, to lead."),
            ("I learned--slowly.", "I learned, slowly."),
            ("I led \u2013 and listened.", "I led, and listened."),
            ("A first-generation, part-time job.", "A first generation, part time job."),
            ("Grades 10-12 and 9\u201311.", "Grades 10 to 12 and 9 to 11."),
            ("It worked - mostly.", "It worked, mostly."),
        ]:
            self.assertEqual(piq._plain_characters(text), expected)

    def test_other_special_characters(self):
        self.assertEqual(piq._plain_characters("\u201cHi\u201d, it\u2019s Jos\u00e9 & 20% more\u2026"), "Hi, it's Jose and 20 percent more...")
        self.assertTrue(ALLOWED.match(piq._plain_characters("A~B #1 @home $5 * / + = \U0001f600 \u00a9")))

    def test_paragraphs_and_normal_writing_are_untouched(self):
        text = "I don't quit (ever).\n\nThat's what I learned: keep going!"
        self.assertEqual(piq._plain_characters(text), text)

    def test_generated_drafts_come_out_plain(self):
        dashed = " ".join(["I worked hard \u2014 first-generation pride."] * 50)
        with patch.object(piq, "_call_groq", return_value=dashed):
            draft = piq.draft_piq("leadership", [], "")
        self.assertTrue(ALLOWED.match(draft["essay"]), draft["essay"][:120])

    def test_prompt_states_the_rule(self):
        self.assertIn("NEVER use a hyphen", piq.SYSTEM_PROMPT)


if __name__ == "__main__":
    unittest.main()
