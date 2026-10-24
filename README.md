# Track2College RAG Chatbot — Team Godzilla

A college-admissions chatbot for CSEN 269. It answers questions using scraped college web pages (retrieval-augmented generation): the question is matched against a Qdrant vector database of page chunks, and an LLM writes the answer with sources and follow-up questions. It also reads transcripts, drafts course plans and analyzes student profiles.

## Repo layout

| Path | What it is |
| ---- | ---------- |
| `Track2Cllg/` | Python backend: FastAPI app (`api.py`), retrieval and LLM calls (`query.py`), ingestion pipeline (`ingestion/`, `run_ingestion.py`) |
| `Track2Cllg/outputs_aiohttp/`, `Track2Cllg/scraped_metadata.json` | Scraped college pages, committed so you don't need to scrape |
| `frontend/` | Vite + TypeScript web app (http://localhost:5500) |
| `Track2Cllg/deployment/` | systemd service and timer for running the pipeline on a schedule |
| `URLScrapePipeline/` | URL list (`clgUrls.txt`) and an older scraper |
| `supabase/` | Database schema |

## LLM providers

Set `INFERENCE_PROVIDER` in `Track2Cllg/.env`:

- **`gemini`** — Gemini API, `gemini-3.5-flash-lite`. Easiest to set up: just a `GEMINI_API_KEY`. Free tier is limited to 15 requests/minute; the backend throttles itself to stay under it.
- **`ollama`** — local `gemma4:e4b` via Ollama. Fully offline; needs a 9.6 GB model and ~16 GB RAM.
- **`runpod`** — a RunPod vLLM serverless endpoint.

## Quick start

Full instructions, including installing Qdrant and loading the data: **[BACKEND_SETUP.md](BACKEND_SETUP.md)**.

```bash
# One time
cd Track2Cllg
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt          # macOS: filter out pysqlite3 (see setup doc)
cp .env.example .env                     # set API_KEY, INFERENCE_PROVIDER=gemini, GEMINI_API_KEY
python run_ingestion.py                  # with Qdrant running; builds the vector database

# Every time (one terminal each)
cd ~/qdrant && QDRANT__STORAGE__STORAGE_PATH=$HOME/qdrant/storage ./qdrant
cd Track2Cllg && source .venv/bin/activate && python api.py
cd frontend && npm install && npm run dev
```

Then open http://localhost:5500. Check `curl localhost:8000/health` shows the provider you chose.
