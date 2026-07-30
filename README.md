# Auto Scheduler

Electron and React desktop application for viewing CCS schedules, adding room
events, and sharing schedule data through Supabase. A minimal Flask service is
included as the integration point for the new CP-SAT solver.

## Requirements

- Node.js 18 or newer
- Python 3.10 or newer

## Setup

```powershell
npm install
python -m pip install -r python\requirements.txt
```

Copy `.env.example` to `.env.local` and add the Supabase project values:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
```

Use only a Supabase publishable key. Do not place a secret or service-role key
in the frontend environment file.

## Run

```powershell
npm run dev
```

This starts:

- Vite at `http://localhost:5173`
- Electron
- Flask at `http://127.0.0.1:5000`

The Flask health check is available at `GET /api/health`.

## Build

```powershell
npm run build
```

Use `npm run dist:win`, `npm run dist:mac`, or `npm run dist:linux` to create a
desktop distribution for the corresponding platform.

## Current architecture

```text
React UI
├── Supabase → shared schedule persistence and realtime updates
└── Flask   → reserved for the new CP-SAT solver API
```

The old SQLite persistence code and old solver placeholders have been removed.
When the new solver is added, place its Python modules under `python/` and
register its HTTP endpoint in `python/app.py`.

## Important files

- `src/ui/App.tsx` — schedule and event interface
- `src/api/scheduleRepository.ts` — Supabase schedule reads and writes
- `database/supa/supabase.ts` — Supabase client
- `database/supa/migrations/001_shared_schedule.sql` — database schema
- `python/app.py` — minimal Flask service
- `src/electron/main.ts` — Electron process and Flask lifecycle
