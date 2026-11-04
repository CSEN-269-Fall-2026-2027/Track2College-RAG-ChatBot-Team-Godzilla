"""
The UC run's create → sign in → shut down order, driven in a real headless browser against a small
stand-in for UC's login page, using the ids from UC's real page (no network; nothing reaches UC).
"""

import threading
import time
import unittest
from contextlib import redirect_stdout
from io import StringIO
from unittest.mock import patch

from playwright.sync_api import sync_playwright

import uc_account

EMAIL, PASSWORD = "maya@example.com", "Tq7#mVx2!pLr9Kd4"

# A refused sign-up reloads at /creatAccount with the message in the (still closed) form, like UC.
FAKE_UC = """<!doctype html><title>UC</title>
<button onclick="show('up')">Create an account</button>
<button onclick="show('in')">Sign in</button>
<form id="signUpForm" onsubmit="return false"><div id="up" hidden>
  <input id="signUpEmail"><input id="verifyEmail"><input id="signUpPassword" type="password">
  <p id="signUpEmail-error" class="required"></p><p id="termsOfUse-error" class="required"></p>
  <label for="termsOfUse"><input id="termsOfUse" type="checkbox"> By checking this box</label>
  <button id="signUpButton">Create account</button>
</div></form>
<form id="loginForm" onsubmit="return false"><div id="in" hidden>
  <input id="email"><input id="password" type="password"><button id="signIn">Go</button>
  <p id="password-error" class="required"></p>
</div></form>
<script>
  const CREATE_ERROR = __CREATE_ERROR__, LOGIN_OK = __LOGIN_OK__;
  const show = (id) => { document.getElementById('up').hidden = id !== 'up'; document.getElementById('in').hidden = id !== 'in'; };
  if (location.search.includes('refused')) document.getElementById('signUpEmail-error').textContent = CREATE_ERROR;
  document.getElementById('signUpButton').onclick = () => {
    if (!document.getElementById('termsOfUse').checked) {
      document.getElementById('termsOfUse-error').textContent = 'You must read and agree to our Terms of Use';
    } else {
      location.href = CREATE_ERROR ? '/my-application/creatAccount?refused' : '/my-application/verify';
    }
  };
  document.getElementById('signIn').onclick = () => {
    if (LOGIN_OK) location.href = '__AFTER_LOGIN__';
    else document.getElementById('password-error').textContent = 'Invalid email or password';
  };
</script>"""

# UC's page title; the box's name deliberately says nothing about codes, and Resend comes first.
CODE_PAGE = """<!doctype html><title>Verify Account - UC Application</title>
<input id="token"><p id="token-error" class="required"></p>
<button onclick="window.location.href='/my-application/verify?resent'">Resend verification code</button>
<button onclick="if (document.getElementById('token').value === '123456') location.href='/my-application/home';
  else document.getElementById('token-error').textContent = 'That code is incorrect';">Verify account</button>"""
APP_PAGE = "<!doctype html><title>UC</title><p>Your application</p>"


class _StopWhenInside:
    """Stands in for filling the application: being inside is the end of what these tests check."""

    state = "todo"

    def __init__(self, run_id, page, facts, done=False):
        self.run_id = run_id

    def step(self):
        with uc_account._lock:
            uc_account._runs[self.run_id]["cancelled"] = True


class CreateThenSignInTest(unittest.TestCase):
    def _drive(self, mode, create_error, login_ok, stop_after=None, after_login="/my-application/home", codes=()):
        run_id = "run-" + mode
        with uc_account._lock:
            uc_account._runs.clear()
            uc_account._active = None
            uc_account._runs[run_id] = {
                "owner": "s", "status": "opening", "detail": "", "mode": mode, "browser": "local", "live_url": None,
                "open": True, "cancelled": False, "finished": False, "page_url": "", "created": False, "verified": False,
                "setup": False, "about": False, "piq": False, "code": None,
            }
        html = FAKE_UC.replace("__CREATE_ERROR__", repr(create_error)).replace("__LOGIN_OK__", "true" if login_ok else "false").replace("__AFTER_LOGIN__", after_login)
        self.visited = []
        self.code_replies = []

        def type_codes():
            # Like the student in the popup: wait to be asked, then enter each code in turn.
            for code in codes:
                while uc_account._runs[run_id]["status"] != "needs_code":
                    time.sleep(0.05)
                uc_account.submit_code(run_id, "s", code)
                while uc_account._runs[run_id]["status"] == "checking_code":
                    time.sleep(0.05)
                self.code_replies.append(uc_account._runs[run_id]["detail"])

        if codes:
            threading.Thread(target=type_codes, daemon=True).start()

        def serve(route):
            url = route.request.url
            self.visited.append(url)
            body = CODE_PAGE if "/verify" in url else APP_PAGE if "/home" in url else html
            route.fulfill(status=200, content_type="text/html", body=body)

        timer = threading.Timer(stop_after, uc_account.cancel, (run_id, "s")) if stop_after else None
        with sync_playwright() as p, patch.object(uc_account, "SIGN_IN_WAIT_S", 2), patch.object(uc_account, "_AboutYou", _StopWhenInside), redirect_stdout(StringIO()):
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.route("https://apply.universityofcalifornia.edu/**", serve)
            page.goto(uc_account.UC_LOGIN_URL)
            if timer:
                timer.start()
            uc_account._drive(run_id, page, EMAIL, PASSWORD, mode, {}, False, False, [])
            browser.close()
        return uc_account._runs[run_id]

    def test_checks_the_box_and_clicks_create_account(self):
        run = self._drive("create", "", login_ok=True, stop_after=2)
        self.assertEqual(run["status"], "needs_code")
        self.assertTrue(run["created"])

    def test_new_account_enters_the_code_then_goes_inside(self):
        run = self._drive("create", "", login_ok=True, codes=["123456"])
        self.assertEqual(run["status"], "signed_in")
        self.assertTrue(run["verified"])
        self.assertFalse([u for u in self.visited if "resent" in u], "must not press Resend")

    def test_wrong_code_asks_again_then_accepts_the_right_one(self):
        run = self._drive("create", "", login_ok=True, codes=["999999", "123456"])
        self.assertIn("That code is incorrect", self.code_replies[0])
        self.assertEqual(run["status"], "signed_in")

    def test_interrupted_account_signs_in_and_gets_asked_for_the_code(self):
        run = self._drive("login", "", login_ok=True, after_login="/my-application/verify", codes=["123456"])
        self.assertEqual(run["status"], "signed_in")
        self.assertTrue(run["verified"])

    def test_code_is_never_in_what_the_student_or_profile_gets(self):
        self._drive("create", "", login_ok=True, codes=["123456"])
        self.assertIsNone(uc_account._runs["run-create"]["code"])
        self.assertNotIn("code", uc_account.status("run-create", "s"))

    def test_refused_account_falls_back_to_signing_in(self):
        run = self._drive("create", "This email is taken", login_ok=True)
        self.assertEqual(run["status"], "signed_in")
        self.assertTrue(run["created"])

    def test_both_refused_shuts_down_with_nothing_to_save(self):
        run = self._drive("create", "This email is taken", login_ok=False)
        self.assertEqual(run["status"], "login_failed")
        self.assertEqual(run["detail"], "Wrong email or password")
        self.assertFalse(run["created"], "a refused login must not be saved")

    def test_known_login_never_tries_creating_and_says_wrong_password(self):
        run = self._drive("login", "", login_ok=False)
        self.assertEqual(run["status"], "login_failed")
        self.assertEqual(run["detail"], "Wrong email or password")
        self.assertFalse(run["created"])
        self.assertFalse([u for u in self.visited if "creatAccount" in u or "/verify" in u])

    def test_refused_page_is_not_mistaken_for_the_application(self):
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            html = FAKE_UC.replace("__CREATE_ERROR__", "'x'").replace("__LOGIN_OK__", "false").replace("__AFTER_LOGIN__", "/")
            page.route("**/*", lambda route: route.fulfill(status=200, content_type="text/html", body=html))
            page.goto("https://apply.universityofcalifornia.edu/my-application/creatAccount?refused")
            self.assertEqual(uc_account._screen(page), "landing")
            browser.close()

    def test_closing_keeps_the_failure_message(self):
        for browser in ("local", "cloud"):
            with uc_account._lock:
                uc_account._runs["r"] = {"status": "login_failed", "detail": "Nope", "browser": browser, "open": True, "cancelled": False, "finished": False, "code": None}
            uc_account._closed("r")
            self.assertEqual(uc_account._runs["r"]["status"], "login_failed", browser)
            self.assertEqual(uc_account._runs["r"]["detail"], "Nope", browser)


if __name__ == "__main__":
    unittest.main()
