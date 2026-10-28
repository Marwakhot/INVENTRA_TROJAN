# Inventra

AI-assisted inventory planning for a fictional UAE B2B seller (GulfTrade Supplies): what stock to move, reorder or hold, where, when and why, with every number traced to source data. The system recommends; the planner decides.

## Live demo

| | Link |
|---|---|
| **App** | https://YOUR-APP.vercel.app |
| API docs (interactive) | https://inventra-api-wyqe.onrender.com/docs |

The hosted app is one shared workspace: approvals and uploads made by one visitor are visible to the next. **Reset demo** (page footer) restores the seeded dataset at any time. The API runs on a free plan that sleeps when idle, so the first load can take up to a minute while it wakes and builds the plan.

## Run it locally

You need Python 3.9 to 3.12. The app runs fully without an LLM key ("keyless" mode); to enable AI explanations, copy `inventra-backend/.env.example` to `inventra-backend/.env` and fill in the three `LLM_` settings.

**macOS / Linux**
```bash
cd inventra-backend && make setup     # creates .venv and installs dependencies
cd ../inventra-frontend && ./start.sh # API on 127.0.0.1:8000, UI on http://localhost:3000
```

**Windows (PowerShell)**: two terminals.
```powershell
# terminal 1: API
cd inventra-backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn inventra.api.main:app --host 127.0.0.1 --port 8000

# terminal 2: UI
cd inventra-frontend
python serve.py 3000
```

Then open **http://localhost:3000** (use `localhost`, not `127.0.0.1`).

**Docker (API only)**: `cd inventra-backend && docker compose up -d --build`, then serve the UI as above.

**Tests**: `cd inventra-backend` then `make test` (or `.\.venv\Scripts\python.exe -m pytest -q tests` on Windows).

## What is in this repo

| Folder | What it is |
|---|---|
| [`inventra-backend/`](inventra-backend/) | Python engine, watcher, LLM layer (optional) and FastAPI API. Synthetic seed data, generator, judges' checklist and answer key, tests. |
| [`inventra-frontend/`](inventra-frontend/) | The Inventra UI, wired to the API. It computes nothing in the browser. |

All data is synthetic. No credentials or real buyer or supplier data are included.
