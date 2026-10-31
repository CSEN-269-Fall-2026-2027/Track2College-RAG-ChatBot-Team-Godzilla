# Track2College Backend Setup

FastAPI app in `backend/` for the UC-focused advisor: chat, transcript reading, PIQ drafts, and course plans. Answers come from **Groq**.

```
Browser (frontend, :5500)
        │  POST /chat, /transcript/analyze, /essay/piqs, …
        ▼
FastAPI (api.py, :8000) ──► Groq chat completions
```

## Prerequisites

| Tool | Notes |
| ---- | ----- |
| Python 3.11+ | `backend/runtime.txt` |
| Groq API key | [console.groq.com](https://console.groq.com) |

## One-time setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp ../.env.example ../.env
# edit the root .env — set GROQ_API_KEY
```

| Variable | Required | Notes |
| -------- | -------- | ----- |
| `GROQ_API_KEY` | yes | Groq console key |
| `GROQ_MODEL` | no | Defaults to `openai/gpt-oss-120b` |
| `API_PORT` | no | Defaults to `8000` |
| `ELEVENLABS_API_KEY` | for voice | Voice counselor |

All keys live in the single `.env` at the project root (see `SETUP.md` for the full list).

Never commit `.env`.

## Run

```bash
cd backend
source .venv/bin/activate
python api.py
```

Health check: `GET http://127.0.0.1:8000/health`

Main routes: `/chat`, `/transcript/analyze`, `/essay/piqs`, `/essay/generate`, `/plan/courses`, `/profile/analysis`, `/agent/counselor/find` (web search for the student's counselor), `/agent/counselor/email`, `/agent/uc-account/start` + `/agent/uc-account/status/{id}` (opens the UC application in a visible Chrome window via Playwright — run `python -m playwright install chromium` once; only works when the backend runs on the student's own computer).

Tests: `python -m unittest` in `backend`.

See `SETUP.md` for running the frontend alongside this API.
