# defence_hack

Repository initialized with a split backend/frontend structure.

## Structure

- `backend/` (Python)
  - `src/api/` FastAPI endpoints for frontend consumption
  - `src/service/` feature-oriented service modules (one file per feature)
- `frontend/` (Vite + React)

## Run backend

### With uv

```bash
cd backend
uv sync
uv run uvicorn src.api.main:app --reload
```

### Without uv/docker

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn src.api.main:app --reload
```

### With Docker

```bash
cd backend
docker compose up --build
```

## Run frontend

```bash
cd frontend
npm install
npm run dev
```
