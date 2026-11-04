# Track2College

A UC college-planning app with a guided journey, advisor chat, transcript review,
course plans, PIQ drafts, and an application assistant. Built with React, FastAPI,
Groq, and Supabase; ElevenLabs powers the optional voice counselor.

## Setup

You need Node.js 22.12+, Python 3.11+, a Groq API key, and a Supabase project.
Run these commands from the project root:

```sh
cp .env.example .env
npm ci --prefix frontend
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.txt
backend/.venv/bin/python -m playwright install chromium
```

Fill in `GROQ_API_KEY`, `VITE_SUPABASE_URL`, and `VITE_SUPABASE_ANON_KEY` in `.env`.
Apply [supabase/schema.sql](supabase/schema.sql) in your project's SQL editor,
enable email sign-in, and allow `http://localhost:5500` as an auth redirect URL.
See [Supabase setup](supabase/README.md) for details.

ElevenLabs is only needed for voice. Browserbase is only needed for cloud browser
mode. Leave their settings blank if you don't use those features.

## Run

Start the API in one terminal:

```sh
cd backend
.venv/bin/python api.py
```

Start the frontend in another:

```sh
cd frontend
npm run dev
```

Open **http://localhost:5500**. The API runs on port 8000; its health check is
`http://127.0.0.1:8000/health`. Restart the servers after changing `.env`.

On Windows, use `backend\.venv\Scripts\python.exe` during setup and
`.venv\Scripts\python.exe api.py` from `backend`.

## Checks

```sh
npm test --prefix frontend
npm run build --prefix frontend
cd backend
.venv/bin/python -m unittest discover -s tests
```

Tests cover frontend logic and backend helpers; live services and browser flows
need a manual check. Code lives in `frontend/src` and `backend`; backend tests
live in `backend/tests`.

Keep private keys in the ignored root `.env`. Only public settings belong in
`VITE_*` variables, since those are bundled into the browser. Use Supabase's
anon/publishable key, never its service-role or secret key.
