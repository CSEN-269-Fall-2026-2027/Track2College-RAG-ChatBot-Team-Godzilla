import unittest
from unittest.mock import patch

import activities
from activities import DESCRIPTION_LIMIT, clean_items, extract_activities


class CleanItemsTests(unittest.TestCase):
    def test_keeps_named_entries_once(self) -> None:
        items = clean_items({"activities": [
            {"name": "Soccer Team", "role": "Captain", "description": "Runs warmups."},
            {"name": "soccer team", "role": "", "description": "Repeat."},
            {"name": " ", "role": "Nameless"},
            "not an entry",
        ]})
        self.assertEqual(items, [{"name": "Soccer Team", "role": "Captain", "description": "Runs warmups.", "level": ""}])

    def test_holds_descriptions_to_the_limit_at_a_sentence(self) -> None:
        first = "A" * 200 + "."
        items = clean_items({"activities": [{"name": "Club", "description": f"{first} {'B' * 300}."}]})
        self.assertEqual(items[0]["description"], first)
        unbroken = clean_items({"activities": [{"name": "Club", "description": "C" * 500}]})
        self.assertEqual(len(unbroken[0]["description"]), DESCRIPTION_LIMIT)

    def test_keeps_only_known_award_levels(self) -> None:
        items = clean_items({"activities": [{"name": "Science Fair", "level": "State"}, {"name": "Honor Roll", "level": "galactic"}]})
        self.assertEqual([i["level"] for i in items], ["state", ""])

    def test_survives_a_reply_without_a_list(self) -> None:
        self.assertEqual(clean_items({"activities": "none"}), [])


class ExtractTests(unittest.TestCase):
    def test_rejects_an_unknown_section(self) -> None:
        with self.assertRaises(ValueError):
            extract_activities("notes", "hobbies")

    def test_reports_an_empty_or_unreadable_reply(self) -> None:
        for reply in ("", "sorry, no JSON here"):
            with patch.object(activities, "complete", return_value=reply), self.assertRaises(RuntimeError):
                extract_activities("Student: soccer", "activities")

    def test_awards_use_their_own_prompt(self) -> None:
        reply = '{"activities": [{"name": "Honor Roll", "level": "school"}]}'
        with patch.object(activities, "complete", return_value=reply) as call:
            self.assertEqual(extract_activities("Student: honor roll", "awards")[0]["level"], "school")
        self.assertIn("honors and awards", call.call_args.args[0])
        self.assertNotIn("description", call.call_args.args[0])

    def test_prompt_names_the_section(self) -> None:
        reply = '{"activities": [{"name": "Food Bank", "role": "", "description": ""}]}'
        with patch.object(activities, "complete", return_value=reply) as call:
            self.assertEqual(extract_activities("Student: food bank", "volunteering")[0]["name"], "Food Bank")
        self.assertIn("volunteering experiences", call.call_args.args[0])


if __name__ == "__main__":
    unittest.main()
