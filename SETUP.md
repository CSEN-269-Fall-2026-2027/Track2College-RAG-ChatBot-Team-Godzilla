# Track2College — local setup

## How many terminals?

**Day to day you need 2 terminals:**

| # | What | Command |
| - | ---- | ------- |
| 1 | Backend API (Groq) | `python api.py` in `backend` |
| 2 | Frontend | `npm run dev` in `frontend` |

Auth and profile data use **Supabase in the cloud** — no local Supabase terminal.

Advisor chat, transcripts, PIQs, and course plans all use Groq. You do **not** need Qdrant, Ollama, RunPod, or the old URL scrape pipeline.

---

## Prerequisites (once)

- **Node.js** 18+ (frontend)
- **Python** 3.11+ with the project venv in `backend/.venv`
- A **Groq API key** ([console.groq.com](https://console.groq.com))
- A **Supabase** project (URL + anon key) — see `supabase/README.md`

---

## One-time env files

### Backend — `backend/.env`

```bash
API_KEY=local-development-key
API_PORT=8000

INFERENCE_PROVIDER=groq
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=openai/gpt-oss-120b
LLM_MODEL=openai/gpt-oss-120b
```

Copy from `backend/.env.example` if needed. Never commit real keys.

### Frontend — `frontend/.env.local`

```bash
VITE_API_URL=http://127.0.0.1:8000
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-or-publishable-key>
```

See `frontend/.env.example` and `supabase/README.md`.

### Frontend deps (once)

```bash
cd frontend
npm install
```

### Backend venv (once, if missing)

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

---

## Start the app (2 terminals)

### Terminal 1 — Backend

```bash
cd ~/Desktop/Track2College-RAG-ChatBot-Team-Godzilla/backend
source .venv/bin/activate
python api.py
```

Should listen on **http://127.0.0.1:8000** (`GET /health` → ok).

### Terminal 2 — Frontend

```bash
cd ~/Desktop/Track2College-RAG-ChatBot-Team-Godzilla/frontend
npm run dev
```

Open **http://localhost:5500** (Vite is configured for port 5500 to match API CORS).

Sign up / log in, finish onboarding, then use **Advisor** to chat with Sage.

---

## Quick checklist

1. Supabase project active; `frontend/.env.local` filled in  
2. `backend/.env` has `INFERENCE_PROVIDER=groq` + valid `GROQ_API_KEY`  
3. Terminal 1: backend running on `:8000`  
4. Terminal 2: frontend on `:5500`  
5. Browser: log in → Advisor → message Sage  

---

## Troubleshooting

- **Advisor offline / can’t reach server** — Terminal 1 not running, or `VITE_API_URL` wrong  
- **Chat fails / empty answers** — check Groq key and model name in `.env`; restart `python api.py` after editing `.env`  
- **Port 8000 already in use** — stop the old API (`lsof -ti :8000 | xargs kill`) then start again  
- **Auth errors** — confirm Supabase URL/anon key and that Email auth is enabled (see `supabase/README.md`)  
