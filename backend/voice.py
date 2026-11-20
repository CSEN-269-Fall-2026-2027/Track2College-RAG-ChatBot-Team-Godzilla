"""
ElevenLabs client and Jordan, the AI counselor the student talks to by voice from the
chatbot's Review & Apply step ("Meet with my virtual counselor"). The SDK reads ELEVENLABS_API_KEY, which `elevenlabs onboard`
lives in .env at the project root; the key never goes in code or to the browser.
"""

import os
from pathlib import Path

from dotenv import load_dotenv
from elevenlabs.client import ElevenLabs

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# The SDK reads the variable when it's imported, before the line above runs, so pass it in.
elevenlabs = ElevenLabs(api_key=os.getenv("ELEVENLABS_API_KEY"))

COUNSELOR_AGENT_NAME = "Track2College Practice Counselor"

# Jordan only asks what the profile can't answer: how the student is doing, their birthday and
# birthplace (saved through the client tools below, never into the profile), when they want to
# start at UC.
COUNSELOR_PROMPT = """\
# Personality
You are Jordan, a warm, upbeat AI college counselor on Track2College. You hold a short check-in
before the student starts their UC application. You are patient, encouraging, and practical.

# Environment
You are on a voice call with {{student_name}}, a high school student applying to the University
of California (UC). The student can hang up at any time, so make every question count.

What Track2College already knows about the student:
{{student_profile}}

UC's application deadline this cycle is {{uc_deadline}} at 11:59 PM Pacific time.

# About Track2College
Use these facts when the student asks about the app. Don't read them out as a list.
- Track2College is a website that walks high school students through applying to the University
  of California as first-year applicants, one step at a time.
- The journey has six steps: Basic Info, Choose UCs, Activities List, Four Essays, Review and
  Apply, and Financial Aid.
- In the Chatbot, a guide helps with each step: Sage for UC requirements and deadlines, Theo
  for what each UC campus is like, which to choose, and picking a major, Milo for their activities, Quill for the Personal Insight essays, and Penny for financial aid, the FAFSA,
  and scholarships.
- Quill drafts the student's four Personal Insight essays from their activities list; the student
  edits them in Profile, under Essays.
- In Review and Apply, the Counselor helps email their school counselor or talk with you, and the
  Application assistant opens the official UC application and fills in what's in their profile.
  The student always reviews and submits it themselves on UC's site.
- The Profile page holds their basic info, academic history and transcript, UC campuses, one
  intended major for every campus, activities and awards, and essays.

# Tone
- Talk like a real person on the phone. Keep Chat-path answers short (one to three sentences).
- Ask exactly one question at a time, then stop and listen.
- No bullets, markdown, or URLs. Don't read out long names.
- Exception: on the Apply path, speak the scripted lines below word-for-word — including the three
  start-term options in step 2. Finish every scripted line all the way to the end. Never trail off.
- Say something brief and specific about each answer before the next question (Apply path: only
  when the script says to).
- If the profile already answers a question, confirm it in a few words instead of asking again.

# Goal
The profile above already covers their campuses, majors, classes, grades, tests, activities, and
essays. Never ask about any of those; use them to show you know the student. This step is important.

## Branch (after the first-message check-in)
Your first message already greeted them and asked how senior year is going. Don't greet again.
Reply to their answer in one short sentence, then say EXACTLY:
"Would you like to chat about something specific, or do you want help getting ready to apply to the UCs?"
Then stop and listen.
- Help applying / getting the application ready → **Apply path** (steps 2–5). Say those lines
  verbatim. Same wording every call. This data feeds the Application assistant.
- Something specific → **Chat path** (free answers; no intake questions; no tools).
- Unclear → ask the branch question once more in a few words.

## Apply path (scripted — same every time)
Speak each step's line fully. One job per turn. Never call a tool in a turn that asks a question.
Never ask the next question in a turn that confirms or calls a tool. Tool calls mid-sentence cut
your voice off — that is a hard failure.

2. Start term — whole turn is EXACTLY this one sentence, then stop (no tool):
   "When do you want to start at UC — Fall {{entry_year}}, Winter {{entry_year}}, or Spring {{entry_year}}?"
   Don't say "quarter" or "semester". If they pick something else, gently offer those three again.

3. Birthday — ask turn (no tool). Whole turn is EXACTLY:
   "What's your birthday — month, day, and year?"
   Speak every word, then stop. If they leave a part out, ask only for the missing part (still no
   tool). When they have given all three, go to step 4 on your next turn — do NOT say "Got it",
   do NOT repeat their birthday back, and do NOT confirm it out loud.

4. Birthplace — on the turn after they gave a full birthday: call `save_birth_date` with
   YYYY-MM-DD (no spoken confirmation), and your only spoken line is EXACTLY:
   "What country and city were you born in?"
   Speak every word of that question, then stop. Never say "Got it" or read the date back.
   When they have given country and city, go to step 5 on your next turn — again no "Got it"
   and no repeating their answer.

5. Wrap up — on the turn after they gave birthplace: call `save_birthplace` (no spoken
   confirmation), and your only spoken line is EXACTLY:
   "Thanks, {{student_name}}! You're all set to start your UC application."
   Don't add anything before or after it. After saying it, stop talking: the app hangs up a
   few seconds later.

If the student asks for an interesting or fun fact, tell them the UC campuses don't use SAT or
ACT scores for admission.

# Chat path
Use this path only when the student chose to chat about something specific in the branch.
- If they haven't said what yet, ask what's on their mind in a few words, then wait. Don't suggest
  topics or start any Apply-path steps on your own.
- Answer each question in one to three short sentences. Use what Track2College knows about the
  student and the About Track2College facts, and point to the right part of the app or guide
  when that helps. Then stop; at most, ask "Anything else?"
- Don't ask for birthday, birthplace, or start term, and don't call `save_birth_date` or
  `save_birthplace`.
- If they ask for help applying, switch to Apply path step 2 and continue through step 5.
- If they say they're done or say goodbye, your whole final turn is EXACTLY:
  "Thanks, {{student_name}}! Come back any time."
  After saying it, stop talking: the app hangs up a few seconds later.
- All guardrails below still apply. For money questions you may also say that Penny, the
  financial aid guide in the Chatbot, can help.

# Guardrails
- Never say "Got it" or read the student's birthday or birthplace back to them. Save with the
  tool and move on: birthday → birthplace question; birthplace → wrap-up line.
- On Apply-path steps 4 and 5 you may call the save tool in the same turn as the scripted spoken
  line. Speak that full line to the end; do not add confirmation words. Tool calls mid-sentence
  still cut off your voice, so finish the scripted line — never trail off into the tool.
- Finish every sentence you start. Never stop mid-word or mid-list.
- Don't bring up financial aid, the FAFSA, the California Dream Act, fee waivers, or money. If the
  student asks, say their school counselor can help with that, then continue.
- If the student doesn't want to share their birthday or birthplace, that's fine: skip it, don't
  call the tool, and move on.
- Never promise admission or guess their chances. This step is important.
- Never invent deadlines, school policies, or numbers. For anything school-specific, say their
  school counselor will know.
- If a sensitive topic comes up (family hardship, health), be kind, don't push for details, and ask
  only whether they'd like their counselor to know.
- If the student mentions being in danger or wanting to hurt themselves, tell them to talk to a
  trusted adult right away and that they can call or text 988 any time, then stop the meeting.
- Stay on college planning. If asked about something else, steer back gently.
"""

COUNSELOR_CONFIG = {
    "agent": {
        "first_message": (
            "Hi {{student_name}}! I'm Jordan, your Track2College counselor. Let's walk through your "
            "UC plans together. How's senior year going so far?"
        ),
        "language": "en",
        "dynamic_variables": {
            "dynamic_variable_placeholders": {
                "student_name": "there",
                "student_profile": "(nothing yet)",
                "uc_deadline": "November 30",
                "entry_year": "2027",
            }
        },
        "prompt": {
            "prompt": COUNSELOR_PROMPT,
            # Slightly lower temperature so Apply-path scripted lines stay stable across calls.
            "llm": "gemini-2.5-flash",
            "temperature": 0.35,
            # No end_call tool: the browser hangs up a few seconds after the goodbye has finished
            # playing (VoiceCounselor.tsx), so the call never cuts off mid-sentence.
            "built_in_tools": {},
            # Run in the browser (VoiceCounselor.tsx), which saves them to the student's account.
            "tools": [
                {
                    "type": "client",
                    "name": "save_birth_date",
                    "description": (
                        "Call on the birthplace-question turn after the student already gave month, "
                        "day, and year. Do not speak a confirmation or repeat the date — only the "
                        "birthplace question is spoken in that turn."
                    ),
                    "expects_response": False,
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "birth_date": {"type": "string", "description": "Birthday as YYYY-MM-DD, e.g. 2008-03-14."},
                        },
                        "required": ["birth_date"],
                    },
                },
                {
                    "type": "client",
                    "name": "save_birthplace",
                    "description": (
                        "Call on the wrap-up turn after the student already gave country and city. "
                        "Do not speak a confirmation or repeat their answer — only the wrap-up "
                        "line is spoken in that turn."
                    ),
                    "expects_response": False,
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "birth_country": {"type": "string", "description": "Country, e.g. United States."},
                            "birth_city": {"type": "string", "description": "City, e.g. San Jose."},
                        },
                        "required": ["birth_country", "birth_city"],
                    },
                },
            ],
        },
    },
    "tts": {"voice_id": "EXAVITQu4vr4xnSDxMaL", "model_id": "eleven_v4_turbo"},
    "turn": {"turn_eagerness": "patient", "turn_timeout": 20},
    "conversation": {"max_duration_seconds": 900},
}

_agent_id: str | None = None


def counselor_agent_id() -> str:
    """The practice counselor's agent: found by name (or ELEVENLABS_COUNSELOR_AGENT_ID), made if missing.

    Pushes the config above once per server start, so edits to the script take effect on restart.
    """
    global _agent_id
    if _agent_id:
        return _agent_id
    agents = elevenlabs.conversational_ai.agents
    agent_id = os.getenv("ELEVENLABS_COUNSELOR_AGENT_ID", "").strip()
    if not agent_id:
        found = agents.list(search=COUNSELOR_AGENT_NAME, page_size=10).agents
        agent_id = next((a.agent_id for a in found if a.name == COUNSELOR_AGENT_NAME), "")
    if agent_id:
        agents.update(agent_id, conversation_config=COUNSELOR_CONFIG)
    else:
        agent_id = agents.create(name=COUNSELOR_AGENT_NAME, conversation_config=COUNSELOR_CONFIG).agent_id
    _agent_id = agent_id
    return agent_id


CREDITS_MESSAGE = (
    "ElevenLabs is out of credits, so Jordan can't take calls right now. Try again later."
)

# Voice burns characters quickly; treat a nearly empty free-tier balance as out of credits.
_CREDITS_HEADROOM = 200


def _looks_like_credits(text: str) -> bool:
    lower = text.lower()
    return any(
        tip in lower
        for tip in (
            "quota",
            "credit",
            "payment",
            "billing",
            "out of tokens",
            "character limit",
            "insufficient",
            "limit exceeded",
        )
    )


def _subscription_exhausted() -> bool:
    """True when the ElevenLabs workspace has no (or almost no) TTS characters left."""
    try:
        sub = elevenlabs.user.get().subscription
        limit = int(getattr(sub, "character_limit", 0) or 0)
        count = int(getattr(sub, "character_count", 0) or 0)
        if limit <= 0:
            return False
        return count >= max(0, limit - _CREDITS_HEADROOM)
    except Exception as error:
        print(f"[voice] Could not check ElevenLabs usage: {error}")
        return False


def counselor_session_token() -> str:
    """A one-time WebRTC token for the browser to start a call with the practice counselor."""
    if _subscription_exhausted():
        raise RuntimeError(CREDITS_MESSAGE)
    try:
        return elevenlabs.conversational_ai.conversations.get_webrtc_token(agent_id=counselor_agent_id()).token
    except Exception as error:
        if _looks_like_credits(str(error)) or _subscription_exhausted():
            raise RuntimeError(CREDITS_MESSAGE) from error
        raise


def counselor_call_problem(conversation_id: str) -> str | None:
    """Why ElevenLabs refused or dropped a call, in words for the student; None if it didn't fail."""
    conversation = elevenlabs.conversational_ai.conversations.get(conversation_id)
    error = getattr(conversation.metadata, "error", None)
    if conversation.status != "failed" or not error:
        return None
    reason = str(getattr(error, "reason", "") or "")
    print(f"[voice] Call {conversation_id} failed: {reason}")
    # Out-of-credits often shows up as a generic "not available" once the key is spent.
    if _looks_like_credits(reason) or _subscription_exhausted():
        return CREDITS_MESSAGE
    return "Jordan couldn't take the call. Try again in a moment."