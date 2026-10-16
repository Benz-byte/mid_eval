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

## Schedule imports

Schedule uploads accept the original CSV template and Excel course-offering
reports (`.xls`/`.xlsx`), detected by their labels. Reports must include
`Stub No.`, `Course No. & Description`, `Time`, `Day`, `Room`, `Teacher`, and
`Credits`. Section headings and semester/year metadata are retained. Identical
shared meetings are combined across sections, while lecture/lab meetings remain
separate. Invalid times, including end-before-start and `0000-0000`, appear in
TBA with their original values and do not create calendar meetings.

Run `npm run test:schedule-import` to check both formats. To check an additional
file without saving it, run `node scripts/test-schedule-import.mjs "path/to/report.xls"`.

## Build

```powershell
npm run build
```

Use `npm run dist:win`, `npm run dist:mac`, or `npm run dist:linux` to package
the desktop application. Each distribution command first uses PyInstaller to
bundle Flask, CP-SAT, the Python runtime, and their dependencies into a
standalone backend executable. End users do not need to install Node.js,
Python, Flask, or OR-Tools.

The Windows build creates a portable `.exe` and an `.msi` installer in
`dist/`. The packaged backend runs privately on `127.0.0.1` and is started and
stopped automatically by Electron.

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
4. `database/supabase/migrations/004_admin_event_assistants.sql`
5. `database/supabase/migrations/005_duty_break_setting.sql`
6. `database/supabase/migrations/006_admin_event_descriptions.sql`
7. `database/supabase/migrations/007_schedule_archives.sql`
8. `database/supabase/migrations/008_csv_scoped_events.sql`
9. `database/supabase/migrations/009_unique_archive_names.sql`

Events are saved per schedule content fingerprint, including event assistant
assignments and their overtime totals. Uploading the identical file restores its
events (even if renamed); changing file contents gives it a different identifier.
Removing the CSV hides, rather than deletes, its events. Apply migration 008 for
cloud persistence of this identifier. Unscoped older shared events are retained
but hidden because their originating CSV is unknown; existing archives stay intact.

## Appearance

The sun/moon button beside the main tabs switches light/dark mode throughout the
app, including dialogs and archive previews. Dark is the initial default. The
preference is saved on this device only and does not change schedules, cloud data,
or Excel export colors. Run `node scripts/test-theme.mjs` for storage and contrast
checks; `scripts/theme-ui-smoke.cjs` provides an isolated Electron render test with
synthetic fixtures and mocked backend calls.

## Student assistant rosters

Student assistant rosters and uploaded personal class schedules are scoped to the
CSV content fingerprint, just like duty results and events. New files start with
an empty roster; reopening an identical file restores its saved roster. Existing
shared profiles are retained separately until the user chooses **Link previous
assistants to this CSV** and confirms the target. Roster maps sync in the existing
student-assistant JSON result envelope, so no additional SQL migration is needed.
Restart the backend to enable the updated roster synchronization.
Old shared cloud records are preserved even when an empty local snapshot syncs
first. Link them explicitly from the Student Assistant tab. Roster revision IDs
prevent older roster snapshots from overwriting newer additions; a backend
capability acknowledgement keeps saves queued if an outdated backend is running.

## Archives

In Schedule, open **Archives** to save the current setup or view earlier snapshots.
Each archive includes the schedule, assistants and personal classes, generated and
manual duties, events, exam dates, relievers, and settings. Preview is read-only;
**Exit Archive** returns to the current work without replacing it.

The save form has one **Save** button, which returns to Upload Schedule after
the local archive commits successfully. Closing
does not delete that CSV's saved events or duty assignments. Viewing an archive
never activates its CSV; exiting returns to the schedule or upload screen that
was open before previewing it.

Active archive names must be unique, ignoring capitalization and extra spaces.
Duplicate saves leave the form and current schedule open. Deleted archive names
can be reused. Apply migration 009 for database-level enforcement across devices;
if older duplicates exist, review them in Archives before running the migration.
Offline devices cannot check names they have not synchronized yet.

Archives are saved locally in a separate IndexedDB database, then synchronized to
Supabase. Apply migration 007 and restart the backend to enable cloud syncing.
Pending local saves stay available on the saving device if the network is down.

## Important folders

- `frontend/src/ui/` — React screens, components, and styles
- `frontend/src/api/` — HTTP calls to Flask
- `frontend/src/storage/` — local device cache and preferences
- `frontend/src/formatters/` — shared date, time, name, and workload helpers
- `frontend/src/export/` — Excel workbook generation and downloads
- `frontend/src/desktop/` — Electron main and preload processes
- `backend/routes/` — Flask API endpoints
- `backend/services/` — parsing and business processing
- `backend/database/supabase/` — Supabase CRUD repositories
- `backend/solver/` — CP-SAT optimization
- `database/supabase/migrations/` — SQL database definitions
- `samples/` — example schedule files
- `scripts/` — setup and conflict-check commands
- `docs/EXPLANATION.md` — detailed project guide
- `docs/CODE_STRUCTURE.md` — folder conventions and where to make changes

## Checks

```powershell
npm test
npm run build
npm run lint
```

`npm test` runs the local backend, UI component, calendar, workload, Excel export,
and schedule-import checks. It does not write to Supabase or change saved schedules.
