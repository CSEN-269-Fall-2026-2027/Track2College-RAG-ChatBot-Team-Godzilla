"""
UC Personal Insight Question (PIQ) drafts via Groq.

The eight questions and their "Things to consider" guidance are copied verbatim
from UC Admissions (admission.universityofcalifornia.edu → Personal insight
questions). Drafts use only the student's profile, activities list and, for the
personal-life questions, whatever the student typed in. Every response is held
to UC's 350-word limit.
"""

import re
import time
from concurrent.futures import ThreadPoolExecutor

from query import _call_groq, last_failure

WORD_LIMIT = 350
MIN_WORDS = 250

PIQS: dict[str, dict[str, str]] = {
    "leadership": {
        "number": "1",
        "question": (
            "Describe an example of your leadership experience in which you have positively influenced others, "
            "helped resolve disputes or contributed to group efforts over time."
        ),
        "consider": (
            "A leadership role can mean more than just a title. It can mean being a mentor to others, acting as the "
            "person in charge of a specific task, or taking the lead role in organizing an event or project. Think about "
            "what you accomplished and what you learned from the experience. What were your responsibilities? Did you "
            "lead a team? How did your experience change your perspective on leading others? Did you help to resolve an "
            "important dispute at your school, church, in your community or an organization? And your leadership role "
            "doesn't necessarily have to be limited to school activities. For example, do you help out or take care of "
            "your family?"
        ),
    },
    "creativity": {
        "number": "2",
        "question": (
            "Every person has a creative side, and it can be expressed in many ways: problem solving, original and "
            "innovative thinking, and artistically, to name a few. Describe how you express your creative side."
        ),
        "consider": (
            "What does creativity mean to you? Do you have a creative skill that is important to you? What have you been "
            "able to do with that skill? If you used creativity to solve a problem, what was your solution? What are the "
            "steps you took to solve the problem? How does your creativity influence your decisions inside or outside the "
            "classroom? Does your creativity relate to your major or a future career?"
        ),
    },
    "talent": {
        "number": "3",
        "question": (
            "What would you say is your greatest talent or skill? How have you developed and demonstrated that talent over time?"
        ),
        "consider": (
            "If there is a talent or skill that you're proud of, this is the time to share it. You don't necessarily have "
            "to be recognized or have received awards for your talent (although if you did and you want to talk about it, "
            "feel free to do so). Why is this talent or skill meaningful to you? Does the talent come naturally or have you "
            "worked hard to develop this skill or talent? Does your talent or skill allow you opportunities in or outside "
            "the classroom? If so, what are they and how do they fit into your schedule?"
        ),
    },
    "opportunity": {
        "number": "4",
        "question": (
            "Describe how you have taken advantage of a significant educational opportunity or worked to overcome an "
            "educational barrier you have faced."
        ),
        "consider": (
            "An educational opportunity can be anything that has added value to your educational experience and better "
            "prepared you for college. For example, participation in an honors or academic enrichment program, or "
            "enrollment in an academy that's geared toward an occupation or a major, or taking advanced courses that "
            "interest you; just to name a few. If you choose to write about educational barriers you've faced, how did you "
            "overcome or strive to overcome them? What personal characteristics or skills did you call on to overcome this "
            "challenge? How did overcoming this barrier help shape who you are today?"
        ),
    },
    "challenge": {
        "number": "5",
        "question": (
            "Describe the most significant challenge you have faced and the steps you have taken to overcome this "
            "challenge. How has this challenge affected your academic achievement?"
        ),
        "consider": (
            "A challenge could be personal, or something you have faced in your community or school. Why was the challenge "
            "significant to you? This is a good opportunity to talk about any obstacles you've faced and what you've "
            "learned from the experience. Did you have support from someone else or did you handle it alone? If you're "
            "currently working your way through a challenge, what are you doing now, and does that affect different "
            "aspects of your life? For example, ask yourself, How has my life changed at home, at my school, with my "
            "friends or with my family?"
        ),
    },
    "subject": {
        "number": "6",
        "question": (
            "Think about an academic subject that inspires you. Describe how you have furthered this interest inside "
            "and/or outside of the classroom."
        ),
        "consider": (
            "Many students have a passion for one specific academic subject area, something that they just can't get "
            "enough of. If that applies to you, what have you done to further that interest? Discuss how your interest in "
            "the subject developed and describe any experience you have had inside and outside the classroom such as "
            "volunteer work, internships, employment, summer programs, participation in student organizations and/or "
            "clubs and what you have gained from your involvement. Has your interest in the subject influenced you in "
            "choosing a major and/or future career? Have you been able to pursue coursework at a higher level in this "
            "subject (honors, AP, IB, college or university work)? Are you inspired to pursue this subject further at UC, "
            "and how might you do that?"
        ),
    },
    "community": {
        "number": "7",
        "question": "What have you done to make your school or your community a better place?",
        "consider": (
            "Think of community as a term that can encompass a group, team or a place like your high school, hometown or "
            "home. You can define community as you see fit, just make sure you talk about your role in that community. Was "
            "there a problem that you wanted to fix in your community? Why were you inspired to act? What did you learn "
            "from your effort? How did your actions benefit others, the wider community or both? Did you work alone or "
            "with others to initiate change in your community?"
        ),
    },
    "standout": {
        "number": "8",
        "question": (
            "Beyond what has already been shared in your application, what do you believe makes you a strong candidate "
            "for admissions to the University of California?"
        ),
        "consider": (
            "If there's anything you want us to know about you but didn't find a question or place in the application to "
            "tell us, now's your chance. What have you not shared with us that will highlight a skill, talent, challenge "
            "or opportunity that you think will help us know you better? From your point of view, what do you feel makes "
            "you an excellent choice for UC? Don't be afraid to brag a little."
        ),
    },
}

SYSTEM_PROMPT = f"""\
You write first-draft responses to the University of California Personal Insight Questions (PIQs)
for a high school student on the Track2College platform.

RULES:
1. Answer the exact PIQ given. Use the official "Things to consider" only as guidance.
2. Use ONLY facts from the STUDENT ANSWERS, STUDENT ACTIVITIES and STUDENT PROFILE. Never invent people,
   events, awards, numbers, hardships, or outcomes. If a detail is missing, write around it instead of making it up.
   Pick the activities, roles and details that best fit this PIQ; don't list everything.
3. If the student's information is thin, empty, or unrelated to the PIQ, still write a complete response,
   but keep it deliberately general: describe the student's values, habits and goals in broad terms with
   no specific names, events or numbers, so the student can fill in their own details later.
4. Write in the student's own first-person voice: plain, specific, reflective, and honest — like a
   thoughtful 17-year-old, not a brochure. No clichés, no quotes, no title, no headings.
5. Show, then reflect: describe what happened and what the student did, then what they learned or how
   it shaped them. Keep the focus on the student.
6. Length: between {MIN_WORDS} and {WORD_LIMIT} words. UC rejects anything over {WORD_LIMIT} words.
7. Output ONLY the essay text as plain paragraphs. No preface, no notes, no word count.
"""


def word_count(text: str) -> int:
    return len(text.split())


def _clean(text: str) -> str:
    text = re.sub(r"^```\w*\s*|\s*```$", "", text.strip())
    # Drop a leading "Title:"/"Essay:" style label or trailing word-count note if the model adds one.
    text = re.sub(r"^(title|essay|response)\s*:.*\n+", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\n+\(?\s*word count[^\n]*$", "", text, flags=re.IGNORECASE)
    return text.strip()


def _trim_to_limit(text: str, limit: int = WORD_LIMIT) -> str:
    """Last resort: cut at the last full sentence that fits within the limit."""
    if word_count(text) <= limit:
        return text
    words = text.split(" ")
    clipped = " ".join(words[:limit])
    end = max(clipped.rfind(". "), clipped.rfind("! "), clipped.rfind("? "), clipped.rfind(".\n"))
    return clipped[: end + 1].strip() if end > len(clipped) // 2 else clipped.rstrip(",;: ") + "."


BATCH_SIZE = 2
BATCH_PAUSE_S = 1.5


def _ask(user_message: str) -> str:
    return _clean(
        _call_groq(
            [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user_message}],
            # A 350-word essay is ~470 tokens; low reasoning keeps each draft small enough that all
            # four fit in Groq's free-tier 8,000 tokens a minute.
            max_tokens=1500,
            reasoning_effort="low",
        )
    )


def _failure_message() -> str:
    """Says why Groq gave nothing back; a rate limit isn't a key problem."""
    kind = last_failure()
    if kind == "rate_limit":
        return "Groq's per-minute limit is used up (the free tier allows 8,000 tokens a minute). Wait a minute and try again."
    if kind in ("auth", "missing_key"):
        return "Groq rejected the API key. Check GROQ_API_KEY in .env at the project root and restart the backend."
    return "Groq didn't return a draft. Please try again."


def draft_piq(piq_id: str, answers: list[dict], profile_summary: str, activities: str = "", regenerate: bool = False) -> dict:
    piq = PIQS[piq_id]
    details = "\n".join(
        f"Q: {a.get('question', '').strip()}\nA: {a.get('answer', '').strip()}" for a in answers if a.get("answer", "").strip()
    )
    fresh = (
        "\nWrite a FRESH alternative draft — different opening, paragraph structure, and emphasis — "
        "while using only the same facts. Do not reuse sentences from a typical first draft of this story."
        if regenerate
        else ""
    )
    message = (
        f"=== PIQ #{piq['number']} ===\n{piq['question']}\n\n"
        f"=== Things to consider (official UC guidance) ===\n{piq['consider']}\n\n"
        f"=== STUDENT ANSWERS for this PIQ ===\n{details or '(none)'}\n\n"
        f"=== STUDENT ACTIVITIES ===\n{activities.strip() or '(none listed)'}\n\n"
        f"=== STUDENT PROFILE ===\n{profile_summary.strip() or '(empty)'}\n\n"
        f"Write the response now ({MIN_WORDS}–{WORD_LIMIT} words).{fresh}"
    )
    essay = _ask(message)
    if not essay:
        raise RuntimeError(_failure_message())

    # Enforce UC's limit: one rewrite if it's off, then a hard sentence-boundary trim as a backstop.
    count = word_count(essay)
    if count > WORD_LIMIT or count < MIN_WORDS - 50:
        target = "Shorten" if count > WORD_LIMIT else "Expand (using only the facts given)"
        revised = _ask(
            f"{message}\n\n=== Previous draft ({count} words) ===\n{essay}\n\n"
            f"{target} this draft so it is between {MIN_WORDS} and {WORD_LIMIT} words. Keep the same story and voice, "
            "and stay general rather than inventing details."
        )
        if revised:
            essay = revised
    essay = _trim_to_limit(essay)

    return {"id": piq_id, "question": piq["question"], "essay": essay, "word_count": word_count(essay)}


def generate_piqs(items: list[dict], profile_summary: str, activities: str = "", regenerate: bool = False) -> list[dict]:
    """Draft the chosen PIQs two at a time. `items` are {"id", "answers": [{"question", "answer"}]}."""
    unknown = [i["id"] for i in items if i.get("id") not in PIQS]
    if unknown:
        raise ValueError(f"Unknown PIQ id(s): {', '.join(unknown)}")
    # Two at a time with a short pause between pairs, so the drafts don't all hit Groq's
    # per-minute token cap at once. A rate limit that still happens is retried in _call_groq.
    drafts: list[dict] = []
    with ThreadPoolExecutor(max_workers=BATCH_SIZE) as pool:
        for start in range(0, len(items), BATCH_SIZE):
            if start:
                time.sleep(BATCH_PAUSE_S)
            batch = items[start : start + BATCH_SIZE]
            futures = [
                pool.submit(draft_piq, i["id"], i.get("answers") or [], profile_summary, activities, regenerate) for i in batch
            ]
            drafts += [f.result() for f in futures]
    return drafts
