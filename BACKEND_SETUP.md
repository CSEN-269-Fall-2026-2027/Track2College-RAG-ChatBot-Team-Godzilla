# Track2College Backend Setup

How to set up and start the RAG chatbot backend locally. Tested 2026-10-09 on an Apple M3 with 16 GB RAM.

## Overview

The backend is a FastAPI app (`Track2Cllg/api.py`) that answers questions using scraped college pages stored in a local Qdrant database, with an LLM writing the final answer. It runs fully on a laptop with Ollama, or calls a RunPod GPU endpoint instead.

Each `/chat` request:

1. Embeds the question with `multi-qa-mpnet-base-cos-v1` and pulls the 6 closest chunks from Qdrant (collection `track2college_docs`).
2. Sends those chunks plus the question to the LLM: Ollama (`gemma4:e4b`) or RunPod vLLM, chosen by `INFERENCE_PROVIDER`.
3. Returns an answer with sources and up to 3 follow-up questions, and remembers the last 4 turns per `session_id`.

```
Browser (frontend, :5500)
        │  POST /chat
        ▼
FastAPI backend (api.py, :8000)
        ├──► Qdrant (:6333) ........ finds the 6 most relevant chunks
        └──► Ollama (:11434) ....... writes the answer   (or RunPod, if INFERENCE_PROVIDER=runpod)
```

## Prerequisites

| Tool    | Version tested | How to get it |
| ------- | -------------- | ------------- |
| Python  | 3.11 (pinned in `Track2Cllg/runtime.txt`) | `brew install python@3.11` |
| Ollama  | 0.40.2 | [ollama.com](https://ollama.com), then `ollama pull gemma4:e4b` (9.6 GB) |
| Qdrant  | 1.19.2 | Standalone binary, no Docker needed (below) |
| Node.js | 25.9 | Only for the frontend: `brew install node` |

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

On Apple Silicon, make sure this is a native ARM64 Python environment. Check the active interpreter with:

```bash
python -c 'import platform, sys; print(platform.machine(), sys.executable)'
```

It should report `arm64`. If it reports `x86_64`, install/use an Apple Silicon Python and recreate `.venv`; a virtual environment keeps the architecture of the Python that created it. Python on Apple Silicon can run as `arm64` or `x86_64`, and only a native setup can use PyTorch's MPS backend. [PyTorch MPS documentation](https://docs.pytorch.org/docs/stable/notes/mps.html)

Transformers also requires PyTorch 2.6 or newer. If the active environment has an older version, update it explicitly before ingestion:

```bash
python -m pip install --upgrade 'torch>=2.6.0'
python -c 'import torch; print(torch.__version__)'
```

Copy `.env.example` to `.env` and fill it in. `.env` is gitignored; never commit it.

```bash
cp .env.example .env
```

| Variable | Local (Ollama) | RunPod | Notes |
| -------- | -------------- | ------ | ----- |
| `API_KEY` | any secret | any secret | Required to start. Clients send it as `Authorization: Bearer <API_KEY>` on `/analyze` |
| `INFERENCE_PROVIDER` | `ollama` | `runpod` | Picks which LLM `query.py` calls |
| `OLLAMA_MODEL` | `gemma4:e4b` | not used | Use `gemma4:e2b` if memory is tight |
| `OLLAMA_URL` | `http://localhost:11434` | not used | Default works |
| `RunPod_API_Key` | not needed | runpod.io → Settings → API Keys | |
| `RUNPOD_ENDPOINT_URL` | not needed | `https://api.runpod.ai/v2/<ENDPOINT_ID>/runsync` | `query.py` reads this, not the ID |
| `RUNPOD_ENDPOINT_ID` | not needed | your endpoint ID | Only `api.py` reads this |
| `QDRANT_URL` | leave unset | leave unset | Defaults to `http://localhost:6333` |

A minimal local `.env`:

```bash
API_KEY=pick-any-secret
INFERENCE_PROVIDER=ollama
OLLAMA_MODEL=gemma4:e4b
```

## Loading the data (once)

Qdrant starts empty, so the knowledge base is built once: scrape the pages, then run ingestion. The data is kept in `~/qdrant/storage`, so this does not repeat on restart.

1. **Start Qdrant** and leave it running in its own terminal:

   ```bash
   cd ~/qdrant && QDRANT__STORAGE__STORAGE_PATH=$HOME/qdrant/storage ./qdrant
   ```

2. **Scrape the URLs** in `URLScrapePipeline/clgUrls.txt` (1,682 URLs). Ingestion expects:
   - `Track2Cllg/outputs_aiohttp/` — one `.txt` file per page
   - `Track2Cllg/scraped_metadata.json` — maps each file to its URL. Without it, answers cite `file://` paths instead of real links.

   `Track2Cllg/run_pipeline.py` is meant to do this, but it imports `scrap.py`, which is **not committed**. Until it is, use the stand-in scraper from this setup (not yet in the repo).

   Do **not** use `URLScrapePipeline/scrape_pipeline.py` for this: it writes to a different folder, needs `OPENAI_API_KEY`, and rewrites `clgUrls.txt` without its comment lines.

   Expect about 1,494 pages saved and 188 skipped (empty pages, 404s, rate limits).

3. **Run ingestion** (clean → chunk → embed into Qdrant):

   ```bash
   cd Track2Cllg && source .venv/bin/activate
   python run_ingestion.py
   ```

   Expect 1,494 cleaned files and 17,418 chunks. Embedding uses an NVIDIA GPU or Apple Silicon (MPS) when present: about 15 minutes on an M3, over an hour on CPU only. The `delete failed ... doesn't exist` warnings on the first batch are expected.

4. **Check the count** matches the chunk total:

   ```bash
   curl -s -X POST localhost:6333/collections/track2college_docs/points/count \
     -H 'Content-Type: application/json' -d '{"exact":true}'
   # {"result":{"count":17418},...}
   ```

   A count far below the chunk total means your `embed.py` predates commit `d1837a7`, which fixed chunks being deleted when a document spans two batches. Pull `main` and re-run step 3.

## Starting the backend (every time)

Use one terminal per process. Ollama runs as a Mac app and usually starts on its own; check with `curl localhost:11434/api/version`.

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
   # {"status":"ok","service":"track2college-rag-api","inference_provider":"ollama",...}
   ```

2. A real question:

   ```bash
   curl -X POST localhost:8000/chat -H "Content-Type: application/json" \
     -d '{"query": "What are the admission requirements for Santa Clara University?"}'
   ```

   The `answer` field should have three sections — `Answer:`, `Sources:` (e.g. `https://www.scu.edu/admission/undergraduate`) and `Follow-up Questions you might have:`. The first request took 55 s on an M3 because Gemma loads into memory; later ones are faster.

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

**Ollama** usually needs nothing: it unloads the model after 5 minutes idle. To free the memory right away, or quit it entirely:

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
| `PyTorch >= 2.6 is required` or Transformers says PyTorch is disabled | Installed torch is older than 2.6 | Run `python -m pip install --upgrade 'torch>=2.6.0'` in the same virtual environment used for `run_ingestion.py` |
| MPS is unavailable on an Apple Silicon Mac | Python or PyTorch is running as x86_64 | Check `platform.machine()`; recreate `.venv` with native ARM64 Python, then reinstall requirements |
| `RuntimeError: Missing API_KEY in .env` | `.env` missing or empty `API_KEY` | Set `API_KEY` in `Track2Cllg/.env` |
| Frontend says the server is unreachable | API not running, or page not on port 5500 | Start `python api.py`; the API only accepts browser requests from `localhost:5500` / `127.0.0.1:5500` |
| `npm run dev` fails: port 5500 in use | Another server on 5500 | Stop it; Vite is locked to 5500 to match the API's CORS list |
| Laptop freezes, answers time out | Model + embeddings exceed RAM on 16 GB | Use `OLLAMA_MODEL=gemma4:e2b`; close other apps; don't run ingestion and the API at the same time |
| Every answer is the "I can only help with…" fallback | Qdrant empty or not running, or the LLM returned nothing | Check the point count (Loading the data, step 4) and the API terminal for `[ollama]` / `[RunPod]` errors |
| RunPod mode returns nothing | `RUNPOD_ENDPOINT_URL` unset or a placeholder | Set it to `https://api.runpod.ai/v2/<ENDPOINT_ID>/runsync`; `query.py` ignores `RUNPOD_ENDPOINT_ID` |
| `run_pipeline.py` fails with `No module named 'scrap'` | `scrap.py` not committed | Scrape separately (Loading the data, step 2), then `python run_ingestion.py` |
