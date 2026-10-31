# Track2College Backend Setup

FastAPI app in `backend/` for the UC-focused advisor: chat, transcript reading, PIQ drafts, and course plans. Answers come from **Groq** — there is no Qdrant, scrape pipeline, or RunPod path in this build.

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
cp .env.example .env
# edit .env — set API_KEY and GROQ_API_KEY
```

| Variable | Required | Notes |
| -------- | -------- | ----- |
| `API_KEY` | yes | App secret; `/analyze` expects `Authorization: Bearer …` |
| `INFERENCE_PROVIDER` | yes | Must be `groq` |
| `GROQ_API_KEY` | yes | Groq console key |
| `GROQ_MODEL` / `LLM_MODEL` | no | Defaults to `openai/gpt-oss-120b` |
| `API_PORT` | no | Defaults to `8000` |

Never commit `.env`.

## Run

```bash
cd backend
source .venv/bin/activate
python api.py
```

Health check: `GET http://127.0.0.1:8000/health`

Main routes: `/chat`, `/transcript/analyze`, `/essay/piqs`, `/essay/generate`, `/plan/courses`, `/profile/analysis`.

See `SETUP.md` for running the frontend alongside this API.
