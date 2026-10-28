# Inventra

AI-assisted inventory planning for a UAE B2B seller: what stock to move, reorder or hold, where, when and why, with every number traced back to its source data. The system recommends; the planner decides.

## Try it online

**App: https://inventra-nine-ochre.vercel.app**

API docs: https://inventra-api-wyqe.onrender.com/docs

- The first load can take up to a minute while the server wakes up.
- Everyone shares one demo workspace. Click **Reset demo** (page footer) to start fresh.

## Run it locally

You need **Python 3.9 to 3.12**. Download or clone this repo, then:

### Windows (PowerShell)

Terminal 1, the API:
```powershell
cd inventra-backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn inventra.api.main:app --host 127.0.0.1 --port 8000
```

Terminal 2, the app:
```powershell
cd inventra-frontend
python serve.py 3000
```

### macOS / Linux

```bash
cd inventra-backend && make setup
cd ../inventra-frontend && ./start.sh
```

Then open **http://localhost:3000** (use `localhost`, not `127.0.0.1`).

### Optional: AI explanations

Everything works without an AI key. To turn on AI explanations and typed questions, copy `inventra-backend/.env.example` to `inventra-backend/.env` and set `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL` (any OpenRouter model). Restart the API.

### Run the tests

```bash
cd inventra-backend
make test          # Windows: .\.venv\Scripts\python.exe -m pytest -q tests
```

## What's inside

| Folder | Contents |
|---|---|
| `inventra-backend/` | Python planning engine, file watcher, AI layer and FastAPI API, with synthetic data and tests |
| `inventra-frontend/` | The web app (plain HTML and JavaScript) |

All data is synthetic. No real buyer or supplier data is included.
