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
