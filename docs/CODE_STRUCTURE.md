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
- `formatters/assistantSchedule.ts` removes one assistant's assignments and
  recalculates the remaining totals without rerunning the solver. The panel saves
  that remaining result; the app shell clears only that assistant's current-CSV
  event assignments. Other CSVs and archive snapshots are untouched.
  Its `planAssistantEdit` also preserves duties on name-only edits, updates labels,
  and builds a non-mutating conflict review for replacement personal schedules.
  The profile form requires confirmation before unassigning affected records and
  rechecks its source snapshot if assignments change during that review.
- `AssistantWeeklyCalendar.tsx` draws the selected assistant's week.
- `WeeklyWorkloadSummary.tsx` displays the already-calculated workload ranking.
- `ThemeToggle.tsx` provides the shared theme switch in active and archived tabs.
- `ui/app/theme.ts` applies the theme to the document and notifies mounted controls.
- `ui/app/theme.css` owns the shared dark/light palette; feature styles consume it.
- `storage/themeStorage.ts` only loads/saves the device's theme preference.

Keep network calls in `api`, persistence in `storage`, and reusable pure
calculations outside JSX. Shared data types must not require importing a screen.
Use `saveActiveTab`, `saveScheduleDate`, `saveAdminEventsLocally`, and
`saveCsvScheduleLocally` rather than writing browser storage from UI components.
Do not remove old saved-record support merely because an older creation form is
gone. Existing events, booking IDs, schedule fingerprints, and storage keys are
compatibility contracts.

## Desktop shutdown

The desktop process owns only the backend it launches. On Windows,
`desktop/backendProcess.ts` waits for PID-scoped `taskkill /f /t` to finish before
the window closes or Electron quits. Cleanup failures keep the window open and
report the problem; VS Code's separately launched server is not terminated.
`npm run test:desktop` checks shutdown behavior, and its optional `--integration`
mode tests a disposable Windows parent/child process tree. Rebuild the executable
to apply desktop shutdown changes. Forced termination/crashes are not covered by
the normal close handlers.

## Backend

The backend already follows layered responsibilities:

- `routes/`: HTTP endpoints and responses.
- `models/`: input validation and normalized data contracts.
- `services/`: schedule parsing and other business processing.
- `database/supabase/`: shared-data queries and persistence.
- `solver/`: CP-SAT constraints and scheduling.
- `tests/`: local Python tests.

Student-assistant HTTP routes delegate to `services/student_assistant_service.py`.
That service calls model validation, the repository, and the solver; HTTP status
codes and response shapes remain in the routes. Other data features follow the
same route/service/model/repository boundary.

Keep SQL changes in `database/supabase/migrations/`. Do not rewrite applied
migrations as part of code organization.

## Verification

Run `npm test`, `npm run build`, and `npm run lint`. The test command runs local
checks without changing live database records. `scripts/register-typescript.mjs`
provides the shared Node test loader for the actual frontend modules.

The conflict database script is separate because it may need a configured service;
it is not part of the default local checks. Generated build folders, sample files,
user outputs, and local caches are not unused application code to delete.

## Assignment synchronization

Assignment results have independent `resultRevisions` per CSV in the existing
JSON storage. Actual result edits (manual duties, relievers, solver results, and
clears) advance a revision; switching CSVs or reading cloud data does not. Both
frontend and backend merge by revision rather than treating cached CSVs as new
writes. Clear revisions remain even when a result is absent. Pending snapshots
retain edits across CSVs, and old backends leave those changes queued until
restarted. No migration is required. Regression checks are in
`test-assignment-sync.mjs` and backend assistant-roster tests. This is sequential
sync protection, not transactional simultaneous multi-device editing.

## Event editing

Event edits use `formatters/bookingEdit.ts` to match unchanged cards before
unambiguous moves, preserving IDs and assistant assignments. Changed slots are
checked against personal classes, duties, reliever duties, and scoped events;
exam dates retain their existing suspension rules. `App.tsx` requests confirmation
before unassigning affected assistants. Cancelling does not delete any events.
The local calendar is replaced once, with the full edit queued through
`queueAdminChanges` for background retry. Cloud requests remain individual
requests, not a database transaction. `scripts/test-booking-edit.mjs` covers the
matching and availability rules; the isolated Electron harness supports
`--check-booking-edit` for the save/cancel/confirm workflow.

## Event deletion

Event deletion protection uses migration 010's `admin_event_deletions` table and
database trigger. The delete RPC records an ID and removes its event atomically;
stale PUTs return HTTP 410. Event sync snapshots include deleted IDs. The local
sync queue drops rejected saves and persists known deletions, while the calendar
removes those cards immediately. Normal network errors remain queued for retry.
Regression tests are `test_admin_event_deletions.py` and `test-event-deletions.mjs`.

## Archives

`archiveTypes.ts` defines the versioned snapshot and clones the current schedule,
scoped assistant result, profiles, events, settings, and viewing dates. Archives use
their own IndexedDB database through `storage/archiveStorage.ts`, not the active
schedule's localStorage keys. Quota/transaction failures are reported instead of
claiming a successful save. Pending saves/deletions retry on startup, reconnection,
and periodically; archive-list entries indicate local versus synced saves.

`api/archiveApi.ts` talks only to `/api/archives`. Backend archive routes, service,
validation, and repository follow the existing layers. Migration 007 creates a
separate Supabase table and an immutability trigger. Active archive names must be
unique after trimming/collapsing spaces and ignoring case. Migration 009 enforces
this in Supabase; local storage checks names within the save transaction. IDs
remain immutable, and retries of the same saved snapshot are idempotent.
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

Archive Save commits to IndexedDB before closing the current schedule; it never
waits for cloud requests. A duplicate cloud name marks the local record with
`nameConflict` while other archives continue syncing. Archives remains able to
view/delete it, or rename that never-uploaded snapshot and retry. Synced snapshots
cannot be renamed. Duplicate-name responses use HTTP 409 (older 400 responses are
also recognized). This needs no migration beyond the existing unique-name index.
The archive regression tests and `--check-archive-save` Electron smoke mode cover
blocked cloud requests, local commit/close, conflicts, rename, and preview.
