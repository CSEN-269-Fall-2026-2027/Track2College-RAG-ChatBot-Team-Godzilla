"""
LLM helpers for Track2College.

Chat, transcripts, PIQs, course plans, and profile analysis all go through Groq
(OpenAI-compatible). No Qdrant / embedding / scrape pipeline.
"""

from __future__ import annotations

import os
import re
from collections import deque

import requests
from dotenv import load_dotenv

from followup_refs import resolve_followup_query as _resolve_followup_query
from persona import extract_mood, normalize_persona, persona_prompt

load_dotenv()

INFERENCE_PROVIDER = os.environ.get("INFERENCE_PROVIDER", "groq").strip().lower() or "groq"
GROQ_API_KEY = (os.environ.get("GROQ_API_KEY", "") or os.environ.get("GROQ_KEY", "")).strip()
GROQ_MODEL = (
    os.environ.get("GROQ_MODEL", "").strip()
    or os.environ.get("LLM_MODEL", "").strip()
    or "openai/gpt-oss-120b"
)
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

# Kept for older callers; retrieval is gone.
RELEVANCE_THRESHOLD = 0.0

if INFERENCE_PROVIDER != "groq":
    print(f"[warning] INFERENCE_PROVIDER={INFERENCE_PROVIDER!r} — this build only supports groq")
if not GROQ_API_KEY:
    print("[warning] GROQ_API_KEY is missing in .env")


def _call_groq(messages: list[dict], max_tokens: int = 1000) -> str:
    """OpenAI-compatible Groq chat completions. Returns assistant text or ""."""
    if not GROQ_API_KEY:
        print("[Groq] Missing GROQ_API_KEY")
        return ""
    payload = {
        "model": GROQ_MODEL,
        "messages": messages,
        "temperature": 0.4,
        "max_tokens": max_tokens,
    }
    try:
        resp = requests.post(
            GROQ_URL,
            headers={
                "Authorization": f"Bearer {GROQ_API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=90,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:
        print(f"[Groq] Request error ({GROQ_MODEL}): {exc}")
        return ""

    try:
        return (data["choices"][0]["message"]["content"] or "").strip()
    except Exception:
        print(f"[Groq] Unexpected response: {data}")
        return ""


def complete(system_prompt: str, user_message: str, max_tokens: int = 1000) -> str:
    """Single-turn completion for JSON features (transcript, PIQs, plans, analysis)."""
    return _call_groq(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ],
        max_tokens=max_tokens,
    )


def _generate_groq_chat(
    query: str,
    conversation_history: list | None = None,
    profile_context: str | None = None,
    persona: str | None = None,
) -> tuple[str, list[str]]:
    """Direct conversational answers via Groq — UC-focused, no retrieval."""
    persona = normalize_persona(persona) or "sage"
    system = (
        "You are Sage, a friendly college-planning advisor for Track2College. "
        "Help high school students with UC applications, A–G requirements, majors, "
        "deadlines, and general admissions advice. Be clear, warm, and practical. "
        "Use short paragraphs or bullets when listing steps. "
        "If you are unsure, say so and suggest talking to a school counselor. "
        "Do not invent official deadlines or URLs — if you mention a site, prefer well-known "
        "ones like universityofcalifornia.edu or studentaid.gov."
    )
    if profile_context and profile_context.strip():
        system += (
            "\n\nStudent profile (personalize with this; it is not a source of college facts):\n"
            + profile_context.strip()
        )
    system += persona_prompt(persona)

    messages: list[dict] = [{"role": "system", "content": system}]
    for turn in conversation_history or []:
        user = (turn.get("user") or "").strip()
        bot = (turn.get("bot") or "").strip()
        if user:
            messages.append({"role": "user", "content": user})
        if bot:
            messages.append({"role": "assistant", "content": bot})
    messages.append({"role": "user", "content": query})

    completion = _call_groq(messages, max_tokens=1200)
    if not completion:
        return (
            "Answer:\nI'm having trouble reaching the advisor right now. Please try again in a moment.",
            [],
        )

    mood, body = extract_mood(completion)
    response = f"Answer:\n{body.strip()}"
    if mood:
        response = f"Mood: {mood}\n{response}"
    return response, []


def generate_answer(
    query: str,
    return_context: bool = False,
    conversation_history: list | None = None,
    profile_context: str | None = None,
    persona: str | None = None,
) -> tuple:
    response, sources = _generate_groq_chat(
        query,
        conversation_history=conversation_history,
        profile_context=profile_context,
        persona=persona,
    )
    if return_context:
        return response, sources, []
    return response, sources


def get_answer(question: str) -> str:
    response, _ = generate_answer(question)
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


# Stubs so older helpers that imported retrieval do not crash if leftover.
def get_query_embedding(_query_text: str) -> list:
    return []


def search_collection(_query_emb: list, _n_results: int) -> dict:
    return {"documents": [[]], "metadatas": [[]], "distances": [[]]}


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
        answer, _ = generate_answer(resolved, conversation_history=memory_snapshot)
        print("\n" + answer)
        conversation_memory.append(
            {
                "user": resolved,
                "bot": _answer_text_only(answer),
                "followups": _extract_followup_questions(answer),
            }
        )
