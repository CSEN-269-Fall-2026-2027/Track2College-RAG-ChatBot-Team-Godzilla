"""
Agentic mode: open the official UC application in a real Chrome window on the
student's computer and either sign in with their saved UC credentials or fill in
UC's "Create an account" form.

The window is driven by looking at which UC screen is showing, not by a fixed
script, so signing in always picks up wherever the student left off:

- sign-up form    → filled in, UC's terms box checked and Create account clicked (the student asked
                    for this by pressing Run). If UC refuses the account, the run signs in instead.
- sign-in form    → signed in with the saved email and password. If UC refuses, the run shuts down.
- code screen     → waits for the verification code the student types on Track2College
- setup screen    → "application level" set to First-year, start term set to Fall, then Continue
- anything else   → the student is in their application

Passwords and codes are only held in memory for the run and never logged: the run registers them
with redact, and everything it prints, reports or saves for debugging goes through redact first.

Every run belongs to the student who started it (`owner`, from their verified session). Status,
codes, cancelling and reconnecting only work for that student; to anyone else the run doesn't exist.

Two ways to get the browser (the script after that is the same):
- local → a visible Chrome window on this computer (the backend must run on the student's machine)
- cloud → a Browserbase session attached over CDP; the student uses it through its live view
"""

from __future__ import annotations

import os
import re
import threading
import time
import uuid

import cloud_browser
import redact
import uc_sections

UC_LOGIN_URL = "https://apply.universityofcalifornia.edu/my-application/login"
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
CODE_RE = re.compile(r"^[A-Za-z0-9]{4,10}$")
UC_SPECIALS = "!@#$%^&*+<>?.-"

APP_LEVEL_Q = re.compile(r"application level", re.I)
FIRST_YEAR = re.compile(r"first[\s-]*year", re.I)
START_TERM_Q = re.compile(r"when do you hope to start", re.I)
FALL = re.compile(r"fall", re.I)
WINTER = re.compile(r"winter", re.I)
# Where UC's login page puts its messages, both its own form checks and a refused submit.
SIGN_UP_ERRORS = "#signUpEmail-error, #verifyEmail-error, #signUpPassword-error, #termsOfUse-error"
SIGN_IN_ERRORS = "#email-error, #password-error"
# Not "Resend verification code", which would also match "verif".
SUBMIT_CODE = re.compile(r"^(?!.*(?:resend|send again|new code)).*(?:verif|submit|continue|confirm|next)", re.I)
CONTINUE = re.compile(r"^\s*(continue|next|save and continue|save & continue)\b", re.I)

SIGN_IN_WAIT_S = 15
CREATE_WAIT_S = 30
# How often the run looks at the UC page again. Each look is a couple of round trips to the browser.
TICK_MS = 150
PIQ_REQUIRED = 4

_lock = threading.Lock()
_runs: dict[str, dict] = {}
_active: str | None = None


class UcAccountError(Exception):
    pass


def valid_uc_password(password: str) -> bool:
    """UC's rule: 8–30 characters and at least three of lowercase, uppercase, digit, special."""
    if not 8 <= len(password) <= 30:
        return False
    if any(not (c.isascii() and (c.isalnum() or c in UC_SPECIALS)) for c in password):
        return False
    kinds = [
        any(c.islower() for c in password),
        any(c.isupper() for c in password),
        any(c.isdigit() for c in password),
        any(c in UC_SPECIALS for c in password),
    ]
    return sum(kinds) >= 3


def start(
    email: str,
    password: str,
    mode: str,
    facts: dict[str, str] | None = None,
    about_done: bool = False,
    verified: bool = False,
    piqs: list[dict] | None = None,
    browser: str = "local",
    *,
    owner: str,
) -> str:
    """Starts a run in the background and returns its id. One run at a time.

    `facts` is what Track2College knows about the student, used to fill "About you".
    `piqs` are the student's four chosen questions: {"number": 1–8, "title", "text"}.
    `browser` is "local" (a window on this computer) or "cloud" (Browserbase).
    `owner` is the signed-in student's id; only they can see or control the run.
    """
    global _active
    if not owner:
        raise UcAccountError("Sign in to use the UC assistant.")
    if mode not in ("login", "create"):
        raise UcAccountError("Unknown mode.")
    if browser not in ("local", "cloud"):
        raise UcAccountError("Unknown browser mode.")
    if browser == "cloud" and not cloud_browser.configured():
        raise UcAccountError("Cloud mode isn't set up on this server yet. Switch to Local to use a window on this computer.")
    if not EMAIL_RE.match(email):
        raise UcAccountError("That email address doesn't look right.")
    if not valid_uc_password(password):
        raise UcAccountError("The password doesn't meet UC's rules.")
    with _lock:
        if _active and _runs[_active]["open"]:
            if _runs[_active]["owner"] == owner:
                raise UcAccountError("A UC window is already open. Finish or close it first.")
            raise UcAccountError("The UC assistant is helping another student right now. Try again in a few minutes.")
        run_id = str(uuid.uuid4())
        _runs[run_id] = {
            "owner": owner,
            "status": "opening",
            "detail": "Starting cloud browser…" if browser == "cloud" else "Opening the UC application…",
            "mode": mode,
            "browser": browser,
            # Cloud only: Browserbase's live view, where the student sees and uses the window.
            "live_url": None,
            "open": True,
            "cancelled": False,
            # The assistant filled every field it can this run; the student reviews and submits.
            "finished": False,
            # The page the UC window is on, for the cloud browser panel's address bar.
            "page_url": "",
            # Milestones the frontend saves to the student's profile.
            "created": False,
            "verified": verified,
            "setup": False,
            "about": about_done,
            # What "About you" filling did: filled fields, fields left for the student, things to double-check.
            "about_report": {"filled": [], "missing": [], "check": []},
            # Personal insight: titles entered on UC this run, and ones left alone (with why).
            "piq_report": {"entered": [], "skipped": [], "removed": []},
            "piq": False,
            "code": None,
        }
        _active = run_id
    threading.Thread(
        target=_run, args=(run_id, email, password, mode, facts or {}, about_done, verified, piqs or [], browser), daemon=True
    ).start()
    return run_id


def active(owner: str) -> tuple[str, dict] | None:
    """This student's run whose UC window is open right now, if any (so a reopened popup can reconnect)."""
    with _lock:
        run_id = _active
    if not run_id:
        return None
    run = status(run_id, owner)
    return (run_id, run) if run and run["open"] else None


def _owned(run_id: str, owner: str) -> dict | None:
    """The run, only if this student started it (call with _lock held)."""
    run = _runs.get(run_id)
    return run if run and owner and run["owner"] == owner else None


def status(run_id: str, owner: str) -> dict | None:
    with _lock:
        run = _owned(run_id, owner)
        if not run:
            return None
        return {k: v for k, v in run.items() if k not in ("code", "session_id", "owner")}


def open_sessions(excluding_owner: str | None = None) -> set[str]:
    """Cloud sessions that open runs are using (other students' when excluding_owner is given)."""
    with _lock:
        return {
            run["session_id"]
            for run in _runs.values()
            if run["open"] and run.get("session_id") and run["owner"] != excluding_owner
        }


def submit_code(run_id: str, owner: str, code: str) -> None:
    """Hands the student's verification code to the open UC window."""
    code = code.strip().replace(" ", "")
    if not CODE_RE.match(code):
        raise UcAccountError("Codes are 4–10 letters or numbers. Check UC's email and try again.")
    with _lock:
        run = _owned(run_id, owner)
        if not run or not run["open"]:
            raise UcAccountError("The UC window isn't open anymore. Continue on UC to get a new code screen.")
        if run["status"] != "needs_code":
            raise UcAccountError("UC isn't asking for a code right now.")
        run.update(code=code, status="checking_code", detail="Entering your code…")


def cancel(run_id: str, owner: str) -> None:
    """Stops a run: the script lets go of the window and, in cloud mode, the session is released."""
    with _lock:
        run = _owned(run_id, owner)
        if not run:
            raise UcAccountError("That UC window session wasn't found.")
        if run["open"]:
            run.update(cancelled=True, detail="Stopping…")


def _cancelled(run_id: str) -> bool:
    with _lock:
        return _runs[run_id]["cancelled"]


def _set(run_id: str, status_: str, detail: str, **flags: bool) -> None:
    with _lock:
        _runs[run_id].update(status=status_, detail=redact.redact(detail), **flags)


def _take_code(run_id: str) -> str | None:
    with _lock:
        code, _runs[run_id]["code"] = _runs[run_id]["code"], None
        return code


def _current(run_id: str, field: str):
    """A value from the run itself, for the run's own thread (students go through status())."""
    with _lock:
        return _runs[run_id][field]


def _closed(run_id: str) -> None:
    """The window is gone; keep a finished outcome, otherwise report the close."""
    with _lock:
        run = _runs[run_id]
        run.update(open=False, code=None)
        if run["cancelled"]:
            run.update(status="closed", detail="Stopped. Continue on UC any time to pick up where you left off.")
        elif run["browser"] == "cloud" and run["status"] not in ("error", "login_failed") and not run["finished"]:
            # Nobody closes a cloud window by hand: the session dropped or hit its time limit.
            run.update(
                status="disconnected",
                detail="The cloud browser disconnected (sessions end after 15 minutes). Retry to pick up where you left off.",
            )
        elif run["status"] not in ("signed_in", "ready", "about_done", "piq_done", "error", "login_failed"):
            run.update(status="closed", detail="The UC window was closed. Continue on UC to pick up where you left off.")


def _run(
    run_id: str,
    email: str,
    password: str,
    mode: str,
    facts: dict[str, str],
    about_done: bool,
    verified: bool,
    piqs: list[dict],
    browser_mode: str = "local",
) -> None:
    try:
        from playwright.sync_api import Error as PlaywrightError, sync_playwright
    except ImportError:
        _set(run_id, "error", "Browser automation isn't installed. Run: pip install playwright && python -m playwright install chromium")
        _closed(run_id)
        return

    session_id: str | None = None
    redact.remember(password)
    try:
        with sync_playwright() as p:
            if browser_mode == "cloud":
                try:
                    session_id, connect_url = cloud_browser.create_session()
                    redact.remember(connect_url)
                    with _lock:
                        _runs[run_id]["session_id"] = session_id
                    browser = p.chromium.connect_over_cdp(connect_url, timeout=60_000)
                except Exception as exc:  # noqa: BLE001 — any startup failure gets the same clear message
                    print(redact.redact(f"[uc_account] cloud browser didn't start: {exc}"))
                    _set(run_id, "error", "The cloud browser couldn't start. Retry, or switch to Local.")
                    return
                context = browser.contexts[0] if browser.contexts else browser.new_context()
                page = context.pages[0] if context.pages else context.new_page()
                with _lock:
                    _runs[run_id]["live_url"] = cloud_browser.live_url(session_id)
                _set(run_id, "opening", "Opening the UC application…")
            else:
                browser = p.chromium.launch(headless=False)
                page = browser.new_page(viewport=None)
            page.goto(UC_LOGIN_URL, wait_until="domcontentloaded", timeout=60_000)
            with _lock:
                _runs[run_id]["page_url"] = page.url
            page.bring_to_front()
            try:
                _drive(run_id, page, email, password, mode, facts, about_done, verified, piqs)
            except PlaywrightError:
                # The student closing the window mid-run is expected; anything else isn't.
                if not page.is_closed():
                    raise
            finally:
                if browser.is_connected():
                    browser.close()
    except Exception as exc:  # noqa: BLE001 — report anything to the student instead of crashing the thread
        print(redact.redact(f"[uc_account] {type(exc).__name__}: {exc}"))
        if browser_mode == "cloud":
            _set(run_id, "error", "Something went wrong in the cloud browser. Try again, or switch to Local.")
        else:
            _set(run_id, "error", "Something went wrong driving the UC site. Close the window and try again.")
    finally:
        if session_id:
            cloud_browser.release(session_id)
        _closed(run_id)
        redact.forget_all()


def _drive(
    run_id: str,
    page,
    email: str,
    password: str,
    mode: str,
    facts: dict[str, str],
    about_done: bool,
    verified: bool,
    piqs: list[dict] | None = None,
) -> None:
    """Reacts to whichever UC screen is showing until the student closes the window, or until UC
    has refused both creating the account and signing in."""
    may_sign_in = mode == "login"
    about = _AboutYou(run_id, page, {**facts, "email": email}, done=about_done)
    insight = _PersonalInsight(run_id, page, piqs or [])
    signed_in_at: float | None = None
    setup_done = False
    create_error = ""  # Why UC refused the new account, if it did.
    create_clicked_at = 0.0

    def sign_in_instead(reason: str) -> None:
        nonlocal create_error, may_sign_in
        create_error, may_sign_in = reason, True
        _set(run_id, "signing_in", "UC couldn't create that account, so we're trying to sign in instead…")
        page.goto(UC_LOGIN_URL, wait_until="domcontentloaded", timeout=60_000)

    if mode == "create":
        try:
            _fill_sign_up(page, email, password)
            page.click("#signUpButton", timeout=10_000)
            create_clicked_at = time.monotonic()
            _set(run_id, "creating", "Creating your UC account…")
        except Exception:  # noqa: BLE001 — no usable sign-up form: try signing in
            if page.is_closed():
                raise
            sign_in_instead("the sign-up form didn't work")

    while not page.is_closed() and not _cancelled(run_id):
        page.wait_for_timeout(TICK_MS)
        with _lock:
            _runs[run_id]["page_url"] = page.url
        # A verified account never sees UC's code screen again, so a "ZIP code" box isn't one.
        verified = verified or _current(run_id, "verified")
        screen = _screen(page, look_for_code=not verified)
        current = _current(run_id, "status")

        if current == "creating":
            error = _form_error(page, SIGN_UP_ERRORS)
            if not error and screen == "sign_up" and time.monotonic() - create_clicked_at > CREATE_WAIT_S:
                error = "UC didn't answer"
            if error:
                sign_in_instead(error)
                continue

        if screen == "code":
            code = _take_code(run_id)
            if code:
                _enter_code(run_id, page, code)
                may_sign_in = True  # UC may send a newly verified student back to sign in
            elif current != "needs_code":
                # Also after a code that came back to this screen: the student needs to try again.
                _set(run_id, "needs_code", "UC emailed you a verification code. Type it in here.", created=True)

        elif screen == "setup":
            if not setup_done:
                setup_done = True
                _set(run_id, "setting_up", "Setting up your application…", created=True, verified=True)
                picked, complete = _fill_setup(page)
                if not complete:
                    # Don't move on with a question left blank; the student finishes it.
                    _set(run_id, "ready", f"{picked} Then click Continue in the UC window.", setup=True)
                elif _continue(page):
                    _set(run_id, "ready", f"{picked} Continued to your application.", setup=True)
                else:
                    error = _visible_error(page)
                    _set(run_id, "ready", f"{picked} UC didn't move on{': ' + error if error else ''}. Check the page and click Continue.", setup=True)

        elif screen in ("sign_in", "landing"):
            if current == "creating":
                # The sign-up form closed with no complaint. Signing in proves UC took it.
                _set(run_id, "submitted", "UC accepted the form. Signing you in…")
                may_sign_in = True
            elif may_sign_in:
                may_sign_in = False
                signed_in_at = time.monotonic()
                _sign_in(page, email, password)
                _set(run_id, "signing_in", "Signing you in…")
            elif signed_in_at and current == "signing_in":
                error = _form_error(page, SIGN_IN_ERRORS)
                if error or time.monotonic() - signed_in_at > SIGN_IN_WAIT_S:
                    # The student gets the short version; UC's own words stay in the backend console.
                    uc_sections.log(f"sign-in refused: {error or 'no message'}; sign-up: {create_error or 'not tried'}")
                    _set(run_id, "login_failed", "Wrong email or password")
                    return

        elif screen == "inside":
            if current not in ("ready", "signed_in", "filling", "needs_you", "about_done", "piq_done"):
                # Signing in at all means the account exists and is verified.
                _set(run_id, "signed_in", "You're in your UC application.", created=True, verified=True)
            # For now: Personal information, then straight to Personal insight (other sections later).
            if about.state != "done":
                about.step()
            else:
                insight.step()
                if insight.state == "done" and not _current(run_id, "finished"):
                    with _lock:
                        _runs[run_id]["finished"] = True
                    if not piqs:
                        _set(run_id, "piq_done", "Filled in everything we have. Review it on UC and submit when you're ready.")


# Classify the page and mark code inputs together, avoiding separate sidebar/input checks over CDP.
_SCREEN_JS = """(lookForCode) => {
  const shown = sel => { const e = document.querySelector(sel); if (!e) return false;
    const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const inApp = !!document.querySelector('#section01 ul a[href]');
  const code = lookForCode && !inApp ? (__MARK_CODE__)() : 0;
  return { code, setup: /application level/i.test(document.body ? document.body.innerText : ''),
           signUp: shown('#signUpEmail'), signIn: shown('#email'),
           loginPage: !inApp && !!document.querySelector('#loginForm, #signUpForm') };
}"""


def _screen(page, look_for_code: bool = True) -> str:
    try:
        seen = page.evaluate(_SCREEN_JS.replace("__MARK_CODE__", _MARK_CODE_JS), look_for_code)
    except Exception:  # noqa: BLE001 — page navigating; look again next tick
        return "loading"
    if seen["code"]:
        return "code"
    if seen["setup"]:
        return "setup"
    if seen["signUp"]:
        return "sign_up"
    if seen["signIn"]:
        return "sign_in"
    # A refused sign-up comes back at /creatAccount: still UC's login page, not the application.
    if "/login" in page.url or seen["loginPage"]:
        return "landing"
    return "inside"


def _visible(locator) -> bool:
    try:
        return locator.count() > 0 and locator.first.is_visible()
    except Exception:  # noqa: BLE001 — page changed while checking
        return False


def _fill_sign_up(page, email: str, password: str) -> None:
    page.get_by_role("button", name="Create an account").first.click()
    page.wait_for_selector("#signUpEmail", state="visible", timeout=15_000)
    page.fill("#signUpEmail", email)
    page.fill("#verifyEmail", email)
    page.fill("#signUpPassword", password)
    # Clicked on the box itself: the label around it also holds a link that opens the terms in a new tab.
    terms = page.locator("#termsOfUse")
    terms.evaluate("box => { if (!box.checked) box.click(); }")
    if not terms.is_checked():
        raise UcAccountError("UC's terms box didn't check.")


def _sign_in(page, email: str, password: str) -> None:
    if not _visible(page.locator("#email")):
        page.get_by_role("button", name="Sign in").first.click()
        page.wait_for_selector("#email", state="visible", timeout=15_000)
    page.fill("#email", email)
    page.fill("#password", password)
    page.click("#signIn")


# Marks visible inputs that look like a verification code (one box, or one box per digit).
_MARK_CODE_JS = """() => {
  document.querySelectorAll('[data-t2c-code]').forEach(e => e.removeAttribute('data-t2c-code'));
  const shown = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  // UC's page is titled "Verify Account": any plain box on it is the code, whatever it's named.
  const verifyPage = /verif/i.test(document.title);
  let n = 0;
  for (const e of document.querySelectorAll('input')) {
    if (!['text', 'tel', 'number', ''].includes(e.type) || !shown(e)) continue;
    const words = [e.id, e.name, e.placeholder, e.getAttribute('aria-label') || '', e.autocomplete,
      ...[...(e.labels || [])].map(l => l.innerText)].join(' ');
    // Sign-up has a "verifyEmail" box, so anything about email or passwords is never the code.
    if ((verifyPage || /verif|code|one-time/i.test(words)) && !/e-?mail|password/i.test(words)) { e.setAttribute('data-t2c-code', String(n++)); }
  }
  return n;
}"""


def _mark_code_inputs(page) -> int:
    try:
        return page.evaluate(_MARK_CODE_JS)
    except Exception:  # noqa: BLE001 — page navigating
        return 0


def _enter_code(run_id: str, page, code: str) -> None:
    boxes = page.locator("[data-t2c-code]")
    count = boxes.count()
    if count > 1 and count == len(code):
        for i, ch in enumerate(code):
            boxes.nth(i).fill(ch)
    else:
        boxes.first.fill(code)

    form = boxes.first.locator("xpath=ancestor::form[1]")
    scope = form if form.count() else page
    button = scope.get_by_role("button", name=SUBMIT_CODE)
    if _visible(button):
        button.first.click()
    else:
        boxes.last.press("Enter")

    # A transient navigation error isn't proof that UC accepted the code.
    deadline = time.monotonic() + 6
    screen, error = "loading", ""
    while time.monotonic() < deadline:
        page.wait_for_timeout(250)
        screen = _screen(page)
        error = (_visible_error(page) or _form_error(page, '[id$="-error"]')) if screen == "code" else ""
        if screen not in ("code", "loading") or error:
            break
    if screen == "loading":
        _set(run_id, "checking_code", "UC is still loading after your code. Waiting for the next screen…")
    elif screen == "code":
        _set(run_id, "needs_code", f"UC didn't accept that code{': ' + error if error else ''}. Check the email and try again.")
    else:
        _set(run_id, "verified", "Code accepted. Your UC account is verified.", created=True, verified=True)


def _fill_setup(page) -> tuple[str, bool]:
    """Application level → First-year; start term → Fall (Winter if UC offers no fall term).

    Returns a summary for the student and whether both questions were answered.
    """
    level = _choose(page, APP_LEVEL_Q, [FIRST_YEAR])
    term = _choose(page, START_TERM_Q, [FALL, WINTER])
    picked = [f"application level: {level}" if level else "", f"start: {term}" if term else ""]
    missed = [name for name, value in (("application level", level), ("start term", term)) if not value]
    summary = "Set " + " and ".join(p for p in picked if p) + "." if level or term else ""
    if missed:
        summary += f" Couldn't find the {' or '.join(missed)} choice; pick it yourself."
    return summary.strip(), not missed


def _continue(page) -> bool:
    """Clicks the setup page's Continue button; True once the setup questions are gone."""
    button = page.get_by_role("button", name=CONTINUE)
    if not _visible(button):
        return False
    button.first.click()
    for _ in range(10):
        page.wait_for_timeout(500)
        if not _visible(page.get_by_text(APP_LEVEL_Q)):
            return True
    return False


def _choose(page, question: re.Pattern, answers: list[re.Pattern]) -> str:
    """Picks the first answer that the question offers, whether it's a dropdown, radio buttons, or a custom list."""
    # A native <select> labelled by the question.
    field = page.get_by_label(question)
    if _visible(field):
        el = field.first
        if el.evaluate("e => e.tagName") == "SELECT":
            labels = el.evaluate("e => [...e.options].map(o => o.label.trim())")
            for answer in answers:
                match = next((label for label in labels if answer.search(label)), None)
                if match:
                    el.select_option(label=match)
                    return match

    # Radio buttons near the question.
    group = page.locator("fieldset, [role=radiogroup], .form-group").filter(has_text=question)
    scope = group.first if _visible(group) else page
    for answer in answers:
        radio = scope.get_by_role("radio", name=answer)
        if _visible(radio):
            radio.first.check()
            return radio.first.evaluate("e => (e.labels && e.labels[0] ? e.labels[0].innerText : e.value).trim()")

    # A custom dropdown (combobox) that lists options when opened.
    combo = page.get_by_role("combobox", name=question)
    if _visible(combo):
        combo.first.click()
        for answer in answers:
            option = page.get_by_role("option", name=answer)
            if _visible(option):
                text = option.first.inner_text().strip()
                option.first.click()
                return text
        combo.first.press("Escape")
    return ""


# The first visible error message on the page, in one round trip.
_ERROR_JS = """() => {
  for (const e of document.querySelectorAll('[role=alert], .error, .alert-danger, .validation-error, .field-validation-error')) {
    const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
    if (r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none') {
      const t = (e.innerText || '').trim(); if (t) return t.slice(0, 200);
    }
  }
  return '';
}"""


def _form_error(page, selector: str) -> str:
    """UC's message under a sign-up or sign-in field. Read even when hidden: a refused form may reload closed."""
    try:
        return page.evaluate(
            """(selector) => {
              for (const e of document.querySelectorAll(selector)) {
                const text = (e.textContent || '').trim();
                if (text) return text.slice(0, 200);
              }
              return '';
            }""",
            selector,
        )
    except Exception:  # noqa: BLE001 — page navigating
        return ""


def _visible_error(page) -> str:
    try:
        return page.evaluate(_ERROR_JS)
    except Exception:  # noqa: BLE001 — page navigating
        return ""


# The About you subpages we fill today; after these, the run moves on to Personal insight.
ABOUT_YOU_PAGES_NOW = ("Personal information",)


class _AboutYou:
    """Works through UC's "About you" subpages in sidebar order, then stops.

    UC's sidebar lists each subpage's address and completion status (the submenu is hidden,
    so nothing is clicked): we open the next unfinished one, fill what we know, and save.
    """

    def __init__(self, run_id: str, page, facts: dict[str, str], done: bool):
        self.run_id, self.page, self.facts = run_id, page, facts
        # Track2College's saved "done" flag is NOT trusted to skip the section: a wrong flag
        # silently skipped everything. UC's own sidebar statuses decide (see _open_next).
        self.state = "todo"  # todo → filling → done
        self.clicked_about = False  # used the "About you" link because no sidebar was showing
        self.waiting_on: str | None = None  # page fingerprint the student needs to finish
        self.visited: set[str] = set()  # subpage addresses we've opened or filled
        self.last_seen: str | None = None  # for logging changes only

    def step(self) -> None:
        if self.state == "done":
            return
        subs = uc_sections.subpages(self.page, "About you")
        if subs:
            # For now only these About you pages; the rest are skipped until they're built out.
            subs = [s for s in subs if s["name"] in ABOUT_YOU_PAGES_NOW]
        if subs is not None and not subs and self.state == "filling":
            self._finish()
            return
        if not subs:
            # No sidebar on this page (e.g. the page UC shows right after sign-in):
            # click "About you" the way the earlier version did; that page has the sidebar.
            if self.last_seen != self.page.url:
                self.last_seen = self.page.url
                uc_sections.log(f"no About you menu on {self.page.url}; looking for an About you link")
            if not self.clicked_about and uc_sections.click_text(self.page, "About you"):
                self.clicked_about = True
            return

        here = next((s for s in subs if _same_page(self.page.url, s["url"])), None)
        where = here["name"] if here else uc_sections.current_section(self.page) or self.page.url
        if where != self.last_seen:
            self.last_seen = where
            uc_sections.log(f"on {where} (state={self.state})")

        if here is None:
            # UC moved on to the next category after About you's last subpage: finished.
            section = uc_sections.current_section(self.page)
            if self.state == "filling" and section and section != "About you":
                self._finish()
                return
            self._open_next(subs)
            return

        self.state = "filling"
        self.visited.add(here["url"])
        uc_sections.wait_until_settled(self.page)
        fingerprint = uc_sections._fingerprint(self.page)
        if self.waiting_on == fingerprint:
            return  # still the page the student has to finish
        self.waiting_on = None

        if not uc_sections.has_fields(self.page):
            # e.g. About you's own Review page: nothing to fill, move to what's left.
            self._open_next(subs)
            return

        _set(self.run_id, "filling", f"Filling in {here['name']}…")
        result = uc_sections.fill_page(self.page, uc_sections.ABOUT_YOU_RULES, self.facts, uc_sections.ABOUT_YOU_FIXED)
        with _lock:
            report = _runs[self.run_id]["about_report"]
            seen = {f["label"] for f in report["filled"]}
            report["filled"] += [f for f in result["filled"] if f["label"] not in seen]
            report["check"] = list(dict.fromkeys(report["check"] + result["check"]))
            report["missing"] = result["missing"]
        uc_sections.log(f"{here['name']}: filled {[f['label'] for f in result['filled']]}, still needed {result['missing']}")

        if result["missing"]:
            self.waiting_on = uc_sections._fingerprint(self.page)
            _debug_dump(self.page, "about-needs-you")
            uc_sections.show_banner(
                self.page,
                f"Track2College filled what it could on {here['name']}. Please answer the {len(result['missing'])} outlined "
                f"question{'s' if len(result['missing']) != 1 else ''}, then click Save & continue.",
                result["missing"],
            )
            _set(self.run_id, "needs_you", f"{here['name']} needs a few answers we don't have. Fill them in the UC window, then click Save & continue.")
        else:
            uc_sections.show_banner(self.page, "")
            if not uc_sections.save_and_continue(self.page):
                self.waiting_on = uc_sections._fingerprint(self.page)
                error = _visible_error(self.page)
                _debug_dump(self.page, "about-stuck")
                uc_sections.show_banner(self.page, "Track2College: check this page and click Save & continue.")
                _set(self.run_id, "needs_you", f"UC didn't move on{': ' + error if error else ''}. Check the page and click Save & continue.")

    def _open_next(self, subs: list[dict]) -> None:
        """Opens the first About you subpage that isn't complete and that we haven't handled yet."""
        nxt = next((s for s in subs if s["url"] not in self.visited and not uc_sections.is_done(s["status"])), None)
        if nxt is None:
            if self.state == "filling" or all(uc_sections.is_done(s["status"]) for s in subs):
                self._finish()
            return
        self.state = "filling"
        self.visited.add(nxt["url"])
        _set(self.run_id, "filling", f"Opening {nxt['name']}…")
        uc_sections.go_to(self.page, nxt["url"], nxt["name"])

    def _finish(self) -> None:
        self.state = "done"
        with _lock:
            _runs[self.run_id]["about"] = True
            _runs[self.run_id]["about_report"]["missing"] = []
        uc_sections.show_banner(self.page, "")
        uc_sections.log("About you finished")
        _set(self.run_id, "about_done", "Personal information is done. Moving on to Personal insight…")


def _same_page(current: str, target: str) -> bool:
    """Same UC page, ignoring query strings and fragments."""
    strip = lambda u: u.split("#")[0].split("?")[0].rstrip("/").lower()
    return strip(current) == strip(target)


class _PersonalInsight:
    """Personal insight: Introduction → Continue → Personal insight questions, then each of the
    student's four chosen questions in turn (Answer, or Edit if UC already has one → type the saved
    response → Save & continue).

    An answer already on UC is replaced with the student's current essay (even if it's the same), so
    UC always ends up with what Track2College has.
    """

    def __init__(self, run_id: str, page, piqs: list[dict]):
        self.run_id, self.page = run_id, page
        self.pending = sorted(piqs, key=lambda q: q["number"])  # still to enter, in UC's order
        self.chosen = {q["number"] for q in piqs}
        self.removed: set[int] = set()  # questions whose old UC answer we deleted (or tried to)
        self.state = "todo" if piqs else "done"  # todo → intro → questions → done
        self.answering: dict | None = None  # the question whose answer page we opened
        self.last_seen: str | None = None

    def step(self) -> None:
        if self.state == "done":
            return
        subs = uc_sections.subpages(self.page, "Personal insight")
        if not subs:
            # No sidebar (a page still loading, or one outside the application): say so once, then wait.
            if self.last_seen != self.page.url:
                self.last_seen = self.page.url
                uc_sections.log(f"Personal insight: no sidebar on {self.page.url}; waiting")
            return
        intro = next((s for s in subs if s["name"].lower().startswith("introduction")), None)
        questions = next((s for s in subs if s["name"].lower().startswith("personal insight question")), None)
        if questions is None:
            uc_sections.log("Personal insight questions page not found in the sidebar")
            return
        here = next((s["name"] for s in subs if _same_page(self.page.url, s["url"])), None)
        on_answer = uc_sections.on_piq_answer_page(self.page)
        where = "answer page" if on_answer else here or self.page.url
        if where != self.last_seen:
            self.last_seen = where
            uc_sections.log(f"Personal insight: on {where} (state={self.state})")

        if self.state == "todo":
            # Personal insight → Introduction first (its Continue usually leads to the questions).
            self.state = "intro"
            _set(self.run_id, "filling", "Opening Personal insight…")
            uc_sections.go_to(self.page, (intro or questions)["url"], (intro or questions)["name"])
            return

        if self.state == "intro":
            self.state = "questions"
            if intro and here == intro["name"]:
                uc_sections.wait_until_settled(self.page)
                uc_sections.save_and_continue(self.page)
            return

        # Answer page for a question we opened: type the saved response and save.
        if on_answer:
            self._answer()
            return

        # Anywhere else (including if Introduction's Continue went elsewhere): the questions page, for safety.
        if here != questions["name"]:
            uc_sections.go_to(self.page, questions["url"], questions["name"])
            return

        uc_sections.wait_until_settled(self.page, quiet_ms=200)
        # The student switched questions: UC still has an answer to one they no longer chose. UC only
        # takes four, so delete those first. Only with a full set of four chosen, so answers the
        # student is still writing straight on UC are never touched.
        if len(self.chosen) == PIQ_REQUIRED:
            for n in uc_sections.answered_piq_numbers(self.page):
                if n in self.chosen or n in self.removed:
                    continue
                self.removed.add(n)
                _set(self.run_id, "filling", f"Removing your old UC answer to question {n} (you switched questions)…")
                if uc_sections.delete_piq_answer(self.page, n):
                    self._report("removed", f"Question {n} (you switched to a different question)")
                else:
                    self._report("skipped", f"Question {n}: couldn't delete the old answer; delete it on UC so your new one fits")
                return  # the page reloads; carry on next time round
        while self.pending:
            q = self.pending[0]
            if self.answering is q:
                # We opened it, but UC came back without it answered: leave it to the student.
                self._report("skipped", f"{q['title']} (UC didn't save it; please check it)")
                self.pending.pop(0)
                continue
            _set(self.run_id, "filling", f"Opening {q['title']}…")
            if uc_sections.open_piq_answer(self.page, q["number"]):
                self.answering = q
                self._answer()  # the answer page is open: type it now instead of on the next look
            else:
                self._report("skipped", f"{q['title']} (couldn't find its Answer or Edit button)")
                self.pending.pop(0)
            return
        self._finish()

    def _answer(self) -> None:
        q = self.answering
        if q is None or uc_sections.piq_answer_code(self.page) != f"{q['number'] + 1:02d}":
            # An answer page we didn't open (or a different question): go back without touching it.
            uc_sections.log("on an answer page we didn't open; cancelling")
            uc_sections.cancel_piq_answer(self.page)
            return
        replacing = bool(uc_sections.piq_box_text(self.page).strip())
        _set(self.run_id, "filling", f"{'Updating' if replacing else 'Typing'} your answer to {q['title']}…")
        if not uc_sections.replace_piq_answer(self.page, q["text"]):
            self._report("skipped", f"{q['title']} (couldn't enter the answer; please update it yourself)")
            self.pending.remove(q)
            uc_sections.cancel_piq_answer(self.page)
            return
        if uc_sections.save_piq_answer(self.page):
            self._report("entered", f"{q['title']} (updated)" if replacing else q["title"])
            self.pending.remove(q)
        else:
            error = _visible_error(self.page)
            self._report("skipped", f"{q['title']} (UC didn't accept it{': ' + error if error else ''})")
            self.pending.remove(q)
            uc_sections.show_banner(self.page, f"Track2College: UC didn't accept the {q['title']} answer. Check it and click Save & continue.")
            _set(self.run_id, "needs_you", f"UC didn't accept your {q['title']} answer. Check it in the UC window.")

    def _report(self, kind: str, text: str) -> None:
        uc_sections.log(f"PIQ {kind}: {text}")
        with _lock:
            _runs[self.run_id]["piq_report"][kind].append(text)

    def _finish(self) -> None:
        self.state = "done"
        with _lock:
            _runs[self.run_id]["piq"] = True
            entered = len(_runs[self.run_id]["piq_report"]["entered"])
        uc_sections.log("Personal insight finished")
        summary = f"Entered {entered} personal insight answer{'s' if entered != 1 else ''} on UC."
        # Exactly the student's four answered (and nothing else): move on with Continue.
        answered = set(uc_sections.answered_piq_numbers(self.page))
        if len(self.chosen) == PIQ_REQUIRED and answered == self.chosen:
            if uc_sections.continue_from_piq_questions(self.page):
                _set(self.run_id, "piq_done", f"{summary} All four are in, so we clicked Continue.")
            else:
                _set(self.run_id, "piq_done", f"{summary} All four are in. Click Continue at the bottom of the page.")
        else:
            _set(self.run_id, "piq_done", f"{summary} UC shows {len(answered)} of 4 answered; check the page before clicking Continue.")


def _debug_dump(page, name: str) -> None:
    """With UC_DEBUG=1, saves the page's HTML to backend/uc_debug/ so field matching can be tuned.

    The files can contain the student's information, so this is off by default and the folder is git-ignored.
    """
    if os.environ.get("UC_DEBUG") != "1":
        return
    try:
        folder = os.path.join(os.path.dirname(__file__), "uc_debug")
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, f"{time.strftime('%Y%m%d-%H%M%S')}-{name}.html")
        with open(path, "w", encoding="utf-8") as f:
            f.write(redact.redact(page.content()))
        print(f"[uc_account] saved page for debugging: {path}")
    except Exception as exc:  # noqa: BLE001 — debugging aid only
        print(redact.redact(f"[uc_account] couldn't save debug page: {exc}"))
