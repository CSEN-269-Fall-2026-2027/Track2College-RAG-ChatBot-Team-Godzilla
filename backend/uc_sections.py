"""
Fills sections of the UC application from what Track2College knows about the student.

Fields are found by their labels, not by UC's page structure, so a field is only filled
when one of our rules clearly matches its label and we have an exact answer for it.
Everything required that we can't answer is reported back for the student to fill in.
Nothing is guessed: no value, no fill.
"""

from __future__ import annotations

import re
import time

import redact

CATEGORIES = [
    "About you",
    "Campuses & majors",
    "Academic history",
    "Test scores",
    "Activities & awards",
    "Scholarships & support programs",
    "Personal insight",
]

US_STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
    "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts",
    "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana",
    "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico",
    "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}

# Label pattern → fact key, for "About you". Order matters: the first matching rule wins,
# and the exclusions keep e.g. "Parent's first name" from getting the student's name.
NOT_SOMEONE_ELSE = r"^(?!.*(parent|guardian|mother|father|sibling|previous|former|preferred|nick|middle|emergency|counselor|lived|other|alias|maiden))"
ABOUT_YOU_RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(NOT_SOMEONE_ELSE + r".*(legal )?first(\s|/)*(given )?name", re.I), "first_name"),
    (re.compile(NOT_SOMEONE_ELSE + r".*(legal )?(last|family)(\s|/)*name|surname", re.I), "last_name"),
    (re.compile(NOT_SOMEONE_ELSE + r".*e-?mail", re.I), "email"),
    (re.compile(NOT_SOMEONE_ELSE + r"^\W*city\b", re.I), "city"),
    (re.compile(NOT_SOMEONE_ELSE + r"^\W*state\b(?!.*(citizen|residen))", re.I), "state"),
]

# Questions with a fixed answer we always give (label pattern → option to pick), checked
# before the student-fact rules. "Have you ever had a different legal name?" isn't here:
# UC pre-selects "No", and pre-answered fields are left alone.
ABOUT_YOU_FIXED: list[tuple[re.Pattern, str]] = [
    (re.compile(r"do you have a lived name", re.I), "No"),
    (re.compile(r"attended a california public school", re.I), "Yes"),
]

# Fields that only make sense under a particular question: "City" under "Where were you born?"
# is the birth city, never the home city. (question pattern, [(label pattern, fact key)])
CONTEXT_RULES: list[tuple[re.Pattern, list[tuple[re.Pattern, str]]]] = [
    (
        re.compile(r"when were you born|date of birth|birth\s*date", re.I),
        [
            (re.compile(r"^\W*month", re.I), "birth_month"),
            (re.compile(r"^\W*day", re.I), "birth_day"),
            (re.compile(r"^\W*year", re.I), "birth_year"),
        ],
    ),
    (
        re.compile(r"where were you born|place of birth|birth\s*place", re.I),
        [
            (re.compile(r"^\W*country", re.I), "birth_country"),
            (re.compile(r"^\W*state", re.I), "birth_state"),
            (re.compile(r"^\W*city", re.I), "birth_city"),
        ],
    ),
]

MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
COUNTRY_ALIASES = {"usa": "united states", "us": "united states", "u.s.": "united states", "u.s.a.": "united states",
                   "united states of america": "united states", "america": "united states"}


# Every student we serve was born in California when born in the U.S.; UC only shows this
# State box after the birth country is set to United States.
BIRTH_STATE = "California"


def with_birth_parts(facts: dict[str, str]) -> dict[str, str]:
    """Splits a "YYYY-MM-DD" birth_date into the month / day / year UC asks for separately."""
    facts = {**facts, "birth_state": BIRTH_STATE}
    match = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", (facts.get("birth_date") or "").strip())
    if not match:
        return facts
    year, month, day = (int(part) for part in match.groups())
    if not 1 <= month <= 12 or not 1 <= day <= 31:
        return facts
    return {**facts, "birth_year": str(year), "birth_month": MONTHS[month - 1], "birth_day": str(day)}


# Question headings whose fields aren't about the student's own current details.
NOT_THE_STUDENT = re.compile(
    r"born|birth|parent|guardian|mother|father|sibling|school|counselor|emergency|employer|previous|former|"
    r"lived name|different legal name|other name",
    re.I,
)

# Facts we fill but the student should double-check (onboarding asked "what should we call you?").
CHECK_FACTS = {"first_name": "We used the first name from your Track2College profile. Make sure it's your legal first name."}

# Lists every visible field with its label, kind, and whether it's required and still empty.
_SCAN_JS = r"""() => {
  document.querySelectorAll('[data-t2c-field]').forEach(e => e.removeAttribute('data-t2c-field'));
  const shown = e => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const clean = t => (t || '').replace(/\s+/g, ' ').trim();
  const labelOf = e => {
    const parts = [...(e.labels || [])].map(l => l.innerText);
    if (e.getAttribute('aria-label')) parts.push(e.getAttribute('aria-label'));
    const by = e.getAttribute('aria-labelledby');
    if (by) by.split(/\s+/).forEach(id => { const l = document.getElementById(id); if (l) parts.push(l.innerText); });
    if (!parts.length && e.placeholder) parts.push(e.placeholder);
    if (!parts.length) {
      // UC sets some labels above the box without linking them: use the nearest
      // short text in the field's own wrapper (e.g. "Last / Family / Surname *").
      for (let box = e.parentElement, depth = 0; box && depth < 4; box = box.parentElement, depth++) {
        if (box.querySelectorAll('input, select, textarea').length > 1) break;
        const text = clean([...box.childNodes].filter(n => n !== e && !(n.contains && n.contains(e)))
          .map(n => n.innerText || n.textContent || '').join(' '));
        if (text && text.length <= 80) { parts.push(text); break; }
      }
    }
    return clean(parts.join(' '));
  };
  // The question heading a field sits under ("Where were you born?"), so a bare "City" can be told apart.
  const heads = [...document.querySelectorAll('h1, h2, h3, h4, legend')].filter(shown);
  const contextOf = e => {
    let found = '';
    for (const h of heads) if (h.compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING) found = h.innerText;
    return clean(found);
  };
  const out = []; const groups = {};
  let i = 0;
  for (const e of document.querySelectorAll('input, select, textarea')) {
    const type = (e.type || '').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image', 'file', 'password'].includes(type) || !shown(e) || e.disabled) continue;
    e.setAttribute('data-t2c-field', String(i));
    if (type === 'radio') {
      const fs = e.closest('fieldset, [role=radiogroup]');
      const question = clean(fs ? (fs.querySelector('legend') || fs).innerText.split('\n')[0] : e.name);
      const key = e.name || question;
      if (!groups[key]) { groups[key] = { idx: [], kind: 'radio', label: question, context: contextOf(e), options: [],
        required: e.required || /\*/.test(question), empty: true }; out.push(groups[key]); }
      groups[key].idx.push(i); groups[key].options.push(labelOf(e) || e.value);
      if (e.checked) groups[key].empty = false;
    } else {
      const label = labelOf(e);
      const kind = e.tagName === 'SELECT' ? 'select' : type === 'checkbox' ? 'checkbox' : 'text';
      const empty = kind === 'select' ? (e.selectedIndex <= 0 && !e.value) || /^(select|choose|--)/i.test(e.options[e.selectedIndex]?.label || '')
        : kind === 'checkbox' ? !e.checked : !e.value.trim();
      out.push({ idx: [i], kind, label, context: contextOf(e), required: e.required || e.getAttribute('aria-required') === 'true' || /\*/.test(label),
        empty, options: kind === 'select' ? [...e.options].map(o => clean(o.label)) : [] });
    }
    i++;
  }
  return out;
}"""

_SECTION_JS = r"""(names) => {
  const shown = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const norm = t => (t || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const hit = t => names.find(n => norm(t).startsWith(n.toLowerCase()));
  for (const e of document.querySelectorAll('[aria-current]:not([aria-current=false]), .active, .current, .is-active, .selected')) {
    if (shown(e) && hit(e.innerText)) return hit(e.innerText);
  }
  for (const e of document.querySelectorAll('h1, h2')) { if (shown(e) && hit(e.innerText)) return hit(e.innerText); }
  return '';
}"""

# A subpage marked finished. "Incomplete" / "Not completed" / "not started" must NOT count.
DONE_MARK = re.compile(r"(?<![a-z])(?<!not )(complete|completed|done)\b|✓|✔", re.I)
NOT_DONE_MARK = re.compile(r"\b(incomplete|not\s+complete(d)?|not\s+started|in\s+progress|to\s+do|required)\b", re.I)

SAVE_BUTTON = re.compile(r"^\s*(save\s*(&|and)\s*continue|continue|next)\s*$", re.I)


def current_section(page) -> str:
    """Which of UC's seven categories the page is on ('' if none shows)."""
    try:
        return page.evaluate(_SECTION_JS, CATEGORIES)
    except Exception:  # noqa: BLE001 — page navigating
        return ""


def fill_page(
    page, rules: list[tuple[re.Pattern, str]], facts: dict[str, str], fixed: list[tuple[re.Pattern, str]] = ()
) -> dict:
    """Fills what we can on the current page; returns what was filled and what's still needed."""
    filled: list[dict] = []
    check: list[str] = []
    facts = with_birth_parts(facts)
    # UC reveals some boxes only after an answer (birth State after Country = United States),
    # so look again after each pass that filled something.
    for _ in range(3):
        before = len(filled)
        _fill_pass(page, rules, facts, fixed, filled, check)
        if len(filled) == before:
            break
        page.wait_for_timeout(250)

    # Re-scan: whatever is required and still empty is the student's to answer.
    missing = [_short(f["label"]) for f in page.evaluate(_SCAN_JS) if f["required"] and f["empty"] and f["label"]]
    return {"filled": filled, "missing": list(dict.fromkeys(missing)), "check": check}


def _fill_pass(page, rules, facts: dict[str, str], fixed, filled: list[dict], check: list[str]) -> None:
    """One look at the page: fills every empty field we have an answer for."""
    for field in page.evaluate(_SCAN_JS):
        if not field["empty"] or not field["label"]:
            continue
        answer = next((a for pattern, a in fixed if pattern.search(field["label"])), None)
        if answer:
            try:
                shown = _pick_option(page, field, answer)
            except Exception as exc:  # noqa: BLE001 — leave it to the student
                print(f"[uc_sections] couldn't answer {field['label']!r}: {type(exc).__name__}")
                shown = ""
            if shown:
                filled.append({"label": _short(field["label"]), "value": shown})
            continue
        context = field.get("context") or ""
        scoped = next((labels for question, labels in CONTEXT_RULES if question.search(context)), None)
        if scoped is not None:
            key = next((k for pattern, k in scoped if pattern.search(field["label"])), None)
        # A field under someone else's question ("Parent 1", "different legal name") is never the student's own fact.
        elif NOT_THE_STUDENT.search(context):
            continue
        else:
            key = next((k for pattern, k in rules if pattern.search(field["label"])), None)
        value = (facts.get(key) or "").strip() if key else ""
        if not value:
            continue
        try:
            shown = _fill_field(page, field, key, value)
        except Exception as exc:  # noqa: BLE001 — leave this field to the student, keep going
            print(f"[uc_sections] couldn't fill {field['label']!r}: {type(exc).__name__}")
            shown = ""
        if shown:
            filled.append({"label": _short(field["label"]), "value": shown})
            if key in CHECK_FACTS:
                check.append(CHECK_FACTS[key])


def save_and_continue(page) -> bool:
    """Clicks the page's Save & continue button; True if the page changed afterwards."""
    button = page.locator("#save, #save-btn")
    if not (button.count() and button.first.is_visible()):
        button = page.get_by_role("button", name=SAVE_BUTTON)
    if button.count() == 0 or not button.first.is_visible():
        log("no Save & continue button found")
        return False
    before = (page.url, _fingerprint(page))
    button.first.click()
    for _ in range(32):
        page.wait_for_timeout(250)
        if (page.url, _fingerprint(page)) != before:
            return True
    return False


def log(message: str) -> None:
    """One line per decision in the backend console, so a stuck run shows what it saw and did."""
    print(redact.redact(f"[uc] {message}"))


def click_text(page, name: str) -> bool:
    """Clicks a visible link/button/tab whose name starts with `name` (e.g. "About you")."""
    pattern = re.compile(r"^\s*" + re.escape(name), re.I)
    for role in ("link", "button", "tab"):
        for target in page.get_by_role(role, name=pattern).all():
            try:
                if target.is_visible():
                    target.click()
                    log(f"clicked {role} '{name}'")
                    wait_until_settled(page)
                    return True
            except Exception as exc:  # noqa: BLE001 — element went away
                log(f"click on '{name}' failed: {type(exc).__name__}")
    log(f"no visible '{name}' link on {page.url}")
    return False


def _fill_field(page, field: dict, key: str, value: str) -> str:
    """Fills one field; returns the value as shown on the page, or '' if no option matched."""
    el = page.locator(f'[data-t2c-field="{field["idx"][0]}"]')
    if field["kind"] == "text":
        el.fill(value)
        return value
    if field["kind"] == "select":
        option = _match_option(field["options"], key, value)
        if option:
            el.select_option(label=option)
        return option
    if field["kind"] == "radio":
        option = _match_option(field["options"], key, value)
        if option:
            page.locator(f'[data-t2c-field="{field["idx"][field["options"].index(option)]}"]').check()
        return option
    return ""


def _pick_option(page, field: dict, answer: str) -> str:
    """Selects the option whose text is exactly `answer` (radio or dropdown)."""
    option = next((o for o in field["options"] if o.strip().lower() == answer.lower()), "")
    if not option:
        return ""
    if field["kind"] == "radio":
        page.locator(f'[data-t2c-field="{field["idx"][field["options"].index(option)]}"]').check()
    elif field["kind"] == "select":
        page.locator(f'[data-t2c-field="{field["idx"][0]}"]').select_option(label=option)
    else:
        return ""
    return option


def _match_option(options: list[str], key: str, value: str) -> str:
    if key in ("birth_day", "birth_year"):
        # UC lists days as "01", "02", …; compare as numbers.
        return next((o for o in options if o.strip().isdigit() and int(o) == int(value)), "")
    wanted = {value.lower()}
    if key == "birth_country":
        wanted.add(COUNTRY_ALIASES.get(value.strip().lower(), value.strip().lower()))
    if key == "state":
        code = value.strip().upper()
        if code in US_STATES:
            wanted.add(US_STATES[code].lower())
        wanted |= {abbr.lower() for abbr, name in US_STATES.items() if name.lower() == value.lower()}
    return next((o for o in options if o.strip().lower() in wanted), "")


def _fingerprint(page) -> str:
    try:
        return page.evaluate("() => [...document.querySelectorAll('h1,h2,legend,label')].map(e => e.innerText).join('|').slice(0, 2000)")
    except Exception:  # noqa: BLE001 — page navigating
        return ""


def _short(label: str) -> str:
    # UC's help icons add a lone "?" after some questions ("…public school? ?").
    label = re.sub(r"(\?)(\s+\?)+$", r"\1", label.replace("*", "").strip())
    return label.rstrip(":").strip()[:80]


# UC's sidebar (#sideMenuRoot) lists every category and, in a submenu that stays hidden
# until opened, each subpage with its own address and a "section complete/incomplete" status.
SECTION_IDS = {
    "About you": "section01",
    "Campuses & majors": "section02",
    "Academic history": "section03",
    "Test scores": "section04",
    "Activities & awards": "section05",
    "Personal insight": "section06",
    "Scholarships & support programs": "section07",
}

_SUBPAGES_JS = r"""(id) => {
  const li = document.getElementById(id);
  if (!li) return null;
  // ':scope' keeps it to the submenu under this category, not the category link itself.
  return [...li.querySelectorAll(':scope ul a[href]')].filter(a => /^https?:/.test(a.href)).map(a => ({
    name: (a.childNodes[0]?.textContent || a.innerText).replace(/\s+/g, ' ').trim(),
    href: a.getAttribute('href'),
    url: a.href,
    status: a.querySelector('.completion-status')?.getAttribute('aria-label') || '',
  }));
}"""


def subpages(page, section: str) -> list[dict] | None:
    """The category's subpages from UC's sidebar, or None if the sidebar isn't on this page."""
    try:
        return page.evaluate(_SUBPAGES_JS, SECTION_IDS[section])
    except Exception:  # noqa: BLE001 — page navigating
        return None


def is_done(status_text: str) -> bool:
    """UC marks subpages "section complete" / "section incomplete"."""
    return bool(DONE_MARK.search(status_text)) and not NOT_DONE_MARK.search(status_text)


def go_to(page, url: str, name: str) -> None:
    log(f"opening {name} → {url}")
    page.goto(url, wait_until="domcontentloaded", timeout=30_000)


def has_fields(page) -> bool:
    try:
        return bool(page.evaluate(_SCAN_JS))
    except Exception:  # noqa: BLE001 — page navigating
        return False


# Headings and labels plus the field count, in one round trip (each call to a cloud browser costs ~70 ms).
_SETTLE_JS = """() => [...document.querySelectorAll('h1,h2,legend,label')].map(e => e.innerText).join('|').slice(0, 2000)
  + '#' + document.querySelectorAll('input:not([type=hidden]), select, textarea').length"""


def wait_until_settled(page, quiet_ms: int = 400, timeout_ms: int = 8000) -> None:
    """Waits until the page's fields and labels stop changing (UC renders forms after load)."""
    try:
        page.wait_for_load_state("domcontentloaded", timeout=timeout_ms)
    except Exception:  # noqa: BLE001 — keep going on slow loads
        pass
    start = time.monotonic()
    last, stable_at = None, start
    while (time.monotonic() - start) * 1000 < timeout_ms:
        try:
            now = page.evaluate(_SETTLE_JS)
        except Exception:  # noqa: BLE001 — page navigating
            now = None
        t = time.monotonic()
        if now is not None and now == last:
            if (t - stable_at) * 1000 >= quiet_ms:
                return
        else:
            last, stable_at = now, t
        page.wait_for_timeout(150)


# Banner and outlines in the UC window, so "waiting on you" never looks like "stuck".
_MARK_JS = r"""([message, missing]) => {
  document.getElementById('t2c-banner')?.remove();
  document.querySelectorAll('[data-t2c-missing]').forEach(e => { e.style.outline = ''; e.removeAttribute('data-t2c-missing'); });
  if (!message) return;
  const bar = document.createElement('div');
  bar.id = 't2c-banner';
  bar.textContent = message;
  Object.assign(bar.style, { position: 'fixed', top: '0', left: '0', right: '0', zIndex: '2147483647', padding: '12px 20px',
    background: '#0f6b43', color: '#fff', font: '600 15px/1.4 system-ui, sans-serif', textAlign: 'center',
    boxShadow: '0 2px 10px rgba(0,0,0,.2)' });
  document.body.appendChild(bar);
  const wanted = new Set(missing);
  for (const e of document.querySelectorAll('[data-t2c-field]')) {
    const fs = e.closest('fieldset, [role=radiogroup]');
    const labels = [...(e.labels || [])].map(l => l.innerText).join(' ') + ' ' + (e.getAttribute('aria-label') || '') + ' ' +
      (fs ? (fs.querySelector('legend') || fs).innerText.split('\n')[0] : '') + ' ' + (e.parentElement?.innerText || '');
    const text = labels.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
    if ([...wanted].some(w => text.includes(w))) {
      e.setAttribute('data-t2c-missing', '1');
      e.style.outline = '3px solid #f2b51c';
      e.style.outlineOffset = '2px';
    }
  }
}"""


def show_banner(page, message: str, missing: list[str] | None = None) -> None:
    try:
        page.evaluate(_MARK_JS, [message, missing or []])
    except Exception:  # noqa: BLE001 — page navigating; cosmetic only
        pass


# --- Personal insight questions -------------------------------------------------------------
# UC lists the 8 prompts as <ol start="N"> blocks with an "Answer" button (id answer_0{N+1});
# an answered one shows a check mark and "Edit" / "Delete" buttons instead (edit_0{N+1}). Each answer page has an editable box (#answerBox), a
# hidden #answerText that's submitted, #questionCode ("02" for question 1), and #save-btn.


def _piq_box(page, number: int):
    return page.locator(".question-box").filter(has=page.locator(f'ol[start="{number}"]'))


def piq_answered(page, number: int) -> bool:
    box = _piq_box(page, number)
    if not box.count():
        return False
    return box.first.evaluate(
        "b => { const c = b.querySelector('.checked'); const btn = b.querySelector('.answer-btn');"
        " return !!(c && !c.classList.contains('hide') && getComputedStyle(c).display !== 'none')"
        " || !!(btn && !/^\\s*answer\\s*$/i.test(btn.innerText)); }"
    )


def open_piq_answer(page, number: int) -> bool:
    """Clicks question N's Answer button (or Edit, when UC already has an answer); True once the answer page shows."""
    code = f"{number + 1:02d}"
    # One round trip for the usual case. Clicked after this call returns, because it navigates.
    clicked = page.evaluate(
        """(ids) => {
          for (const id of ids) {
            const b = document.getElementById(id);
            if (b && b.getClientRects().length) { setTimeout(() => b.click()); return true; }
          }
          return false;
        }""",
        [f"answer_{code}", f"edit_{code}"],
    )
    if clicked:
        return _piq_answer_opened(page, number)
    box = _piq_box(page, number)
    button = None
    for candidate in (page.locator(f"#answer_{code}"), page.locator(f"#edit_{code}"), box.locator(".answer-btn"), box.locator(".edit-btn")):
        if candidate.count() and candidate.first.is_visible():
            button = candidate
            break
    if button is None:
        log(f"no Answer or Edit button for question {number}")
        return False
    button.first.click()
    return _piq_answer_opened(page, number)


def _piq_answer_opened(page, number: int) -> bool:
    try:
        page.wait_for_selector("#answerBox", state="visible", timeout=10_000)
    except Exception:  # noqa: BLE001
        log(f"question {number}'s answer page didn't open")
        return False
    log(f"opened question {number}")
    return True


_ANSWERED_JS = r"""() => [...document.querySelectorAll('.question-box')].flatMap(b => {
  const ol = b.querySelector('ol[start]'); if (!ol) return [];
  const c = b.querySelector('.checked'); const btn = b.querySelector('.answer-btn');
  const done = !!(c && !c.classList.contains('hide') && getComputedStyle(c).display !== 'none')
    || !!(btn && !/^\s*answer\s*$/i.test(btn.innerText));
  return done ? [Number(ol.getAttribute('start'))] : [];
})"""


def answered_piq_numbers(page) -> list[int]:
    """Which of the 8 questions UC shows as answered on the questions page (one round trip)."""
    try:
        return sorted(n for n in page.evaluate(_ANSWERED_JS) if 1 <= n <= 8)
    except Exception:  # noqa: BLE001 — page navigating
        return []


def delete_piq_answer(page, number: int) -> bool:
    """Deletes UC's saved answer to question N (Delete → UC's "Are you sure?" → Yes); True once it's gone."""
    code = f"{number + 1:02d}"
    button = page.locator(f"#delete_{code}")
    if not (button.count() and button.first.is_visible()):
        button = _piq_box(page, number).locator(".delete-btn")
    if not (button.count() and button.first.is_visible()):
        log(f"no Delete button for question {number}")
        return False
    button.first.click()
    yes = page.locator("#warningYesButton")
    try:
        yes.first.wait_for(state="visible", timeout=5_000)
    except Exception:  # noqa: BLE001
        log(f"UC's delete confirmation didn't show for question {number}")
        return False
    yes.first.click()
    for _ in range(60):  # UC submits the form and reloads the questions page
        page.wait_for_timeout(250)
        try:
            if not on_piq_answer_page(page) and _piq_box(page, number).count() and not piq_answered(page, number):
                log(f"deleted question {number}'s answer")
                return True
        except Exception:  # noqa: BLE001 — page reloading
            continue
    return False


def continue_from_piq_questions(page) -> bool:
    """Clicks Continue at the bottom of the Personal insight questions page; True once UC moves on."""
    button = page.locator("#save-btn")
    if on_piq_answer_page(page) or not (button.count() and button.first.is_visible()):
        log("no Continue button on the questions page")
        return False
    before = page.url
    button.first.click()
    for _ in range(40):
        page.wait_for_timeout(250)
        if page.url != before or not _piq_box(page, 1).count():
            return True
    return False


def on_piq_answer_page(page) -> bool:
    try:
        return page.evaluate("() => { const b = document.getElementById('answerBox'); return !!b && b.getClientRects().length > 0; }")
    except Exception:  # noqa: BLE001
        return False


def piq_answer_code(page) -> str:
    try:
        return (page.locator("#questionCode").first.get_attribute("value") or "").strip()
    except Exception:  # noqa: BLE001
        return ""


def piq_box_text(page) -> str:
    try:
        return page.locator("#answerBox").first.inner_text()
    except Exception:  # noqa: BLE001
        return ""


def clear_piq_answer(page) -> bool:
    """Empties the answer box the way a person would (select all, delete); True once it's empty."""
    box = page.locator("#answerBox").first
    box.click()
    page.keyboard.press("ControlOrMeta+A")
    page.keyboard.press("Backspace")
    if piq_box_text(page).strip():
        # Fallback: empty it directly and tell UC's word counter it changed.
        page.evaluate(
            "() => { const b = document.getElementById('answerBox'); if (!b) return;"
            " b.innerHTML = ''; b.dispatchEvent(new Event('input', { bubbles: true })); }"
        )
    page.evaluate("() => { const f = document.getElementById('answerText'); if (f) f.value = ''; }")
    return not piq_box_text(page).strip()


def type_piq_answer(page, text: str) -> None:
    """Types the answer the way a person would, so UC's word counter and save logic see it."""
    box = page.locator("#answerBox").first
    box.click()
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text.strip()) if p.strip()]
    for i, para in enumerate(paragraphs):
        if i:
            page.keyboard.press("Enter")
            page.keyboard.press("Enter")
        page.keyboard.insert_text(para)
    # UC copies the box into this hidden field when saving; fill it too in case that step is skipped.
    page.evaluate("t => { const f = document.getElementById('answerText'); if (f) f.value = t; }", "\n\n".join(paragraphs))


def replace_piq_answer(page, text: str) -> bool:
    """Puts `text` in the answer box in one trip to the browser, which matters in cloud mode; True if it landed.

    Uses the browser's own editing commands, so the box ends up as if typed. Falls back to real keystrokes.
    """
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", text.strip()) if p.strip()]
    wanted = " ".join(" ".join(paragraphs).split())
    try:
        got = page.evaluate(_REPLACE_ANSWER_JS, paragraphs)
    except Exception:  # noqa: BLE001 — try the slow way
        got = ""
    if " ".join((got or "").split()) == wanted:
        return True
    log("couldn't fill the answer box in one step; typing it instead")
    if piq_box_text(page).strip() and not clear_piq_answer(page):
        return False
    type_piq_answer(page, text)
    return " ".join(piq_box_text(page).split()) == wanted


_REPLACE_ANSWER_JS = """(paragraphs) => {
  const box = document.getElementById('answerBox');
  box.focus();
  document.execCommand('selectAll');
  document.execCommand('delete');
  paragraphs.forEach((text, i) => {
    if (i) { document.execCommand('insertParagraph'); document.execCommand('insertParagraph'); }
    document.execCommand('insertText', false, text);
  });
  // UC refreshes its word counter on keyup (which also rewrites the hidden field, so that goes after).
  box.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  const field = document.getElementById('answerText');
  if (field) field.value = paragraphs.join('\\n\\n');
  return box.innerText;
}"""


def save_piq_answer(page) -> bool:
    """Clicks Save & continue on an answer page; True once UC leaves the answer page."""
    try:
        page.click("#save-btn", timeout=5_000)
        page.wait_for_selector("#answerBox", state="hidden", timeout=10_000)
    except Exception:  # noqa: BLE001 — no button, or UC stayed on the page (e.g. it refused the answer)
        log("UC stayed on the answer page after Save & continue")
        return False
    return True


def cancel_piq_answer(page) -> None:
    button = page.locator("#cancel-btn")
    if button.count() and button.first.is_visible():
        button.first.click()
        for _ in range(24):
            page.wait_for_timeout(250)
            if not on_piq_answer_page(page):
                return
