# Auto Scheduler

Electron and React desktop application for viewing CCS schedules and adding
room events. The interface opens independently, then reads schedule data from
Supabase and plots it on the calendar.

## Requirements

- Node.js 18 or newer
- Python 3.10 or newer

## Setup

```powershell
npm install
```

`npm install` installs both the JavaScript and Python packages.

Before sharing the repository, the owner must add the public Supabase project
values to the tracked `.env` file:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_your_key
```

Use only a Supabase publishable key. Do not place a secret or service-role key
in the frontend environment file. Once these values are committed,
collaborators do not need to create or edit an environment file.

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
├── localStorage → fallback copy for the current device
├── Supabase     → shared CSV schedule and admin events
└── Flask        → reserved for the future CP-SAT solver
```

The interface continues working if Supabase or the internet is unavailable; it
shows locally saved data or an empty calendar instead of a blank window.
Manually added events use one Supabase row per event, so create, edit, and
delete actions synchronize across running devices. Uploading or removing a CSV
also updates `shared_schedules`, so every device plots the same class schedule.
When the new solver is added, place its Python modules under `python/` and
register its HTTP endpoint in `python/app.py`.

## Required Supabase migrations

Run these files once, in order, through **Supabase Dashboard → SQL Editor**:

1. `database/supa/migrations/001_shared_schedule.sql`
2. `database/supa/migrations/002_admin_events.sql`

The second migration creates the realtime `admin_events` table and copies
events from the legacy JSON array.

## Important files

- `src/ui/App.tsx` — schedule and event interface
- `src/api/scheduleRepository.ts` — shared CSV schedule loading and saving
- `database/supa/supabase.ts` — Supabase client
- `database/supa/migrations/001_shared_schedule.sql` — database schema
- `database/supa/migrations/002_admin_events.sql` — synchronized event schema
- `python/app.py` — Flask shell for the future solver
- `src/electron/main.ts` — Electron process and Flask lifecycle
