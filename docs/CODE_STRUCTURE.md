# Code structure

Keep the existing feature folders. Put new code beside the feature it belongs to
instead of adding a parallel folder hierarchy.

## Frontend

| Folder | Responsibility |
| --- | --- |
| `frontend/src/ui/app/` | Application shell, tab navigation, and shared screen wiring |
| `frontend/src/ui/schedule/` | Schedule calendar, filters, date navigation, and reusable calendar zoom controls |
| `frontend/src/ui/admin-events/` | Add/move event forms, room/date selection, and booking-form helpers |
| `frontend/src/ui/student-assistants/` | Assistant profiles, duty calendar, scheduling settings, and weekly summary UI |
| `frontend/src/ui/archives/` | Archive list/save/delete dialogs and isolated read-only previews |
| `frontend/src/api/` | Flask requests, request/response contracts, and subscriptions |
| `frontend/src/storage/` | Local persistence, active schedule selection, and pending cloud synchronization |
| `frontend/src/formatters/` | Pure shared date/time/name presentation and workload calculations |
| `frontend/src/export/` | Excel file creation and browser downloads |
| `frontend/src/desktop/` | Electron main process, preload bridge, and desktop environment |
| `frontend/src/types.ts` | Data contracts shared across frontend features |

React components use PascalCase filenames. Helpers use camelCase filenames.
Keep feature-specific styling with its feature. A small shared component can live
in its owning feature folder and be imported by another feature; it does not need
a new top-level folder.

### Main components

- `ScheduleCalendar.tsx` coordinates schedule data and actions.
- `ScheduleDateNavigation.tsx` owns the clickable heading and date picker.
- `CalendarZoomControls.tsx` provides the same zoom buttons to both calendars.
- `AdminEventsPanel.tsx` owns the active event-booking and move workflows.
- `bookingForm.ts` reconstructs booking forms and identifies booking series.
- `StudentAssistantPanel.tsx` coordinates assistant data and generation.
- `AssistantWeeklyCalendar.tsx` draws the selected assistant's week.
- `WeeklyWorkloadSummary.tsx` displays the already-calculated workload ranking.

Keep network calls in `api`, persistence in `storage`, and reusable pure
calculations outside JSX. Shared data types must not require importing a screen.
Do not remove old saved-record support merely because an older creation form is
gone. Existing events, booking IDs, schedule fingerprints, and storage keys are
compatibility contracts.

## Backend

The backend already follows layered responsibilities:

- `routes/`: HTTP endpoints and responses.
- `models/`: input validation and normalized data contracts.
- `services/`: schedule parsing and other business processing.
- `database/supabase/`: shared-data queries and persistence.
- `solver/`: CP-SAT constraints and scheduling.
- `tests/`: local Python tests.

Keep SQL changes in `database/supabase/migrations/`. Do not rewrite applied
migrations as part of code organization.

## Verification

Run `npm test`, `npm run build`, and `npm run lint`. The test command runs local
checks without changing live database records. `scripts/register-typescript.mjs`
provides the shared Node test loader for the actual frontend modules.

The conflict database script is separate because it may need a configured service;
it is not part of the default local checks. Generated build folders, sample files,
user outputs, and local caches are not unused application code to delete.

## Archives

`archiveTypes.ts` defines the versioned snapshot and clones the current schedule,
scoped assistant result, profiles, events, settings, and viewing dates. Archives use
their own IndexedDB database through `storage/archiveStorage.ts`, not the active
schedule's localStorage keys. Quota/transaction failures are reported instead of
claiming a successful save. Pending saves/deletions retry on startup, reconnection,
and periodically; archive-list entries indicate local versus synced saves.

`api/archiveApi.ts` talks only to `/api/archives`. Backend archive routes, service,
validation, and repository follow the existing layers. Migration 007 creates a
separate Supabase table and an immutability trigger. Names may repeat; IDs cannot.
Deletion is soft and synchronized with tombstones, so a stale offline cache cannot
restore a deleted archive.

`ArchivePreview.tsx` never activates a stored CSV or assistant schedule. Its
ScheduleCalendar receives explicit archived data and disables all mutation paths
and preference writes. `ArchivedAssistantPanel.tsx` reads the same snapshot and
provides browsing, zoom, summaries, and card details without generation or editing.
The current screens remain mounted but hidden; exiting preview returns to them.
No restore-to-current operation is provided.

Local-only archives depend on this device's app data. Clearing app/browser data
can remove them. Synced archives can be retrieved on another configured device.
