"""
Security checks for the UC assistant: sign-in on every route, run ownership, and keeping secrets out of logs, status messages, debug files and Browserbase.

No network: Supabase and Browserbase calls are mocked. (The end-to-end run against a real local
Supabase is separate; see the PR notes.)
"""

import io
import os
import re
import socket
import sys
import tempfile
import threading
import time
import types
import unittest
from contextlib import redirect_stdout
from unittest.mock import Mock, patch

import requests

import auth
import cloud_browser
import redact
import uc_account

PW = "Tq7#mVx2!pLr9Kd4"


def _reset_runs():
    with uc_account._lock:
        uc_account._runs.clear()
        uc_account._active = None


class AuthTest(unittest.TestCase):
    def setUp(self):
        auth._cache.clear()
        self.env = patch.dict(os.environ, {"SUPABASE_URL": "http://sb.test", "SUPABASE_ANON_KEY": "anon"})
        self.env.start()

    def tearDown(self):
        self.env.stop()

    def _reply(self, status, body=None):
        r = Mock(status_code=status)
        r.json.return_value = body or {}
        return r

    def test_missing_or_malformed_header_is_401(self):
        for header in (None, "", "Bearer", "Bearer   ", "Basic abc", "token abc"):
            with self.assertRaises(auth.HTTPException) as ctx:
                auth.current_student(header)
            self.assertEqual(ctx.exception.status_code, 401, header)

    @patch.object(auth.requests, "get")
    def test_supabase_rejects_token_is_401(self, get):
        get.return_value = self._reply(401, {"msg": "invalid JWT"})
        with self.assertRaises(auth.HTTPException) as ctx:
            auth.current_student("Bearer forged.token.here")
        self.assertEqual(ctx.exception.status_code, 401)

    @patch.object(auth.requests, "get")
    def test_student_id_comes_from_supabase_only(self, get):
        get.return_value = self._reply(200, {"id": "student-a"})
        student = auth.current_student("Bearer good.token")
        self.assertEqual(student.id, "student-a")
        self.assertEqual(get.call_args.kwargs["headers"]["Authorization"], "Bearer good.token")
        self.assertNotIn("good.token", repr(student))

    @patch.object(auth.requests, "get")
    def test_verified_token_is_cached_briefly(self, get):
        get.return_value = self._reply(200, {"id": "student-a"})
        auth.current_student("Bearer cached.token")
        auth.current_student("Bearer cached.token")
        self.assertEqual(get.call_count, 1)

    @patch.object(auth.requests, "get")
    def test_supabase_down_is_503_not_a_pass(self, get):
        get.return_value = self._reply(502)
        with self.assertRaises(auth.HTTPException) as ctx:
            auth.current_student("Bearer t")
        self.assertEqual(ctx.exception.status_code, 503)
        get.side_effect = requests.ConnectionError("down")
        auth._cache.clear()
        with self.assertRaises(auth.HTTPException) as ctx:
            auth.current_student("Bearer t2")
        self.assertEqual(ctx.exception.status_code, 503)

    def test_not_configured_fails_closed(self):
        with patch.dict(os.environ, {"SUPABASE_URL": "", "VITE_SUPABASE_URL": ""}):
            with self.assertRaises(auth.HTTPException) as ctx:
                auth.current_student("Bearer t")
            self.assertEqual(ctx.exception.status_code, 503)


class RolloutGateTest(unittest.TestCase):
    def setUp(self):
        import api

        self.api = api
        self.student = auth.Student(id="s")

    def test_paused_is_503_for_everyone(self):
        with patch.dict(os.environ, {"UC_ASSISTANT_PAUSED": "1"}):
            for client in (None, "2"):
                with self.assertRaises(auth.HTTPException) as ctx:
                    self.api.uc_student(self.student, client)
                self.assertEqual(ctx.exception.status_code, 503)

    def test_old_page_must_refresh(self):
        with patch.dict(os.environ, {"UC_ASSISTANT_PAUSED": "0"}):
            for client in (None, "", "1", "abc"):
                with self.assertRaises(auth.HTTPException) as ctx:
                    self.api.uc_student(self.student, client)
                self.assertEqual(ctx.exception.status_code, 426, client)
            self.assertIs(self.api.uc_student(self.student, "2"), self.student)


class RunOwnershipTest(unittest.TestCase):
    def setUp(self):
        _reset_runs()
        # Don't open any browser: the run thread does nothing.
        self.run = patch.object(uc_account, "_run")
        self.run.start()

    def tearDown(self):
        self.run.stop()
        _reset_runs()

    def _start(self, owner):
        return uc_account.start("a@example.com", PW, "login", owner=owner)

    def test_owner_required(self):
        with self.assertRaises(uc_account.UcAccountError):
            uc_account.start("a@example.com", PW, "login", owner="")

    def test_only_owner_sees_and_controls_run(self):
        run_id = self._start("alice")
        self.assertIsNotNone(uc_account.status(run_id, "alice"))
        self.assertIsNone(uc_account.status(run_id, "bob"))
        self.assertIsNone(uc_account.active("bob"))
        self.assertEqual(uc_account.active("alice")[0], run_id)
        with self.assertRaises(uc_account.UcAccountError):
            uc_account.cancel(run_id, "bob")
        with uc_account._lock:
            uc_account._runs[run_id]["status"] = "needs_code"
        with self.assertRaises(uc_account.UcAccountError):
            uc_account.submit_code(run_id, "bob", "123456")
        with uc_account._lock:
            self.assertIsNone(uc_account._runs[run_id]["code"])
            self.assertFalse(uc_account._runs[run_id]["cancelled"])
        uc_account.submit_code(run_id, "alice", "123456")
        uc_account.cancel(run_id, "alice")
        with uc_account._lock:
            self.assertTrue(uc_account._runs[run_id]["cancelled"])

    def test_status_never_includes_owner_code_or_session(self):
        run_id = self._start("alice")
        with uc_account._lock:
            uc_account._runs[run_id].update(code="123456", session_id="sess-1")
        self.assertFalse({"owner", "code", "session_id"} & set(uc_account.status(run_id, "alice")))

    def test_busy_message_does_not_reveal_other_run(self):
        self._start("alice")
        with self.assertRaises(uc_account.UcAccountError) as ctx:
            self._start("bob")
        self.assertIn("another student", str(ctx.exception))

    def test_open_sessions_keeps_other_students(self):
        a = self._start("alice")
        with uc_account._lock:
            uc_account._runs[a]["session_id"] = "sess-alice"
        self.assertEqual(uc_account.open_sessions(excluding_owner="bob"), {"sess-alice"})
        self.assertEqual(uc_account.open_sessions(excluding_owner="alice"), set())


class RedactionTest(unittest.TestCase):
    def tearDown(self):
        redact.forget_all()
        _reset_runs()

    def test_registered_secret_and_url_keys_are_masked(self):
        redact.remember(PW)
        out = redact.redact(f"fill failed for {PW} via wss://connect.browserbase.com?signingKey=sk_live_123&x=1")
        self.assertNotIn(PW, out)
        self.assertNotIn("sk_live_123", out)
        self.assertIn("x=1", out)

    def test_other_threads_secrets_do_not_leak_in(self):
        seen = {}

        def other():
            redact.remember("OtherThread#Pw99")
            seen["masked"] = redact.redact("OtherThread#Pw99")

        t = threading.Thread(target=other)
        t.start()
        t.join()
        self.assertEqual(seen["masked"], redact.MASK)
        self.assertEqual(redact.redact("OtherThread#Pw99"), "OtherThread#Pw99")  # not registered here

    def test_password_input_value_in_html_is_masked(self):
        html = '<form><input id="password" type="password" value="Leaked#Pw12345"></form>'
        self.assertNotIn("Leaked#Pw12345", redact.redact(html))

    def test_debug_dump_never_writes_the_password(self):
        page = Mock()
        page.content.return_value = f'<input type="text" value="{PW}"><p>{PW}</p>'
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {"UC_DEBUG": "1"}), patch.object(
            uc_account.os.path, "dirname", return_value=tmp
        ):
            redact.remember(PW)
            with redirect_stdout(io.StringIO()):
                uc_account._debug_dump(page, "test")
            written = ""
            for name in os.listdir(os.path.join(tmp, "uc_debug")):
                with open(os.path.join(tmp, "uc_debug", name), encoding="utf-8") as f:
                    written += f.read()
        self.assertNotIn(PW, written)

    def test_run_failure_logs_and_status_never_contain_secrets(self):
        """Drives the real _run: the browser fails with the password and connect key in its error."""
        _reset_runs()
        with uc_account._lock:
            uc_account._runs["r1"] = {
                "owner": "alice", "status": "opening", "detail": "", "mode": "login", "browser": "cloud",
                "live_url": None, "open": True, "cancelled": False, "finished": False, "page_url": "",
                "created": False, "verified": False, "setup": False, "about": False, "piq": False, "code": None,
            }
        connect = "wss://connect.browserbase.com?signingKey=sk_live_SECRET"

        class Boom(Exception):
            pass

        fake = types.ModuleType("playwright.sync_api")
        fake.Error = Boom

        def sync_playwright():
            p = Mock()
            p.__enter__ = Mock(return_value=p)
            p.__exit__ = Mock(return_value=False)
            p.chromium.connect_over_cdp.side_effect = RuntimeError(f"connect {connect} failed; typed {PW}")
            return p

        fake.sync_playwright = sync_playwright
        out = io.StringIO()
        with patch.dict(sys.modules, {"playwright": types.ModuleType("playwright"), "playwright.sync_api": fake}), patch.object(
            cloud_browser, "create_session", return_value=("sess-1", connect)
        ), patch.object(cloud_browser, "release"), redirect_stdout(out):
            uc_account._run("r1", "alice@example.com", PW, "login", {}, False, False, [], "cloud")
        logged = out.getvalue()
        self.assertIn("cloud browser didn't start", logged)
        self.assertNotIn(PW, logged)
        self.assertNotIn("sk_live_SECRET", logged)
        self.assertNotIn(PW, uc_account._runs["r1"]["detail"])
        self.assertEqual(redact.redact(PW), PW, "secrets are forgotten when the run ends")


class BrowserbaseTest(unittest.TestCase):
    @patch.dict(os.environ, {"BROWSERBASE_API_KEY": "bb_test"})
    @patch.object(cloud_browser.requests, "post")
    def test_sessions_are_never_recorded_or_logged(self, post):
        post.return_value = Mock(status_code=200, json=Mock(return_value={"id": "s1", "connectUrl": "wss://x"}))
        cloud_browser.create_session()
        settings = post.call_args.kwargs["json"]["browserSettings"]
        self.assertIs(settings["recordSession"], False)
        self.assertIs(settings["logSession"], False)

    @patch.dict(os.environ, {"BROWSERBASE_API_KEY": "bb_test"})
    @patch.object(cloud_browser, "release")
    @patch.object(cloud_browser.requests, "get")
    def test_cleanup_keeps_sessions_in_use(self, get, release):
        tag = cloud_browser.APP_TAG
        get.return_value = Mock(json=Mock(return_value=[{"id": "busy", "userMetadata": tag}, {"id": "stale", "userMetadata": tag}]))
        with redirect_stdout(io.StringIO()):
            cloud_browser.release_leftovers(keep={"busy"})
        release.assert_called_once_with("stale")


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class ApiRequiresSignInTest(unittest.TestCase):
    """Real HTTP against the app (uvicorn on a free local port)."""

    @classmethod
    def setUpClass(cls):
        import uvicorn

        import api

        cls.app = api.app
        cls.port = _free_port()
        cls.server = uvicorn.Server(uvicorn.Config(api.app, host="127.0.0.1", port=cls.port, log_level="warning"))
        cls.thread = threading.Thread(target=cls.server.run, daemon=True)
        with patch.object(cloud_browser, "release_leftovers", return_value=0):
            cls.thread.start()
            for _ in range(100):
                if cls.server.started:
                    break
                time.sleep(0.05)

    @classmethod
    def tearDownClass(cls):
        cls.server.should_exit = True
        cls.thread.join(timeout=5)

    def _routes(self):
        for route in self.app.routes:
            for method in sorted(getattr(route, "methods", None) or ()):
                if method in ("HEAD", "OPTIONS"):
                    continue
                yield method, re.sub(r"\{[^}]+\}", "x", route.path)

    def test_every_route_but_health_and_docs_rejects_logged_out_requests(self):
        public = {"/health", "/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"}
        checked = 0
        for method, path in self._routes():
            r = requests.request(method, f"http://127.0.0.1:{self.port}{path}", json={}, timeout=10)
            if path in public:
                self.assertLess(r.status_code, 400, path)
            else:
                self.assertEqual(r.status_code, 401, f"{method} {path} -> {r.status_code}")
                checked += 1
        self.assertGreaterEqual(checked, 17)

    def test_no_response_model_has_a_password_field(self):
        schema = requests.get(f"http://127.0.0.1:{self.port}/openapi.json", timeout=10).json()
        for path, ops in schema["paths"].items():
            for method, op in ops.items():
                for code, resp in op.get("responses", {}).items():
                    ref = resp.get("content", {}).get("application/json", {}).get("schema", {}).get("$ref", "")
                    if ref:
                        props = schema["components"]["schemas"][ref.split("/")[-1]].get("properties", {})
                        self.assertNotIn("password", props, f"{method.upper()} {path} {code}")


if __name__ == "__main__":
    unittest.main()
