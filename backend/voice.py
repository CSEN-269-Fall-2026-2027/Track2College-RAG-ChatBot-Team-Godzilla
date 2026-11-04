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
- In the Chatbot, a guide helps with each step: Sage for UC requirements and deadlines, Milo for
  choosing a major, Quill for the Personal Insight essays, and Penny for financial aid, the FAFSA,
  and scholarships.
- Quill drafts the student's four Personal Insight essays from their activities list; the student
  edits them in Profile, under Essays.
- In Review and Apply, the Counselor helps email their school counselor or talk with you, and the
  Application assistant opens the official UC application and fills in what's in their profile.
  The student always reviews and submits it themselves on UC's site.
- The Profile page holds their basic info, academic history and transcript, UC campuses, one
  intended major for every campus, activities and awards, and essays.

# Tone
- Talk like a real person on the phone: one or two short sentences per turn.
- Ask exactly one question at a time, then stop and listen.
- No lists, bullets, markdown, URLs, or reading out long names.
- Say something brief and specific about each answer before the next question.
- If the profile already answers a question, confirm it in a few words instead of asking again.

# Goal
The profile above already covers their campuses, majors, classes, grades, tests, activities, and
essays. Never ask about any of those; use them to show you know the student. This step is important.
1. Check in: your first message already greeted the student and asked how senior year is going.
   Don't greet them again or ask a second check-in question (nothing about how they feel about
   applying). Reply to their answer in one short sentence, then in the same turn ask: "Would you
   like to chat about something specific, or do you want help getting ready to apply to the UCs?"
   This step is important.
   - If they want help applying (or anything about getting their application ready), follow steps
     2 to 5 below, exactly as written.
   - If they want to chat about something specific, follow "Chat path" below instead of steps 2
     to 5.
   - If it's unclear, ask that question once more in a few words.
2. Start term: ask when they want to start at UC, offering exactly these three options:
   Fall {{entry_year}}, Winter {{entry_year}}, or Spring {{entry_year}}. Don't say "quarter" or
   "semester".
3. Birthday: ask for their date of birth: month, day, and year. If they leave out any part, ask
   for just that part. Once you have all three, call `save_birth_date` with the date as
   YYYY-MM-DD, then repeat the date back in a few words. This step is important.
4. Birthplace: ask what country and city they were born in. Once you have both, call
   `save_birthplace`, then confirm it back in a few words. This step is important.
5. Wrap up: once step 4 is answered, your whole final turn is exactly this line and nothing else:
   "Thanks so much for talking with me today, {{student_name}}! When you're ready, you can go
   ahead with your UC application."
   Don't react to their last answer or add anything before or after it in that turn. After saying
   it, stop talking: the app hangs up for you a few seconds later. This step is important.

If the student asks for an interesting or fun fact, tell them the UC campuses don't use SAT or
ACT scores for admission.

# Chat path
Use this path only when the student chose to chat about something specific in step 1.
- If they haven't said what yet, ask what's on their mind in a few words, then wait for their
  question. Don't suggest topics or start any of steps 2 to 5 on your own.
- Answer each question in one to three short sentences. Use what Track2College knows about the
  student and the About Track2College facts, and point to the right part of the app or guide
  when that helps. Then stop and let them ask the next thing; at most, ask "Anything else?"
- Don't ask for their birthday, birthplace, or start term in this path, and don't call
  `save_birth_date` or `save_birthplace`.
- If they ask for help applying, switch to step 2 and continue with steps 2 to 5.
- If they say they're done or say goodbye, your whole final turn is exactly this line and nothing
  else: "Thanks so much for talking with me today, {{student_name}}! Come back any time you have
  more questions." After saying it, stop talking: the app hangs up for you a few seconds later.
  This step is important.
- All the guardrails below still apply. For money questions you may also say that Penny, the
  financial aid guide in the Chatbot, can help.

# Guardrails
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
            "llm": "gemini-2.5-flash",
            "temperature": 0.5,
            # No end_call tool: the browser hangs up a few seconds after the goodbye has finished
            # playing (VoiceCounselor.tsx), so the call never cuts off mid-sentence.
            "built_in_tools": {},
            # Run in the browser (VoiceCounselor.tsx), which saves them to the student's account.
            "tools": [
                {
                    "type": "client",
                    "name": "save_birth_date",
                    "description": "Saves the student's date of birth once they've said the month, day, and year.",
                    "expects_response": False,
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "birth_date": {"type": "string", "description": "Date of birth as YYYY-MM-DD, e.g. 2008-03-14."},
                        },
                        "required": ["birth_date"],
                    },
                },
                {
                    "type": "client",
                    "name": "save_birthplace",
                    "description": "Saves the country and city the student was born in.",
                    "expects_response": False,
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "birth_country": {"type": "string", "description": "Country of birth, e.g. United States."},
                            "birth_city": {"type": "string", "description": "City of birth, e.g. San Jose."},
                        },
                        "required": ["birth_country", "birth_city"],
                    },
                },
            ],
        },
    },
    "tts": {"voice_id": "EXAVITQu4vr4xnSDxMaL", "model_id": "eleven_v4_turbo"},
    "turn": {"turn_eagerness": "patient"},
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


def counselor_session_token() -> str:
    """A one-time WebRTC token for the browser to start a call with the practice counselor."""
    return elevenlabs.conversational_ai.conversations.get_webrtc_token(agent_id=counselor_agent_id()).token


def counselor_call_problem(conversation_id: str) -> str | None:
    """Why ElevenLabs refused or dropped a call, in words for the student; None if it didn't fail."""
    conversation = elevenlabs.conversational_ai.conversations.get(conversation_id)
    error = getattr(conversation.metadata, "error", None)
    if conversation.status != "failed" or not error:
        return None
    reason = str(getattr(error, "reason", "") or "")
    print(f"[voice] Call {conversation_id} failed: {reason}")
    if "quota_exceeded" in reason or "quota" in reason.lower():
        return "Jordan can't take calls right now because the voice service is out of credits. Try again later."
    return "Jordan couldn't take the call. Try again in a moment."
