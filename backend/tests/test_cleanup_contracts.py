"""Regression checks for live API boundaries and authentication failures."""
import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException
from pydantic import ValidationError
import api
import auth
import persona


class LiveApiContractsTest(unittest.TestCase):
    def test_retired_endpoints_are_gone(self):
        paths = {route.path for route in api.app.routes}
        self.assertFalse(paths & {"/profile/analysis", "/plan/courses", "/essay/generate", "/activities/extract"})
        self.assertTrue({"/chat", "/transcript/analyze", "/essay/piqs", "/google/activities", "/agent/uc-account/start"} <= paths)

    def test_only_cloud_application_runs_are_accepted(self):
        facts = {"email": "student@example.com", "password": "ValidPass1!", "mode": "login"}
        self.assertEqual(api.UcAccountStartRequest(**facts).browser, "cloud")
        with self.assertRaises(ValidationError):
            api.UcAccountStartRequest(**facts, browser="local")

    def test_parked_aid_modes_are_ignored_but_penny_is_still_a_guide(self):
        self.assertIsNone(persona.normalize_mode("fafsa"))
        self.assertEqual(persona.mode_prompt("scholarships"), "")
        self.assertIn("financial aid", persona.persona_prompt("penny"))

    def test_auth_service_malformed_success_is_a_retryable_failure(self):
        response = Mock(status_code=200)
        response.json.side_effect = ValueError("invalid json")
        with patch.object(auth, "supabase_url", return_value="https://example.supabase.co"), patch.object(auth, "anon_key", return_value="public"), patch.object(auth.requests, "get", return_value=response):
            with self.assertRaises(HTTPException) as failure:
                auth.verify("diagnostic-malformed-token")
        self.assertEqual(failure.exception.status_code, 503)
