import unittest

from transcript import normalize_state, state_from_text


class TranscriptStateTest(unittest.TestCase):
    def test_normalize_state_codes_and_names(self) -> None:
        self.assertEqual(normalize_state("CA"), "CA")
        self.assertEqual(normalize_state("ca"), "CA")
        self.assertEqual(normalize_state("California"), "CA")
        self.assertEqual(normalize_state("New York"), "NY")
        self.assertEqual(normalize_state(""), "")
        self.assertEqual(normalize_state("Narnia"), "")

    def test_state_from_explicit_line(self) -> None:
        text = (
            "HIGH SCHOOL TRANSCRIPT (Grades 9-11)\n\n"
            "Student: Darren Tang\n"
            "School: Mission San Jose High School\n"
            "State: CA\n\n"
            "=== Grade 9 ===\n"
        )
        self.assertEqual(state_from_text(text), "CA")

    def test_state_from_full_name_line(self) -> None:
        self.assertEqual(state_from_text("State: California\n"), "CA")
        self.assertEqual(state_from_text("School: Lincoln\n"), "")


if __name__ == "__main__":
    unittest.main()
