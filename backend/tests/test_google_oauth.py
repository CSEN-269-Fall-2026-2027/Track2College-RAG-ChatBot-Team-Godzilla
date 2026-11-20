"""Unit tests for Connect Google helpers (no live Google / Supabase calls)."""

from __future__ import annotations

import os
import unittest
from unittest import mock

from cryptography.fernet import Fernet


class GoogleOAuthHelpersTest(unittest.TestCase):
    def setUp(self) -> None:
        self.key = Fernet.generate_key().decode()
        self.env = {
            "GOOGLE_CLIENT_ID": "client-id",
            "GOOGLE_CLIENT_SECRET": "client-secret",
            "GOOGLE_REDIRECT_URI": "http://127.0.0.1:8000/google/oauth/callback",
            "GOOGLE_TOKEN_ENCRYPTION_KEY": self.key,
            "GOOGLE_FRONTEND_ORIGIN": "http://localhost:5500",
            "SUPABASE_SERVICE_ROLE_KEY": "service-role",
            "SUPABASE_URL": "https://example.supabase.co",
        }
        self.patcher = mock.patch.dict(os.environ, self.env, clear=False)
        self.patcher.start()
        # Reload module env readers pick up patched values via os.getenv each call.
        import google_oauth as go

        self.go = go

    def tearDown(self) -> None:
        self.patcher.stop()

    def test_configured_when_env_present(self) -> None:
        self.assertTrue(self.go.configured())

    def test_state_round_trip(self) -> None:
        state = self.go.make_state("user-123")
        self.assertEqual(self.go.parse_state(state), "user-123")

    def test_state_rejects_tampering(self) -> None:
        state = self.go.make_state("user-123")
        bad = state[:-4] + "dead"
        with self.assertRaises(self.go.GoogleOAuthError):
            self.go.parse_state(bad)

    def test_encrypt_decrypt_refresh_token(self) -> None:
        cipher = self.go.encrypt_refresh_token("refresh-token-value")
        self.assertNotEqual(cipher, "refresh-token-value")
        self.assertEqual(self.go.decrypt_refresh_token(cipher), "refresh-token-value")

    def test_frontend_redirect_success(self) -> None:
        url = self.go.frontend_redirect(ok=True)
        self.assertTrue(url.startswith("http://localhost:5500/?"))
        self.assertIn("google=connected", url)

    def test_frontend_redirect_error(self) -> None:
        url = self.go.frontend_redirect(ok=False, detail="Nope")
        self.assertIn("google=error", url)
        self.assertIn("google_error=Nope", url)


if __name__ == "__main__":
    unittest.main()
