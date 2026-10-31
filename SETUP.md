# Track2College — local setup

## How many terminals?

**Day to day you need 2 terminals:**

| # | What | Command |
| - | ---- | ------- |
| 1 | Backend API (Groq) | `python api.py` in `backend` |
| 2 | Frontend | `npm run dev` in `frontend` |

Auth and profile data use **Supabase in the cloud** — no local Supabase terminal.

Advisor chat, transcripts, PIQs, and course plans all use Groq.

---

## Prerequisites (once)

- **Node.js** 18+ (frontend)
- **Python** 3.11+ with the project venv in `backend/.venv`
- A **Groq API key** ([console.groq.com](https://console.groq.com))
- A **Supabase** project (URL + anon key) — see `supabase/README.md`

---

## One-time env file

All keys and settings live in **one file: `.env` at the project root** (gitignored). Copy the template and fill it in:

```bash
cp .env.example .env
```

| Variable | Required | Used by |
| -------- | -------- | ------- |
| `GROQ_API_KEY` | yes | backend (LLM) |
| `GROQ_MODEL` | no | backend; defaults to `openai/gpt-oss-120b` |
| `API_PORT` | no | backend; defaults to `8000` |
| `ELEVENLABS_API_KEY` | for voice | backend (voice counselor) |
| `ELEVENLABS_COUNSELOR_AGENT_ID` | no | backend; pins a voice agent |
| `UC_DEBUG` | no | backend; `1` dumps UC pages to `backend/uc_debug/` |
| `VITE_API_URL` | no | frontend; defaults to `http://127.0.0.1:8000` |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | yes | frontend (see `supabase/README.md`) |

The backend loads it directly and Vite reads it via `envDir: ".."`. Only `VITE_*` variables reach the browser, so never give a secret a `VITE_` name. Never commit `.env`.

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
python -m playwright install chromium   # browser for Apply → Create your UC account
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

1. Supabase project active; root `.env` filled in; latest `supabase/schema.sql` applied to that project (including the `personal_info` table)  
2. Root `.env` has a valid `GROQ_API_KEY`  
3. Terminal 1: backend running on `:8000`  
4. Terminal 2: frontend on `:5500`  
5. Browser: log in → Advisor → message Sage  

---

## Troubleshooting

- **Advisor offline / can’t reach server** — Terminal 1 not running, or `VITE_API_URL` wrong  
- **Chat fails / empty answers** — check Groq key and model name in the root `.env`; restart `python api.py` after editing it (restart `npm run dev` after changing `VITE_*` values)  
- **Port 8000 already in use** — stop the old API (`lsof -ti :8000 | xargs kill`) then start again  
- **Auth errors** — confirm Supabase URL/anon key and that Email auth is enabled (see `supabase/README.md`)  
- **Birthday / birthplace not filled on UC's Personal information** — the voice call's answers live in the Supabase `personal_info` table. If Supabase says `Could not find the table 'public.personal_info'` (`PGRST205`), apply `supabase/schema.sql` to the project, then talk to the counselor again: calls made before the table existed weren't saved. See *Re-apply schema* in `supabase/README.md`.  
- **PIQ drafts fail with a 502 / "per-minute limit"** — Groq's free tier allows 8,000 tokens a minute per account, whatever the key. One draft run fits; regenerating everything right away waits for the limit to reset. Groq's Dev tier raises it.  
