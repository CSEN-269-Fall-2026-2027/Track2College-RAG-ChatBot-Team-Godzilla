# Track2College Backend Setup

How to set up and start the RAG chatbot backend locally. Tested 2026-10-09 on an Apple M3 with 16 GB RAM (Ollama path); Gemini support added 2026-10-16.

## Overview

The backend is a FastAPI app (`Track2Cllg/api.py`) that answers questions using scraped college pages stored in a local Qdrant database, with an LLM writing the final answer. The LLM is one of three, chosen by `INFERENCE_PROVIDER` in `.env`:

| Provider | `INFERENCE_PROVIDER` | Model | Good for |
| -------- | -------------------- | ----- | -------- |
| Gemini API | `gemini` | `gemini-3.5-flash-lite` | Easiest: just an API key, no model download. Free tier is limited to 15 requests/minute |
| Ollama (local) | `ollama` | `gemma4:e4b` | Fully offline; needs a 9.6 GB download and ~16 GB RAM |
| RunPod vLLM | `runpod` | your endpoint | Hosted GPU endpoint |

Each `/chat` request:

1. Embeds the question with `multi-qa-mpnet-base-cos-v1` and pulls the 6 closest chunks from Qdrant (collection `track2college_docs`).
2. Sends those chunks plus the question to the LLM.
3. Returns an answer with sources and up to 3 follow-up questions, and remembers the last 4 turns per `session_id`.

The transcript, course-plan and profile-analysis features use the same LLM.

```
Browser (frontend, :5500)
        │  POST /chat
        ▼
FastAPI backend (api.py, :8000)
        ├──► Qdrant (:6333) ........ finds the 6 most relevant chunks
        └──► LLM ................... writes the answer
             Gemini API  (INFERENCE_PROVIDER=gemini)
             Ollama :11434 (INFERENCE_PROVIDER=ollama)
             RunPod      (INFERENCE_PROVIDER=runpod)
```

## Prerequisites

| Tool    | Version tested | How to get it |
| ------- | -------------- | ------------- |
| Python  | 3.11 (pinned in `Track2Cllg/runtime.txt`) | `brew install python@3.11` |
| Qdrant  | 1.19.2 | Standalone binary, no Docker needed (below) |
| Node.js | 25.9 | Only for the frontend: `brew install node` |
| Gemini API key | — | Only for `gemini`: [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| Ollama  | 0.40.2 | Only for `ollama`: [ollama.com](https://ollama.com), then `ollama pull gemma4:e4b` (9.6 GB) |

Install Qdrant as a standalone binary (Apple Silicon build shown; use `x86_64-apple-darwin` on Intel Macs):

```bash
mkdir -p ~/qdrant && cd ~/qdrant
curl -L https://github.com/qdrant/qdrant/releases/download/v1.19.2/qdrant-aarch64-apple-darwin.tar.gz | tar xz
xattr -d com.apple.quarantine qdrant 2>/dev/null; ./qdrant --version
```

If you have Docker, `docker run -p 6333:6333 -v ~/qdrant/storage:/qdrant/storage qdrant/qdrant` works too.

## One-time setup

Create a virtual environment and install the Python packages. On macOS, skip `pysqlite3-binary`: it only ships Linux wheels, and only `evaluate_rag.py` uses it.

```bash
cd Track2College-RAG-ChatBot-Team-Godzilla/Track2Cllg
python3.11 -m venv .venv && source .venv/bin/activate
grep -v pysqlite3 requirements.txt > /tmp/req-mac.txt
pip install -r /tmp/req-mac.txt        # Linux: pip install -r requirements.txt
```

Copy `.env.example` to `.env` and fill it in. `.env` is gitignored; never commit it.

```bash
cp .env.example .env
```

| Variable | Gemini | Local (Ollama) | RunPod | Notes |
| -------- | ------ | -------------- | ------ | ----- |
| `API_KEY` | any secret | any secret | any secret | Required to start. Clients send it as `Authorization: Bearer <API_KEY>` on `/analyze` |
| `INFERENCE_PROVIDER` | `gemini` | `ollama` | `runpod` | Picks which LLM `query.py` calls |
| `GEMINI_API_KEY` | your key | not used | not used | The API refuses to start in Gemini mode without it |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | not used | not used | Optional; this is the default |
| `GEMINI_RPM` | `15` | not used | not used | Optional; requests per minute the backend allows itself (free tier: 15) |
| `OLLAMA_MODEL` | not used | `gemma4:e4b` | not used | Use `gemma4:e2b` if memory is tight |
| `OLLAMA_URL` | not used | `http://localhost:11434` | not used | Default works |
| `RunPod_API_Key` | not used | not used | runpod.io → Settings → API Keys | |
| `RUNPOD_ENDPOINT_URL` | not used | not used | `https://api.runpod.ai/v2/<ENDPOINT_ID>/runsync` | `query.py` reads this, not the ID |
| `RUNPOD_ENDPOINT_ID` | not used | not used | your endpoint ID | Only `api.py` reads this |
| `QDRANT_URL` | leave unset | leave unset | leave unset | Defaults to `http://localhost:6333` |

A minimal Gemini `.env`:

```bash
API_KEY=pick-any-secret
INFERENCE_PROVIDER=gemini
GEMINI_API_KEY=your-gemini-key
```

A minimal Ollama `.env`:

```bash
API_KEY=pick-any-secret
INFERENCE_PROVIDER=ollama
OLLAMA_MODEL=gemma4:e4b
```

### Gemini free-tier limit

The free tier allows 15 requests per minute. The backend counts its own requests and, when a 16th arrives within a minute, waits for a slot instead of letting Google reject it. If Google still returns 429, it waits 60 s and retries once. In practice:

- An answer can occasionally take up to a minute when the limit is hit. That is a wait, not a hang; the API terminal prints `[Gemini] 15 requests/min limit reached — waiting …`.
- Chat, transcript reading, course plans and profile analysis all share the same 15.
- The count is per process. Running `uvicorn --workers N` gives each worker its own count, so together they can exceed the limit.
- The free tier also has a daily request cap, which the backend does not track.

## Loading the data (once)

Qdrant starts empty, so the knowledge base is built once by running ingestion. The data is kept in `~/qdrant/storage`, so this does not repeat on restart.

1. **Start Qdrant** and leave it running in its own terminal:

   ```bash
   cd ~/qdrant && QDRANT__STORAGE__STORAGE_PATH=$HOME/qdrant/storage ./qdrant
   ```

2. **Get the scraped pages.** They are committed to the repo, so `git pull` is enough:
   - `Track2Cllg/outputs_aiohttp/` — one `.txt` file per page (1,494 files)
   - `Track2Cllg/scraped_metadata.json` — maps each file to its URL. Without it, answers cite `file://` paths instead of real links.

   You only need to re-scrape to pick up new or changed pages. `Track2Cllg/run_pipeline.py` is meant to do this, but it imports `scrap.py`, which is **not committed**. Do **not** use `URLScrapePipeline/scrape_pipeline.py` for this: it writes to a different folder, needs `OPENAI_API_KEY`, and rewrites `clgUrls.txt` without its comment lines. If you do re-scrape, agree with the team on who commits the new data, to avoid merge conflicts.

3. **Run ingestion** (clean → chunk → embed into Qdrant):

   ```bash
   cd Track2Cllg && source .venv/bin/activate
   python run_ingestion.py
   ```

   Expect 1,494 cleaned files and 17,418 chunks. Embedding uses an NVIDIA GPU or Apple Silicon (MPS) when present: about 15 minutes on an M3, over an hour on CPU only. The `delete failed ... doesn't exist` warnings on the first batch are expected. Ingestion does not call the LLM, so `INFERENCE_PROVIDER` does not matter here.

4. **Check the count** matches the chunk total:

   ```bash
   curl -s -X POST localhost:6333/collections/track2college_docs/points/count \
     -H 'Content-Type: application/json' -d '{"exact":true}'
   # {"result":{"count":17418},...}
   ```

   A count far below the chunk total means your `embed.py` predates commit `d1837a7`, which fixed chunks being deleted when a document spans two batches. Pull `main` and re-run step 3.

## Starting the backend (every time)

Use one terminal per process. `.env` is read when the API starts, so restart the API after changing it.

With `INFERENCE_PROVIDER=ollama`, Ollama must also be running. It runs as a Mac app and usually starts on its own; check with `curl localhost:11434/api/version`. Gemini and RunPod need nothing extra running locally.

```bash
# Terminal 1 — Qdrant
cd ~/qdrant && QDRANT__STORAGE__STORAGE_PATH=$HOME/qdrant/storage ./qdrant

# Terminal 2 — API (http://localhost:8000)
cd Track2College-RAG-ChatBot-Team-Godzilla/Track2Cllg
source .venv/bin/activate
python api.py

# Terminal 3 — frontend (http://localhost:5500)
cd Track2College-RAG-ChatBot-Team-Godzilla/frontend
npm install        # first time only
npm run dev
```

Then open http://localhost:5500.

## Verifying it works

1. Health check — `inference_provider` should match your `.env`:

   ```bash
   curl localhost:8000/health
   # {"status":"ok","service":"track2college-rag-api","inference_provider":"gemini",...}
   ```

2. A real question:

   ```bash
   curl -X POST localhost:8000/chat -H "Content-Type: application/json" \
     -d '{"query": "What are the admission requirements for Santa Clara University?"}'
   ```

   The `answer` field should have three sections — `Answer:`, `Sources:` (e.g. `https://www.scu.edu/admission/undergraduate`) and `Follow-up Questions you might have:`. With Ollama, the first request took 55 s on an M3 because Gemma loads into memory; later ones are faster.

3. Interactive API docs: http://localhost:8000/docs.

## Stopping the backend

Your data is safe either way: Qdrant keeps it in `~/qdrant/storage`, so the next start picks up where you left off.

**Started in terminals** (as above): press **Ctrl+C** in each one — frontend, API, then Qdrant.

**Started in the background, or the terminal is gone** (for example, launched by an editor or agent session that has since closed): stop whatever holds each port.

```bash
lsof -ti tcp:5500 | xargs kill   # frontend (Vite)
lsof -ti tcp:8000 | xargs kill   # API (FastAPI)
lsof -ti tcp:6333 | xargs kill   # Qdrant
```

**Ollama** (only if you use it) usually needs nothing: it unloads the model after 5 minutes idle. To free the memory right away, or quit it entirely:

```bash
ollama stop gemma4:e4b                # unload the model now
osascript -e 'quit app "Ollama"'      # quit the Ollama app (or menu bar icon → Quit)
```

Check that everything is off — this should print nothing:

```bash
lsof -nP -iTCP:5500,8000,6333 -sTCP:LISTEN
```

## Troubleshooting

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| `pip` fails on `pysqlite3-binary` | Linux-only package | Install with it filtered out (One-time setup) |
| `RuntimeError: Missing API_KEY in .env` | `.env` missing or empty `API_KEY` | Set `API_KEY` in `Track2Cllg/.env` |
| `RuntimeError: Gemini mode requires GEMINI_API_KEY in .env` | `INFERENCE_PROVIDER=gemini` but no key | Set `GEMINI_API_KEY` in `Track2Cllg/.env` |
| `RuntimeError: INFERENCE_PROVIDER must be one of …` | Typo in `INFERENCE_PROVIDER` | Use `gemini`, `ollama`, `runpod`, `local` or `auto` |
| `/health` shows the wrong provider | API started before `.env` was changed | Restart `python api.py` |
| Frontend says the server is unreachable | API not running, or page not on port 5500 | Start `python api.py`; the API only accepts browser requests from `localhost:5500` / `127.0.0.1:5500` |
| `npm run dev` fails: port 5500 in use | Another server on 5500 | Stop it; Vite is locked to 5500 to match the API's CORS list |
| Laptop freezes, answers time out | Model + embeddings exceed RAM on 16 GB | Switch to `INFERENCE_PROVIDER=gemini`, or use `OLLAMA_MODEL=gemma4:e2b`; close other apps; don't run ingestion and the API at the same time |
| Every answer is the "I can only help with…" fallback | Qdrant empty or not running, or the LLM returned nothing | Check the point count (Loading the data, step 4) and the API terminal for `[Gemini]` / `[ollama]` / `[RunPod]` errors |
| `[Gemini] Request error … 400` or `403` | Invalid or restricted API key | Check `GEMINI_API_KEY`; create a new key in AI Studio |
| `[Gemini] Request error … 404` | Wrong model name | Unset `GEMINI_MODEL` to use the default `gemini-3.5-flash-lite` |
| Gemini answers sometimes take ~60 s | 15 requests/minute limit reached | Expected on the free tier (see Gemini free-tier limit) |
| Gemini fails all day after heavy use | Free-tier daily cap reached | Wait for the daily reset, or switch provider |
| RunPod mode returns nothing | `RUNPOD_ENDPOINT_URL` unset or a placeholder | Set it to `https://api.runpod.ai/v2/<ENDPOINT_ID>/runsync`; `query.py` ignores `RUNPOD_ENDPOINT_ID` |
| `run_pipeline.py` fails with `No module named 'scrap'` | `scrap.py` not committed | Use the committed scrape data and run `python run_ingestion.py` |
