from collections import deque
from datetime import datetime, timezone
from threading import Lock
from typing import Any, Deque, Dict, List, Optional
import os
import time
import uuid

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn

# query.py loads the root .env on import.
from query import (
    generate_answer,
    _answer_text_only,
    _extract_followup_questions,
    _resolve_followup_query,
)
from profile_analysis import analyze_profile
from transcript import TranscriptError, analyze_transcript
from course_plan import build_course_plan
from essay import generate_essay
from piq import generate_piqs
import uc_account
from counselor import draft_counselor_email, find_counselors

app = FastAPI(
    title="Track2College Chatbot API",
    version="1.0.0",
    description="UC-focused advisor API (Groq): chat, transcripts, PIQs, course plans.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        # replace this with vercel domain when deployed
    ],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_CONVERSATION_TURNS = 4
_session_lock = Lock()
_session_store: Dict[str, Deque[Dict[str, str]]] = {}


class ChatRequest(BaseModel):
    query: str = Field(..., min_length=1, description="User query")
    session_id: Optional[str] = Field(
        None,
        description="Optional chat session id. Create one if omitted.",
    )
    profile_context: Optional[str] = Field(
        None,
        max_length=6000,
        description="Optional plain-text student profile used to personalize answers.",
    )
    persona: Optional[str] = Field(
        None,
        max_length=32,
        description="Optional Story-mode mentor id (sage, penny, quill, milo) that sets the answer's voice.",
    )


class ProfileAnalysisRequest(BaseModel):
    profile_summary: str = Field("", max_length=8000)
    colleges: List[str] = Field(default_factory=list, max_length=20)
    majors: List[str] = Field(default_factory=list, max_length=10)


class CollegeFit(BaseModel):
    name: str
    fit: str
    reasoning: str
    sources: List[str]


class ActionItem(BaseModel):
    title: str
    detail: str
    timeframe: str


class ProfileAnalysisResponse(BaseModel):
    summary: str
    strengths: List[str]
    gaps: List[str]
    colleges: List[CollegeFit]
    actions: List[ActionItem]


class TranscriptRequest(BaseModel):
    file_name: str = Field(..., min_length=1, max_length=255)
    mime_type: str = Field("", max_length=100)
    # 5 MB file ≈ 6.7 MB base64
    content_base64: str = Field(..., min_length=1, max_length=7_200_000)


class TranscriptCourse(BaseModel):
    name: str
    grade_level: str
    term: str
    grade: str
    level: str
    area: str
    semesters: int


class ReportedGpa(BaseModel):
    unweighted: str
    weighted: str


class TranscriptResponse(BaseModel):
    student_name: str
    school: str
    reported_gpa: ReportedGpa
    courses: List[TranscriptCourse]
    summary: str
    strengths: List[str]
    concerns: List[str]


class CompletedCourse(BaseModel):
    name: str = Field(..., max_length=200)
    grade_level: str = Field("", max_length=10)
    level: str = Field("regular", max_length=30)
    area: str = Field("none", max_length=10)
    grade: str = Field("", max_length=10)


class CoursePlanRequest(BaseModel):
    college: str = Field(..., min_length=1, max_length=200)
    major: str = Field("", max_length=200)
    grade_level: str = Field("", max_length=20)
    completed_courses: List[CompletedCourse] = Field(default_factory=list, max_length=120)
    profile_summary: str = Field("", max_length=8000)


class PlannedCourse(BaseModel):
    name: str
    area: str
    level: str
    status: str
    note: str


class PlanYear(BaseModel):
    grade: str
    courses: List[PlannedCourse]


class PlanRequirement(BaseModel):
    area: str
    detail: str


class CoursePlanResponse(BaseModel):
    summary: str
    requirements: List[PlanRequirement]
    years: List[PlanYear]
    tips: List[str]
    sources: List[str]


class EssayRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=4000)
    profile_summary: str = Field("", max_length=8000)
    mode: str = Field("draft", max_length=20)


class EssayIdea(BaseModel):
    title: str
    angle: str
    why_it_fits: str


class EssayResponse(BaseModel):
    title: str
    essay: str
    ideas: List[EssayIdea]
    tips: List[str]


class PiqAnswer(BaseModel):
    question: str = Field("", max_length=500)
    answer: str = Field("", max_length=3000)


class PiqItem(BaseModel):
    id: str = Field(..., max_length=40)
    answers: List[PiqAnswer] = Field(default_factory=list, max_length=8)


class PiqRequest(BaseModel):
    piqs: List[PiqItem] = Field(..., min_length=1, max_length=4)
    profile_summary: str = Field("", max_length=8000)
    activities: str = Field("", max_length=16000)
    regenerate: bool = False


class PiqDraft(BaseModel):
    id: str
    question: str
    essay: str
    word_count: int


class PiqResponse(BaseModel):
    essays: List[PiqDraft]


class CounselorFindRequest(BaseModel):
    high_school: str = Field(..., min_length=1, max_length=200)
    city: str = Field("", max_length=100)
    state: str = Field("", max_length=100)
    last_name: str = Field("", max_length=100)


class Counselor(BaseModel):
    name: str
    title: str
    email: str
    serves: str
    match: bool
    source_url: str


class CounselorFindResponse(BaseModel):
    counselors: List[Counselor]


class CounselorEmailRequest(BaseModel):
    counselor_name: str = Field(..., min_length=1, max_length=200)
    student_name: str = Field("", max_length=200)
    profile_summary: str = Field("", max_length=8000)
    # What the student told the practice counselor on the voice call, if they had one.
    call_transcript: str = Field("", max_length=30000)


class CounselorEmailResponse(BaseModel):
    subject: str
    body: str


class UcPiq(BaseModel):
    number: int = Field(..., ge=1, le=8)
    title: str = Field(..., min_length=1, max_length=80)
    text: str = Field(..., min_length=1, max_length=6000)


class UcAccountStartRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=8, max_length=30)
    mode: str = Field(..., pattern="^(login|create)$")
    # What Track2College knows about the student, for filling "About you".
    facts: Dict[str, str] = Field(default_factory=dict)
    about_done: bool = False
    # The account already got past UC's emailed code, so never wait for one.
    verified: bool = False
    # The student's four chosen personal insight questions with their saved answers.
    piqs: List[UcPiq] = Field(default_factory=list, max_length=4)


class UcAccountStartResponse(BaseModel):
    run_id: str


class UcAccountStatusResponse(BaseModel):
    status: str
    detail: str
    mode: str
    open: bool
    created: bool
    verified: bool
    setup: bool
    about: bool
    about_report: Dict[str, List[Any]]
    piq: bool
    piq_report: Dict[str, List[str]]


class UcAccountCodeRequest(BaseModel):
    code: str = Field(..., min_length=1, max_length=20)


class ChatResponse(BaseModel):
    session_id: str
    answer: str
    sources: List[str]
    raw_response: str
    response_time_ms: int
    timestamp_utc: str


class HealthResponse(BaseModel):
    status: str
    service: str
    inference_provider: str
    timestamp_utc: str



def _get_or_create_session_id(session_id: Optional[str]) -> str:
    if session_id and session_id.strip():
        return session_id.strip()
    return str(uuid.uuid4())


def _get_session_memory(session_id: str) -> Deque[Dict[str, str]]:
    with _session_lock:
        if session_id not in _session_store:
            _session_store[session_id] = deque(maxlen=MAX_CONVERSATION_TURNS)
        return _session_store[session_id]


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        service="track2college-api",
        inference_provider="groq",
        timestamp_utc=datetime.now(timezone.utc).isoformat(),
    )


@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    query_text = request.query.strip()
    if not query_text:
        raise HTTPException(status_code=400, detail="Query cannot be empty")

    session_id = _get_or_create_session_id(request.session_id)
    session_memory = _get_session_memory(session_id)
    memory_snapshot = list(session_memory)
    start_time = time.perf_counter()

    # Resolve shorthand follow-up references (e.g. "Q1", "answer Q2",
    # "the second one") to the actual stored question text before answering.
    resolved_query = _resolve_followup_query(query_text, memory_snapshot)

    try:
        raw_response = generate_answer(
            resolved_query,
            conversation_history=memory_snapshot,
            profile_context=request.profile_context,
            persona=request.persona,
        )
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Chat generation failed: {error}")

    elapsed_ms = int((time.perf_counter() - start_time) * 1000)
    with _session_lock:
        # Store: compact answer text + extracted follow-up questions so the
        # next request can resolve Q1/Q2/Q3 references correctly.
        # Use the resolved query as the stored user turn so the conversation
        # history stays semantically complete.
        session_memory.append({
            "user": resolved_query,
            "bot": _answer_text_only(raw_response),
            "followups": _extract_followup_questions(raw_response),
        })

    return ChatResponse(
        session_id=session_id,
        answer=raw_response,
        sources=[],
        raw_response=raw_response,
        response_time_ms=elapsed_ms,
        timestamp_utc=datetime.now(timezone.utc).isoformat(),
    )


@app.delete("/chat/{session_id}")
async def clear_session(session_id: str):
    with _session_lock:
        existed = session_id in _session_store
        _session_store.pop(session_id, None)
    return {
        "session_id": session_id,
        "cleared": existed,
    }


@app.post("/profile/analysis", response_model=ProfileAnalysisResponse)
def profile_analysis(request: ProfileAnalysisRequest) -> ProfileAnalysisResponse:
    if not request.profile_summary.strip() and not request.colleges:
        raise HTTPException(status_code=400, detail="Add some profile details or colleges before running an analysis.")
    try:
        result = analyze_profile(request.profile_summary, request.colleges, request.majors)
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Profile analysis failed: {error}")
    return ProfileAnalysisResponse(**result)


@app.post("/transcript/analyze", response_model=TranscriptResponse)
def transcript_analyze(request: TranscriptRequest) -> TranscriptResponse:
    try:
        result = analyze_transcript(request.file_name, request.mime_type, request.content_base64)
    except TranscriptError as error:
        raise HTTPException(status_code=422, detail=str(error))
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Transcript analysis failed: {error}")
    return TranscriptResponse(**result)


@app.post("/plan/courses", response_model=CoursePlanResponse)
def plan_courses(request: CoursePlanRequest) -> CoursePlanResponse:
    try:
        result = build_course_plan(
            request.college.strip(),
            request.major.strip(),
            request.grade_level.strip(),
            [course.model_dump() for course in request.completed_courses],
            request.profile_summary,
        )
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Course planning failed: {error}")
    return CoursePlanResponse(**result)


@app.post("/essay/generate", response_model=EssayResponse)
def essay_generate(request: EssayRequest) -> EssayResponse:
    if not request.prompt.strip():
        raise HTTPException(status_code=400, detail="Paste an essay prompt first.")
    mode = "ideas" if request.mode.strip().lower() == "ideas" else "draft"
    try:
        result = generate_essay(request.prompt, request.profile_summary, mode)
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Essay generation failed: {error}")
    return EssayResponse(**result)


@app.post("/essay/piqs", response_model=PiqResponse)
def essay_piqs(request: PiqRequest) -> PiqResponse:
    """Drafts the student's chosen UC Personal Insight Questions (max 350 words each) with Groq."""
    try:
        essays = generate_piqs(
            [item.model_dump() for item in request.piqs],
            request.profile_summary,
            request.activities,
            regenerate=request.regenerate,
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"PIQ generation failed: {error}")
    return PiqResponse(essays=essays)


@app.post("/agent/counselor/find", response_model=CounselorFindResponse)
def agent_counselor_find(request: CounselorFindRequest) -> CounselorFindResponse:
    """Searches the web for the counselors at the student's high school."""
    try:
        counselors = find_counselors(request.high_school, request.city, request.state, request.last_name)
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Counselor search failed: {error}")
    return CounselorFindResponse(counselors=counselors)


@app.post("/agent/counselor/email", response_model=CounselorEmailResponse)
def agent_counselor_email(request: CounselorEmailRequest) -> CounselorEmailResponse:
    """Drafts the student's email to their counselor; the student sends it themselves."""
    try:
        result = draft_counselor_email(request.counselor_name, request.student_name, request.profile_summary, request.call_transcript)
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error))
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Email draft failed: {error}")
    return CounselorEmailResponse(**result)



@app.post("/agent/uc-account/start", response_model=UcAccountStartResponse)
def agent_uc_account_start(request: UcAccountStartRequest) -> UcAccountStartResponse:
    """Opens the UC application in a visible browser window and signs in or fills in sign-up."""
    try:
        facts = {k: v[:200] for k, v in list(request.facts.items())[:40] if isinstance(v, str)}
        run_id = uc_account.start(
            request.email.strip(),
            request.password,
            request.mode,
            facts,
            request.about_done,
            request.verified,
            [q.model_dump() for q in request.piqs],
        )
    except uc_account.UcAccountError as error:
        raise HTTPException(status_code=400, detail=str(error))
    return UcAccountStartResponse(run_id=run_id)


@app.get("/agent/uc-account/status/{run_id}", response_model=UcAccountStatusResponse)
def agent_uc_account_status(run_id: str) -> UcAccountStatusResponse:
    run = uc_account.status(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="That UC window session wasn't found. Start again.")
    return UcAccountStatusResponse(**run)


class CounselorVoiceResponse(BaseModel):
    conversation_token: str


@app.post("/agent/counselor/voice", response_model=CounselorVoiceResponse)
def agent_counselor_voice() -> CounselorVoiceResponse:
    """Starts a voice call with the ElevenLabs practice counselor; the key stays on the server."""
    try:
        from voice import counselor_session_token

        return CounselorVoiceResponse(conversation_token=counselor_session_token())
    except Exception as error:
        print(f"[voice] Could not start the counselor call: {error}")
        raise HTTPException(status_code=502, detail="Couldn't reach the voice counselor. Please try again.")



@app.post("/agent/uc-account/code/{run_id}")
def agent_uc_account_code(run_id: str, request: UcAccountCodeRequest) -> dict:
    """Types the student's UC verification code into the open UC window."""
    try:
        uc_account.submit_code(run_id, request.code)
    except uc_account.UcAccountError as error:
        raise HTTPException(status_code=400, detail=str(error))
    return {"ok": True}


if __name__ == "__main__":
    port = int(os.getenv("API_PORT", "8000"))
    uvicorn.run("api:app", host="0.0.0.0", port=port, reload=True)
