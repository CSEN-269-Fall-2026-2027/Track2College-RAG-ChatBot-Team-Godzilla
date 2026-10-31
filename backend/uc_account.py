"""
Agentic mode: open the official UC application in a real Chrome window on the
student's computer and either sign in with their saved UC credentials or fill in
UC's "Create an account" form.

The window is driven by looking at which UC screen is showing, not by a fixed
script, so signing in always picks up wherever the student left off:

- sign-up form    → filled in; the student agrees to UC's terms and clicks Create account
- sign-in form    → signed in with the saved email and password
- code screen     → waits for the verification code the student types on Track2College
- setup screen    → "application level" set to First-year, start term set to Fall, then Continue
- anything else   → the student is in their application

Passwords and codes are only held in memory for the run and never logged. This needs
the backend running on the student's own machine (a server has no screen to show).
"""

from __future__ import annotations

import os
import re
import threading
import time
import uuid

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
SUBMIT_CODE = re.compile(r"verif|submit|continue|confirm|next", re.I)
CONTINUE = re.compile(r"^\s*(continue|next|save and continue|save & continue)\b", re.I)

SIGN_IN_WAIT_S = 15

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
) -> str:
    """Starts a run in the background and returns its id. One run at a time.

    `facts` is what Track2College knows about the student, used to fill "About you".
    `piqs` are the student's four chosen questions: {"number": 1–8, "title", "text"}.
    """
    global _active
    if mode not in ("login", "create"):
        raise UcAccountError("Unknown mode.")
    if not EMAIL_RE.match(email):
        raise UcAccountError("That email address doesn't look right.")
    if not valid_uc_password(password):
        raise UcAccountError("The password doesn't meet UC's rules.")
    with _lock:
        if _active and _runs[_active]["open"]:
            raise UcAccountError("A UC window is already open. Finish or close it first.")
        run_id = str(uuid.uuid4())
        _runs[run_id] = {
            "status": "opening",
            "detail": "Opening the UC application…",
            "mode": mode,
            "open": True,
            # Milestones the frontend saves to the student's profile.
            "created": False,
            "verified": verified,
            "setup": False,
            "about": about_done,
            # What "About you" filling did: filled fields, fields left for the student, things to double-check.
            "about_report": {"filled": [], "missing": [], "check": []},
            # Personal insight: titles entered on UC this run, and ones left alone (with why).
            "piq_report": {"entered": [], "skipped": []},
            "piq": False,
            "code": None,
        }
        _active = run_id
    threading.Thread(target=_run, args=(run_id, email, password, mode, facts or {}, about_done, verified, piqs or []), daemon=True).start()
    return run_id


def status(run_id: str) -> dict | None:
    with _lock:
        run = _runs.get(run_id)
        if not run:
            return None
        return {k: v for k, v in run.items() if k != "code"}


def submit_code(run_id: str, code: str) -> None:
    """Hands the student's verification code to the open UC window."""
    code = code.strip().replace(" ", "")
    if not CODE_RE.match(code):
        raise UcAccountError("Codes are 4–10 letters or numbers. Check UC's email and try again.")
    with _lock:
        run = _runs.get(run_id)
        if not run or not run["open"]:
            raise UcAccountError("The UC window isn't open anymore. Continue on UC to get a new code screen.")
        if run["status"] != "needs_code":
            raise UcAccountError("UC isn't asking for a code right now.")
        run.update(code=code, status="checking_code", detail="Entering your code…")


def _set(run_id: str, status_: str, detail: str, **flags: bool) -> None:
    with _lock:
        _runs[run_id].update(status=status_, detail=detail, **flags)


def _take_code(run_id: str) -> str | None:
    with _lock:
        code, _runs[run_id]["code"] = _runs[run_id]["code"], None
        return code


def _closed(run_id: str) -> None:
    """The window is gone; keep a finished outcome, otherwise report the close."""
    with _lock:
        run = _runs[run_id]
        run.update(open=False, code=None)
        if run["status"] not in ("signed_in", "ready", "about_done", "piq_done", "error"):
            run.update(status="closed", detail="The UC window was closed. Continue on UC to pick up where you left off.")


def _run(
    run_id: str, email: str, password: str, mode: str, facts: dict[str, str], about_done: bool, verified: bool, piqs: list[dict]
) -> None:
    try:
        from playwright.sync_api import Error as PlaywrightError, sync_playwright
    except ImportError:
        _set(run_id, "error", "Browser automation isn't installed. Run: pip install playwright && python -m playwright install chromium")
        _closed(run_id)
        return

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=False)
            page = browser.new_page(viewport=None)
            page.goto(UC_LOGIN_URL, wait_until="domcontentloaded", timeout=60_000)
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
        print(f"[uc_account] {type(exc).__name__}: {exc}")
        _set(run_id, "error", "Something went wrong driving the UC site. Close the window and try again.")
    finally:
        _closed(run_id)


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
    """Reacts to whichever UC screen is showing until the student closes the window."""
    may_sign_in = mode == "login"
    about = _AboutYou(run_id, page, {**facts, "email": email}, done=about_done)
    insight = _PersonalInsight(run_id, page, piqs or [])
    signed_in_at: float | None = None
    setup_done = False

    if mode == "create":
        _fill_sign_up(page, email, password)
        _set(run_id, "waiting", "Everything's filled in. Check the Terms of Use box and click Create account in the UC window.")

    while not page.is_closed():
        page.wait_for_timeout(1000)
        # A verified account never sees UC's code screen again, so a "ZIP code" box isn't one.
        verified = verified or status(run_id)["verified"]
        screen = _screen(page, look_for_code=not verified)
        current = status(run_id)["status"]

        if screen == "code":
            code = _take_code(run_id)
            if code:
                _enter_code(run_id, page, code)
                may_sign_in = True  # UC may send a newly verified student back to sign in
            elif current not in ("needs_code", "checking_code"):
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

        elif screen == "sign_up":
            if current == "waiting":
                error = _visible_error(page)
                if error:
                    _set(run_id, "waiting", f"UC says: {error}")

        elif screen in ("sign_in", "landing"):
            if current == "waiting":
                # The sign-up form closed: UC took it and moves on to email verification.
                _set(run_id, "submitted", "UC accepted the form. Watch your email for a verification code.", created=True)
                may_sign_in = True
            elif may_sign_in:
                may_sign_in = False
                signed_in_at = time.monotonic()
                _sign_in(page, email, password)
                _set(run_id, "signing_in", "Signing you in…")
            elif signed_in_at and current == "signing_in" and time.monotonic() - signed_in_at > SIGN_IN_WAIT_S:
                _set(run_id, "login_failed", _visible_error(page) or "UC didn't accept that email and password.")

        elif screen == "inside":
            if current not in ("ready", "signed_in", "filling", "needs_you", "about_done", "piq_done"):
                # Signing in at all means the account exists and is verified.
                _set(run_id, "signed_in", "You're in your UC application.", created=True, verified=True)
            # For now: Personal information, then straight to Personal insight (other sections later).
            if about.state != "done":
                about.step()
            else:
                insight.step()


def _screen(page, look_for_code: bool = True) -> str:
    # Inside the application (UC's sidebar showing), a "ZIP code" box is not a verification code.
    in_app = bool(uc_sections.subpages(page, "About you"))
    if look_for_code and not in_app and _mark_code_inputs(page):
        return "code"
    if _visible(page.get_by_text(APP_LEVEL_Q)):
        return "setup"
    if _visible(page.locator("#signUpEmail")):
        return "sign_up"
    if _visible(page.locator("#email")):
        return "sign_in"
    if "/login" in page.url:
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
    terms = page.locator("#termsOfUse")
    terms.scroll_into_view_if_needed()
    terms.focus()


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
  let n = 0;
  for (const e of document.querySelectorAll('input')) {
    if (!['text', 'tel', 'number', ''].includes(e.type) || !shown(e)) continue;
    const words = [e.id, e.name, e.placeholder, e.getAttribute('aria-label') || '', e.autocomplete,
      ...[...(e.labels || [])].map(l => l.innerText)].join(' ');
    // Sign-up has a "verifyEmail" box, so anything about email or passwords is never the code.
    if (/verif|code|one-time/i.test(words) && !/e-?mail|password/i.test(words)) { e.setAttribute('data-t2c-code', String(n++)); }
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

    page.wait_for_timeout(4000)
    if _mark_code_inputs(page):
        error = _visible_error(page)
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


def _visible_error(page) -> str:
    for selector in ("[role=alert]", ".error", ".alert-danger", ".validation-error", ".field-validation-error"):
        for el in page.locator(selector).all():
            try:
                if el.is_visible():
                    text = el.inner_text().strip()
                    if text:
                        return text[:200]
            except Exception:  # noqa: BLE001 — element went away while reading
                continue
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
    student's four chosen questions in turn (Answer → type the saved response → Save & continue).

    Questions UC already shows as answered are left alone, so running again never overwrites.
    """

    def __init__(self, run_id: str, page, piqs: list[dict]):
        self.run_id, self.page = run_id, page
        self.pending = sorted(piqs, key=lambda q: q["number"])  # still to enter, in UC's order
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

        uc_sections.wait_until_settled(self.page)
        while self.pending:
            q = self.pending[0]
            answered = uc_sections.piq_answered(self.page, q["number"])
            if answered:
                self._report("skipped", f"{q['title']} (already answered on UC)")
                self.pending.pop(0)
                continue
            if self.answering is q:
                # We opened it, but UC came back without it answered: leave it to the student.
                self._report("skipped", f"{q['title']} (UC didn't save it; please check it)")
                self.pending.pop(0)
                continue
            _set(self.run_id, "filling", f"Opening {q['title']}…")
            if uc_sections.open_piq_answer(self.page, q["number"]):
                self.answering = q
            else:
                self._report("skipped", f"{q['title']} (couldn't find its Answer button)")
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
        if uc_sections.piq_box_text(self.page).strip():
            self._report("skipped", f"{q['title']} (already has an answer on UC)")
            self.pending.remove(q)
            uc_sections.cancel_piq_answer(self.page)
            return
        _set(self.run_id, "filling", f"Typing your answer to {q['title']}…")
        uc_sections.type_piq_answer(self.page, q["text"])
        if uc_sections.save_piq_answer(self.page):
            self._report("entered", q["title"])
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
        _set(self.run_id, "piq_done", f"Entered {entered} personal insight answer{'s' if entered != 1 else ''} on UC. Stopping here for now.")


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
            f.write(page.content())
        print(f"[uc_account] saved page for debugging: {path}")
    except Exception as exc:  # noqa: BLE001 — debugging aid only
        print(f"[uc_account] couldn't save debug page: {exc}")
