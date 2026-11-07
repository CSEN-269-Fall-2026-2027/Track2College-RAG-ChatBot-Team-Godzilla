import unittest
from unittest.mock import patch

import query


class SearchTests(unittest.TestCase):
    def tools_for(self, text: str, persona: str = "sage"):
        with patch.object(query, "_call_groq", return_value="Hi") as call:
            query.generate_answer(text, persona=persona)
        return call.call_args.kwargs["tools"]

    def test_short_fact_questions_search(self) -> None:
        self.assertIsNotNone(self.tools_for("When is the UC deadline?"))

    def test_everyday_words_dont_search(self) -> None:
        for text in ("When should I start?", "How do I act in an interview?", "What's the aid office like?"):
            self.assertIsNone(self.tools_for(text))

    def test_guides_that_use_their_own_notes_never_search(self) -> None:
        for persona in ("milo", "quill", "theo"):
            self.assertIsNone(self.tools_for("When is the UC deadline?", persona))

    def test_chat_keeps_thinking_low_and_milo_replies_short(self) -> None:
        with patch.object(query, "_call_groq", return_value="Hi") as call:
            query.generate_answer("Do clubs count?", persona="milo")
        self.assertEqual(call.call_args.kwargs["reasoning_effort"], "low")
        self.assertEqual(call.call_args.kwargs["max_tokens"], 300)

    def test_an_essay_never_searches(self) -> None:
        self.assertIsNone(self.tools_for("I need help with my essay. " + "When we lost the game, I led. " * 40))


if __name__ == "__main__":
    unittest.main()
