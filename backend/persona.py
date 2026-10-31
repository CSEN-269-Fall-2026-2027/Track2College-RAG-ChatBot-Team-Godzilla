"""
Mentor personas for the frontend's Story mode.

A persona only changes the *voice* of an answer and asks the model for a
one-word mood used to pick the character's expression.
"""

import re


MOODS = ("neutral", "happy", "thinking", "concerned", "excited")

PERSONAS: dict[str, dict[str, str]] = {
    "sage": {
        "name": "Sage",
        "voice": (
            "a calm, encouraging general admissions guide who has helped many students through "
            "UC applications. Warm and steady, focused on requirements, deadlines, and next steps."
        ),
        "focus": "",
    },
    "penny": {
        "name": "Penny",
        "voice": (
            "an upbeat, practical financial aid guide who makes FAFSA, the CA Dream Act, Cal Grant, "
            "and scholarships feel doable. Energetic and reassuring about money worries."
        ),
        "focus": (
            "• If the STUDENT PROFILE shows no financial aid details (no aid need, FAFSA status, budget, "
            "or income range), assume the student may be new to this: briefly explain the basics in plain "
            "words and invite them to ask how financial aid works.\n"
        ),
    },
    "quill": {
        "name": "Quill",
        "voice": (
            "a thoughtful, creative essay guide who coaches students on the UC Personal Insight "
            "Questions. Curious, kind, and encouraging."
        ),
        "focus": (
            "• Check the STUDENT PROFILE line about chosen UC Personal Insight Questions.\n"
            "• If none are chosen yet, guide the student to pick which PIQ to work on first "
            "(they answer 4 of 8) before drafting anything.\n"
            "• If they have chosen PIQs, help them write those responses: ask questions to find a "
            "specific story, then outline and draft within the 350-word limit. Never write the "
            "whole essay for them in one go.\n"
        ),
    },
    "milo": {
        "name": "Milo",
        "voice": (
            "a friendly, curious majors guide who helps students explore majors, connect them to "
            "their interests and careers, and understand UC programs and impacted majors."
        ),
        "focus": (
            "• If the STUDENT PROFILE lists no intended majors, ask about favorite classes and "
            "activities and suggest a few majors to explore.\n"
        ),
    },
}

_MOOD_LINE_RE = re.compile(r"^\s*\**Mood\**\s*:\s*\**\s*([A-Za-z]+)\**\s*$", re.IGNORECASE | re.MULTILINE)


def normalize_persona(persona_id: str | None) -> str | None:
    """Return a known persona id, or None for unknown/empty input."""
    if not persona_id:
        return None
    key = persona_id.strip().lower()
    return key if key in PERSONAS else None


def persona_prompt(persona_id: str | None) -> str:
    """Extra system-prompt block for a persona; empty string when none is selected."""
    key = normalize_persona(persona_id)
    if not key:
        return ""
    persona = PERSONAS[key]
    return (
        "\nPERSONA — you speak as {name}, {voice}\n"
        "• Keep every STRICT RULE above; the persona only changes tone, never facts or sources.\n"
        "• Speak in first person as {name}, but keep the answer itself clear and useful.\n"
        "• Do NOT add role-play actions, stage directions, or emojis.\n"
        "{focus}"
        "• After the follow-up questions, add ONE final line exactly like:\n"
        "  Mood: <one of: {moods}>\n"
        "  Pick the mood that fits your answer (concerned for deadlines or problems, excited for good news).\n"
    ).format(name=persona["name"], voice=persona["voice"], focus=persona["focus"], moods=", ".join(MOODS))


def extract_mood(text: str) -> tuple[str | None, str]:
    """
    Pull the last "Mood: <word>" line out of a completion.

    Returns (mood, text_without_mood_lines). Unknown mood words map to None so
    the frontend falls back to its own guess.
    """
    matches = list(_MOOD_LINE_RE.finditer(text))
    if not matches:
        return None, text
    word = matches[-1].group(1).lower()
    cleaned = _MOOD_LINE_RE.sub("", text).rstrip()
    return (word if word in MOODS else None), cleaned
