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

## Deploy on Vercel

This repository is now intended for a split deployment:

- Frontend on Vercel
- Backend on Render

Use the root `vercel.json` for the frontend app only, and deploy the FastAPI backend from `backend/` on Render.

Frontend environment variables on Vercel:

- `VITE_MAPTILER_KEY` for the frontend map tiles
- `VITE_API_BASE_URL` set to the Render backend URL, for example `https://defence-backend.onrender.com`
- `VITE_OPS_PASSWORD` if you keep the operations login gate enabled

Notes:

- Render should provide `REDIS_URL` and a persistent disk mount for `DATA_ROOT` if you want AOI results to survive restarts.
- The backend health endpoint is `GET /health`.
- `render.yaml` in the repo root deploys the backend from `backend/Dockerfile` plus a Redis service.
