# ToneLens

**The words say what. The voice says how.**

ToneLens is a multilingual, prosody-aware speech understanding platform. It transcribes speech
(English, Hindi, Hinglish and ~90 other languages), measures *how* it was said (pitch contour,
loudness dynamics, pauses, pace and word-level emphasis), and asks an LLM for carefully qualified
interpretations. It flags when the words and the delivery point different ways.

It is **not an emotion detector.** Measurements are observations; interpretations are hypotheses.

## What's inside

| Area | Feature |
|---|---|
| **Studio** | Record in the browser with a live pitch trail (in-browser YIN, zero latency), rising/falling cue and note readout. Or drag-and-drop audio. Mic auto-gain and noise suppression are disabled so loudness dynamics survive. |
| **Analysis** | Interactive timeline (pitch, energy, pauses, word lane, synced playhead; click to seek, click a word to hear it). Emphasis-shaded transcript, 8 metrics, word table, export (Markdown / JSON / CSV). |
| **Interpretation** | Groq (`openai/gpt-oss-120b` by default, set `TONELENS_GROQ_MODEL` to change), strict JSON schema, prosody–text disagreement banner, and an **A/B toggle against a text-only baseline** (System A vs B). |
| **Voice profiles** | Calibrate on neutral sentences. Later analyses are reported relative to *your* baseline ("+3 st above your usual pitch, 1.3× your usual pace"). |
| **Delivery fingerprint** | 8-dimension vector per recording (radar), similarity search ("similar deliveries"). |
| **Compare** | Overlay 2–6 speaker- and time-normalised contours and fingerprints, with pairwise similarity. |
| **Delivery Gym** | Use any recording as a target and imitate it. DTW-aligned contour scoring (pitch shape, loudness, pace, range, emphasis) with concrete tips and progress history. |
| **Research lab** | Label speech acts, run both systems, and get accuracy per system and per language: the H1 experiment, built in. |

## Architecture

```
frontend/  React 18 + Vite + TypeScript + Tailwind 4 + TanStack Query + framer-motion
backend/
  tonelens/core/      audio_io · speech (faster-whisper) · prosody · fingerprint · drills · interpreter
  tonelens/pipeline   decode → transcribe → measure → baseline-relative → fingerprint → drill score
  tonelens/jobs       queue: inline thread pool  |  Redis (reliable BLMOVE + heartbeats + reaper)
  tonelens/worker     standalone worker process for Redis mode
  tonelens/api        FastAPI: REST + SSE progress, serves the built SPA in production
  tonelens/db         SQLModel: SQLite (WAL) by default, Postgres via TONELENS_DATABASE_URL
```

**Scaling.** Uploads are hashed and queued, so the API never blocks on ML. In Redis mode, any number
of workers on any number of machines share the queue, database and data volume. Each job moves
atomically into a worker's processing list, and if a worker dies its heartbeat expires and its jobs
are requeued. Identical audio with the same ASR settings reuses previous results instead of
re-running Whisper. Progress streams over Server-Sent Events; the frontend code-splits per route.

## Run locally (dev)

Requires Python 3.11+, Node 20+, and `ffmpeg`.

```bash
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
cp .env.example .env                    # add GROQ_API_KEY (optional: everything except interpretation works without it)
.venv/bin/uvicorn --app-dir backend tonelens.api.main:app --reload --port 8000
cd frontend && npm install && npm run dev   # http://localhost:5173
```

The first analysis downloads the Whisper model. For Hindi/Hinglish use `small` or `medium`
(choose under **ASR** in the Studio, or set `TONELENS_WHISPER_MODEL`).

## Deploy (scalable)

```bash
docker compose up --build                  # API (4 procs) + 2 workers + Redis + Postgres → http://localhost:8000
docker compose up -d --scale worker=6      # add capacity
```

## Configuration

| Variable | Default | |
|---|---|---|
| `GROQ_API_KEY` | (none) | enables interpretation |
| `TONELENS_GROQ_MODEL` | `openai/gpt-oss-120b` | any Groq chat model with JSON mode |
| `TONELENS_QUEUE` | `inline` | `inline` or `redis` |
| `TONELENS_REDIS_URL` | `redis://localhost:6379/0` | |
| `TONELENS_DATABASE_URL` | SQLite in data dir | e.g. `postgresql+psycopg://…` |
| `TONELENS_WORKERS` | `2` | concurrent jobs per process |
| `TONELENS_WHISPER_MODEL` | `base` | `tiny` / `base` / `small` / `medium` |
| `TONELENS_DATA_DIR` | `backend/data` | audio + SQLite |
| `TONELENS_MAX_UPLOAD_MB` / `TONELENS_MAX_DURATION_S` | `50` / `300` | limits |

## Tests

```bash
cd backend && ../.venv/bin/python -m pytest -q     # prosody maths + full API flows (Whisper stubbed)
cd frontend && npx tsc -b                          # typecheck
```

API docs: <http://localhost:8000/docs>. The original Streamlit prototype is kept at `backend/streamlit_app.py`.

## Method notes and limits

- Pitch: YIN with an energy mask and octave-error trimming. This approximates voicing; noisy audio and creaky voice degrade it.
- Emphasis: per-word pitch, loudness and lengthening z-scored within the utterance (needs ≥ 3 words).
- The LLM receives numeric summaries (utterance, word-level and baseline-relative), not raw audio.
- Drill scores compare *shape*, normalised per speaker; they are a practice aid, not an assessment.

## Research directions

Learned acoustic representations, cross-session speaker normalisation, cross-lingual prosodic
transfer (Hindi ↔ English ↔ Hinglish), and human-annotated evaluation at scale through the Research lab.
