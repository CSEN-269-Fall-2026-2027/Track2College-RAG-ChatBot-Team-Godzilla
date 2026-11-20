import unittest

from activities import DESCRIPTION_LIMIT, clean_items


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


if __name__ == "__main__":
    unittest.main()
