LLM:
ollama serve

QDRANT:
cd ~/qdrant && QDRANT__STORAGE__STORAGE_PATH=$HOME/qdrant/storage ./qdrant

BACKEND:
cd ~/Desktop/Track2College-RAG-ChatBot-Team-Godzilla/Track2Cllg
source .venv/bin/activate
python api.py

FRONTEND:
cd ~/Desktop/Track2College-RAG-ChatBot-Team-Godzilla/frontend
npm run dev