"""
LLM helpers for Track2College.

Chat, transcripts, PIQs, course plans, and profile analysis all go through Groq's
OpenAI-compatible chat completions API.
"""

from __future__ import annotations

import os
import re
import threading
import time
from collections import deque
from datetime import date
from pathlib import Path

import requests
from dotenv import load_dotenv

from followup_refs import resolve_followup_query as _resolve_followup_query
from persona import extract_mood, mode_prompt, normalize_persona, persona_prompt

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "").strip()
GROQ_MODEL = os.environ.get("GROQ_MODEL", "").strip() or "openai/gpt-oss-120b"
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

if not GROQ_API_KEY:
    print("[warning] GROQ_API_KEY is missing in .env at the project root")

# Advisor questions that need current facts get a web search; everything else skips it
# to save tokens (search results add a lot to the prompt).
_FACT_QUESTION = re.compile(
    r"\b(deadlines?|due|dates?|when|open|close|fees?|cost|tuition|price|waiver|"
    r"requirements?|required|gpa|sat|act|acceptance|admit|rate|scholarships?|"
    r"fafsa|dream act|cal grant|aid|transfer|tag|policy|policies|202\d)\b",
    re.IGNORECASE,
)
# browser_search answers carry citation marks like 【1†L19-L27】.
_CITATION = re.compile(r"【[^】]*】")

# Groq's free tier caps tokens per minute per account (the cap depends on the model), not per key.
# A 429 says how long to wait; we keep waiting until the minute's budget frees up, but
# give up after this much total waiting so a request never hangs for long.
_MAX_RATE_LIMIT_WAIT_S = 75
_RETRY_AFTER_TEXT = re.compile(r"try again in (?:(\d+)m)?([\d.]+)s", re.I)

# Why the last _call_groq on this thread returned "", so callers can say something accurate.
_last_failure = threading.local()


def last_failure() -> str:
    """'rate_limit', 'auth', 'missing_key', 'error', or '' after the latest call on this thread."""
    return getattr(_last_failure, "kind", "")


def _retry_after(response) -> float:
    header = response.headers.get("retry-after")
    if header:
        try:
            return float(header)
        except ValueError:
            pass
    match = _RETRY_AFTER_TEXT.search(response.text)
    return (int(match.group(1) or 0) * 60 + float(match.group(2))) if match else 10.0


def _call_groq(
    messages: list[dict], max_tokens: int = 1000, tools: list[dict] | None = None, reasoning_effort: str | None = None
) -> str:
    """OpenAI-compatible Groq chat completions. Returns assistant text or "" (see last_failure())."""
    _last_failure.kind = ""
    if not GROQ_API_KEY:
        print("[Groq] Missing GROQ_API_KEY")
        _last_failure.kind = "missing_key"
        return ""
    payload = {
        "model": GROQ_MODEL,
        "messages": messages,
        "temperature": 0.4,
        "max_tokens": max_tokens,
    }
    if tools:
        payload["tools"] = tools
    if reasoning_effort:
        # gpt-oss models think before answering; "low" spends far fewer tokens on it.
        payload["reasoning_effort"] = reasoning_effort
    try:
        waited = 0.0
        for attempt in range(1, 100):
            resp = requests.post(
                GROQ_URL,
                headers={
                    "Authorization": f"Bearer {GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=90,
            )
            if resp.status_code != 429:
                break
            wait = _retry_after(resp) + 0.5
            if waited + wait > _MAX_RATE_LIMIT_WAIT_S:
                break
            print(f"[Groq] Rate limited; retrying in {wait:.1f}s (attempt {attempt + 1})")
            time.sleep(wait)
            waited += wait
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        # Groq explains rate limits and oversized requests in the body; the status line alone doesn't say which.
        detail = ""
        response = getattr(exc, "response", None)
        if response is not None:
            try:
                detail = " — " + str(response.json().get("error", {}).get("message", ""))[:300]
            except ValueError:
                detail = " — " + response.text[:300]
        print(f"[Groq] Request error ({GROQ_MODEL}): {exc}{detail}")
        status = getattr(response, "status_code", None)
        _last_failure.kind = "rate_limit" if status == 429 else "auth" if status in (401, 403) else "error"
        return ""

    try:
        return _CITATION.sub("", data["choices"][0]["message"]["content"] or "").strip()
    except Exception:
        print(f"[Groq] Unexpected response: {data}")
        return ""


def complete(system_prompt: str, user_message: str, max_tokens: int = 1000, web_search: bool = False) -> str:
    """Single-turn completion for JSON features (transcript, PIQs, plans, analysis).

    `web_search` lets the model browse first (Groq's built-in browser_search tool).
    """
    return _call_groq(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        max_tokens=max_tokens,
        tools=[{"type": "browser_search"}] if web_search else None,
    )


def generate_answer(
    query: str,
    conversation_history: list | None = None,
    profile_context: str | None = None,
    persona: str | None = None,
    mode: str | None = None,
) -> str:
    """Advisor chat reply, formatted as "Mood: …" (optional) + "Answer:\n…"."""
    persona = normalize_persona(persona) or "sage"
    system = (
        "You are Sage, a friendly college-planning advisor for Track2College. "
        "Help high school students with UC applications, A–G requirements, majors, "
        "deadlines, and general admissions advice. Be clear, warm, and practical. "
        "Use short paragraphs or bullets when listing steps. "
        "If you are unsure, say so and suggest talking to a school counselor. "
        "Do not invent official deadlines or URLs — if you mention a site, prefer well-known "
        "ones like universityofcalifornia.edu or studentaid.gov."
        f" Today is {date.today():%B %-d, %Y}."
        "\n\nLENGTH — keep replies short:\n"
        "• Default to 2–4 sentences, or a short list of at most 5 bullets. Aim for under 120 words.\n"
        "• Answer the question asked, then stop. No long intros, recaps, or closing pep talks.\n"
        "• Go longer only when the student asks for detail or a step-by-step walkthrough, or the task "
        "truly needs it (like drafting or revising an essay).\n"
        "\nFORMATTING — the chat only shows plain text with:\n"
        "• **bold** for a few key words, lines starting with \"- \" for bullets, \"1. \" for numbered steps, "
        "and a short line ending in a colon as a section label.\n"
        "• Never use horizontal rules (---), # headings, tables, italics, code blocks, emojis, or [text](url) "
        "links. Write a URL out in full instead.\n"
    )
    if profile_context and profile_context.strip():
        system += (
            "\n\nStudent profile (personalize with this; it is not a source of college facts):\n"
            + profile_context.strip()
            + "\n\nIf the profile has an APPLICATION PROGRESS section, it records what the student has done "
            "with Track2College's application tools (counselor email, call with Jordan, UC account, "
            "submission, Intent to Register, upcoming dates). Use it to answer \"what's done / what's next\" "
            "questions, and never say something happened that it doesn't show."
        )
    system += persona_prompt(persona)
    system += mode_prompt(mode)

    messages: list[dict] = [{"role": "system", "content": system}]
    for turn in conversation_history or []:
        user = (turn.get("user") or "").strip()
        bot = (turn.get("bot") or "").strip()
        if user:
            messages.append({"role": "user", "content": user})
        if bot:
            messages.append({"role": "assistant", "content": bot})
    messages.append({"role": "user", "content": query})

    search = [{"type": "browser_search"}] if _FACT_QUESTION.search(query) else None
    completion = _call_groq(messages, max_tokens=1200, tools=search)
    if not completion:
        return "Answer:\nI'm having trouble reaching the advisor right now. Please try again in a moment."

    mood, body = extract_mood(completion)
    response = f"Answer:\n{body.strip()}"
    if mood:
        response = f"Mood: {mood}\n{response}"
    return response


def _answer_text_only(full_response: str) -> str:
    match = re.search(
        r"Answer:\s*(.*?)(?:\n\s*Sources:|\n\s*Follow-up Questions|\Z)",
        full_response,
        re.IGNORECASE | re.DOTALL,
    )
    return match.group(1).strip() if match else full_response.strip()


def _extract_followup_questions(full_response: str) -> list[str]:
    match = re.search(
        r"Follow-up Questions.*?:\s*(.*)$",
        full_response,
        re.IGNORECASE | re.DOTALL,
    )
    if not match:
        return []
    questions: list[str] = []
    for line in match.group(1).splitlines():
        line = re.sub(r"^[-•*Q\d.]+\s*", "", line.strip()).strip()
        if line:
            questions.append(line)
    return questions


if __name__ == "__main__":
    conversation_memory: deque = deque(maxlen=4)
    print("Track2College chatbot (Groq) — type 'quit' to exit.\n")
    while True:
        user_input = input("\nYou: ").strip()
        if user_input.lower() in ("exit", "quit"):
            break
        if not user_input:
            continue
        memory_snapshot = list(conversation_memory)
        resolved = _resolve_followup_query(user_input, memory_snapshot)
        answer = generate_answer(resolved, conversation_history=memory_snapshot)
        print("\n" + answer)
        conversation_memory.append(
            {
                "user": resolved,
                "bot": _answer_text_only(answer),
                "followups": _extract_followup_questions(answer),
            }
        )
