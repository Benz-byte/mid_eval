# Auto Scheduler

Electron and React desktop application for viewing CCS schedules, managing room
events, and creating student-assistant duty schedules with a local Flask and
OR-Tools backend. Supabase stores the shared schedule data.

## Requirements

- Node.js 18 or newer
- Python 3.10 or newer

## Setup

```powershell
npm install
```

The post-install script installs the packages in `backend/requirements.txt`.
Configure the tracked `.env` with a Supabase URL and publishable key:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
```

Use only a publishable key. Never place a service-role key or database password
in the desktop application repository.

## Run

```powershell
npm run dev
```

This starts Vite at `http://localhost:5173`, Electron, and Flask at
`http://127.0.0.1:5000`. The Flask health check is `GET /api/health`.

## Build

```powershell
npm run build
```

Use `npm run dist:win`, `npm run dist:mac`, or `npm run dist:linux` to package
the desktop application.

## Architecture

```text
React UI
├── localStorage → immediate local fallback
└── Flask API
    ├── services  → parsing, validation, and regular processing
    ├── Supabase  → shared schedule and event CRUD
    └── CP-SAT    → student-assistant optimization
```

## Supabase migrations

Run these files in order through **Supabase Dashboard → SQL Editor**:

1. `database/supabase/migrations/001_shared_schedule.sql`
2. `database/supabase/migrations/002_admin_events.sql`
3. `database/supabase/migrations/003_student_assistant_schedules.sql`

## Important folders

- `frontend/src/ui/` — React screens, components, and styles
- `frontend/src/api/` — HTTP calls to Flask
- `frontend/src/storage/` — local device cache and preferences
- `frontend/src/desktop/` — Electron main and preload processes
- `backend/routes/` — Flask API endpoints
- `backend/services/` — parsing and business processing
- `backend/database/supabase/` — Supabase CRUD repositories
- `backend/solver/` — CP-SAT optimization
- `database/supabase/migrations/` — SQL database definitions
- `samples/` — example schedule files
- `scripts/` — setup and conflict-check commands
- `docs/EXPLANATION.md` — detailed project guide
