# defence_hack

Repository initialized with a split backend/frontend structure.

## Structure

- `backend/` (Python)
  - `src/api/` FastAPI endpoints for frontend consumption
  - `src/service/` feature-oriented service modules (one file per feature)
- `frontend/` (Vite + React)

## Run backend

```bash
cd backend
pip install -r requirements.txt
uvicorn backend.src.api.main:app --reload
```

## Run frontend

```bash
cd frontend
npm install
npm run dev
```
