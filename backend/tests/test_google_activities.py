import importlib
import sys
import types
import unittest
from unittest import mock


class _Call:
    def __init__(self, result):
        self._result = result

    def execute(self):
        return self._result


SOCCER_BODY = (
    "Hi Darren,\n\nCongratulations on winning the state championship! You and your teammates worked hard all "
    "season, and I hope you're taking some time to enjoy the win.\n\nI'm also excited to let you know that "
    "you've been named captain of the soccer team.\n\nSincerely,\nCoach Carter"
)


def _b64(text):
    import base64

    return base64.urlsafe_b64encode(text.encode()).decode().rstrip("=")


class _FakeMessages:
    """A mailbox where the soccer email is old (only the activity search reaches it) and its key line
    is past Gmail's ~200-character snippet."""

    def __init__(self):
        self.queries = []
        self.store = {
            "soccer": {"labels": ["INBOX"], "subject": "Congratulations, Captain!", "body": SOCCER_BODY},
            "recent": {"labels": ["INBOX"], "subject": "Order", "body": "Your order shipped."},
            "outgoing": {"labels": ["SENT"], "subject": "Counselor meeting", "body": "I play varsity soccer."},
        }

    def list(self, userId, q, maxResults):
        self.queries.append(q)
        found = ["soccer", "outgoing", "recent"] if "varsity" in q else ["recent"]
        return _Call({"messages": [{"id": i} for i in found]})

    def get(self, userId, id, format):
        m = self.store[id]
        headers = [{"name": "Subject", "value": m["subject"]}, {"name": "From", "value": "Coach <coach@example.com>"}]
        return _Call({
            "labelIds": m["labels"],
            "snippet": " ".join(m["body"].split())[:200],
            "payload": {"mimeType": "multipart/alternative", "headers": headers, "parts": [{"mimeType": "text/plain", "body": {"data": _b64(m["body"])}}]},
        })


class GmailScanTest(unittest.TestCase):
    def test_searches_received_mail_for_activities_not_just_the_newest_50(self):
        fake = _FakeMessages()
        service = types.SimpleNamespace(users=lambda: types.SimpleNamespace(messages=lambda: fake))
        discovery = types.SimpleNamespace(build=lambda *a, **k: service)
        # Only inside this test: fake Google libraries, and a google_oauth that needs no `cryptography`.
        fakes = {
            "googleapiclient": types.ModuleType("googleapiclient"),
            "googleapiclient.discovery": discovery,
            "google_oauth": types.SimpleNamespace(credentials_for=lambda _uid: None),
        }
        with mock.patch.dict(sys.modules, fakes):
            sys.modules.pop("google_activities", None)
            google_activities = importlib.import_module("google_activities")
            lines = google_activities._gmail_snippets("student")
        # The activity search reaches an old email; outgoing mail (Sent, not Inbox) is dropped; nothing twice.
        self.assertEqual(len(lines), 2)
        self.assertTrue(lines[0].startswith("[Email 1]"))
        self.assertTrue(lines[1].startswith("[Email 2]"))
        # The line past the snippet ("named captain of the soccer team") reaches the model.
        self.assertIn("named captain of the soccer team", lines[0])
        # Team apps often land in Promotions/Social: only the newest-mail pass skips those tabs.
        self.assertNotIn("category:promotions", fake.queries[0])
        self.assertIn("category:promotions", fake.queries[1])


class EvidenceTest(unittest.TestCase):
    def test_keeps_activity_sentences_past_the_snippet_and_drops_quoted_replies(self):
        with mock.patch.dict(sys.modules, {"google_oauth": types.SimpleNamespace()}):
            sys.modules.pop("google_activities", None)
            ga = importlib.import_module("google_activities")
        body = SOCCER_BODY + "\n\nOn Tue, Coach wrote:\n> old practice schedule"
        payload = {"mimeType": "text/plain", "body": {"data": _b64(body)}}
        text = ga._body_text(payload)
        self.assertNotIn("old practice schedule", text)
        snippet = " ".join(SOCCER_BODY.split())[:200]
        evidence = ga._evidence(text, snippet)
        self.assertIn("you've been named captain of the soccer team.", evidence)
        # Already in the snippet, so not repeated.
        self.assertNotIn("state championship", evidence)


if __name__ == "__main__":
    unittest.main()
