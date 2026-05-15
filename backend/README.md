# Backend

Python FastAPI backend.

## Structure

- `src/api`: API endpoints used by the frontend.
- `src/service`: Feature-specific services (one file per feature).

## Run

```bash
pip install -r requirements.txt
uvicorn backend.src.api.main:app --reload
```
