## 18A Understanding the database design

### Why some information is inside JSON

The database uses a mixed design. Events have individual rows with ordinary columns for their title, date, room, and time. Imported timetables and assistant results contain nested lists and maps, so they are stored in JSONB columns. Seeing only a few rows in Supabase does not mean the app has only a few students or assignments. One JSON value can contain a complete roster and hundreds of duties.

The schema below describes the project's migrations 001 through 010. The SQL files define the intended structure. A running Supabase project has that structure only after its migrations have succeeded. A source file is not proof that a remote migration ran.

### Reading database types and rules

| Database term | Plain language meaning |
| --- | --- |
| text | A string such as a title, room name, or identifier |
| integer | A whole number, such as minutes after midnight |
| date | A calendar date without a clock time |
| timestamptz | A timestamp representing an instant with timezone support |
| uuid | A structured unique identifier used for archives |
| jsonb | A structured object or list stored in PostgreSQL |
| primary key | The value that uniquely identifies a row |
| not null | The column cannot contain SQL NULL |
| default | A value used when an insert omits the column |
| index | A lookup structure; a unique index can also reject duplicates |
| trigger | Database code automatically run for a specified write |
| policy | A rule controlling which roles can access rows |

An empty JSON array `[]`, an empty JSON object `{}`, an empty string `''`, and SQL NULL are different values. For example, an empty assistant list means the roster has no entries. A missing result can mean that no assignment result is currently saved. Neither means an assistant called NULL exists.

### The relationships are mostly maintained by the app

The schedule fingerprint identifies an uploaded file's scope. Assistant IDs identify people within the stored records. Class IDs identify imported meetings. Duty records link assistantId to classId. Event rows carry schedule_key and, when assigned, assistant_id. Reliever records link the original and replacement assistants to a dated duty.

These are logical relationships, not a set of SQL foreign keys connecting normalized student, class, and assignment tables. Most related records are nested in JSON. The interface, formatters, validators, and repositories must keep their IDs consistent. A label is display text and must not be used as a substitute for a stable ID.

The two main shared records use the fixed ID `ccs-main`. That ID is not the uploaded file fingerprint. Think of ccs-main as the shared storage slot and the fingerprint as the key used inside or alongside its content to distinguish schedules.

### The five tables at a glance

| Table | Stored content | Record granularity |
| --- | --- | --- |
| shared_schedules | Active imported timetable | Shared active slot |
| student_assistant_schedules | Rosters, duties, relievers, settings, revisions | Shared JSON cache slot |
| admin_events | Dated event cards and exam records | Individual saved event card |
| schedule_archives | Independent historical snapshots | One archive |
| admin_event_deletions | IDs of permanently deleted events | One deleted event ID |

There is no separate weekly-report table. Reports are calculated from saved duties, events, replacements, and the selected week. There is also no physical table created each time another CSV is uploaded.

Sources: `database/supabase/migrations/001_shared_schedule.sql` through `010_admin_event_deletions.sql`; `frontend/src/types.ts`; the Supabase repositories under `backend/database/supabase/`.

## 18B The active timetable and assistant tables

### The shared schedules columns

| Column | Type and rule | Meaning |
| --- | --- | --- |
| id | text primary key | The repository currently uses ccs-main |
| csv_name | text not null | Display filename; default empty string |
| csv_events | jsonb not null | Current timetable envelope; SQL default is an empty array for compatibility |
| admin_events | jsonb not null | Legacy event storage; default empty array |
| updated_at | timestamptz not null | Timestamp with default now |

The current schedule repository writes an object into csv_events. It can still read an older array-based value. The legacy admin_events column is not the current destination for ordinary event saves; those use the separate admin_events table.

The timetable envelope contains these fields:

| JSON field | Meaning |
| --- | --- |
| events | Normalized imported CalendarEvent records |
| rooms | Imported room names, including accepted room-only input |
| times | Imported numeric time markers |
| fingerprint | SHA-256 identifier for the uploaded file bytes |
| tbaSubjects | Unresolved subject information when supplied |
| metadata | School year and semester when supplied |

The repository maps csvName in an API payload to csv_name in SQL, and maps csvEvents into the envelope's events field. These naming differences do not create extra copies of the original spreadsheet file.

### The student assistant schedules columns

| Column | Type and rule | Meaning |
| --- | --- | --- |
| id | text primary key | The shared assistant record uses ccs-main |
| assistants | jsonb not null | Active roster compatibility field; default empty array |
| solver_result | jsonb nullable | Result cache envelope or an older direct result |
| scheduling_settings | jsonb not null | Workload and gap settings added by migration 005 |
| updated_at | timestamptz not null | Timestamp with default now |

The column called solver_result is now a container for per-schedule data. It must not be described as only the last raw response from CP SAT.

| Envelope field | Meaning |
| --- | --- |
| kind | Identifies the schedule-result-cache representation |
| activeScheduleKey | Fingerprint of the currently active roster and result |
| activeResult | Convenience copy of that schedule's saved result, or null |
| resultsBySchedule | Map from schedule keys to saved assignment results |
| rostersBySchedule | Map from schedule keys to assistant lists |
| rosterRevisions | Version markers for real roster edits |
| resultRevisions | Independent version markers for assignment changes and clears |
| unlinkedAssistants | Preserved legacy profiles whose schedule scope is unknown |

A simplified example shows the relationship without listing full profiles:

```text
rostersBySchedule
  file key A -> [Anna profile, Ben profile]
  file key B -> [Carla profile]

resultsBySchedule
  file key A -> Anna and Ben duty result
  file key B -> Carla duty result
```

When file B is active, Anna and Ben should not appear merely because they are present somewhere in the shared JSON. The app activates B's roster. The former legacy-linking button is no longer available; preserved unlinked data is not an automatic roster for a new file.

### Scheduling settings and actual defaults

The current defaults are a 30-minute gap, a 4-hour daily regular-duty maximum, and a 20-hour weekly regular-duty maximum. An earlier mockup showing 8 daily hours is an example of a selectable value, not the current default.

```json
{
  "minimumGapAfterThreeHourDutyMinutes": 30,
  "maximumDailyDutyMinutes": 240,
  "maximumWeeklyDutyMinutes": 1200
}
```

The available gap choices are 0, 30, 60, 90, and 120 minutes. Daily choices run from 1 through 8 hours. Weekly choices run from 5 through 40 hours. Normalization rejects unsupported values and ensures the weekly setting is not below the daily setting. These settings are stored alongside the shared assistant cache, not as independently keyed historical settings for every uploaded file. A saved result can also record its applied settings, and an archive captures its saved settings.

### Timestamp defaults are not automatic update triggers

A column declared default now receives that default when an insert omits it. That declaration alone does not automatically change updated_at on every later update. Do not use the timestamp columns as proof of universal last-write ordering. The assistant cache uses explicit per-schedule revisions for its stale-cache checks.

Sources: migrations 001, 003, and 005; `backend/database/supabase/schedule_repository.py`; `backend/database/supabase/student_assistant_repository.py`; `frontend/src/api/studentAssistantApi.ts`.

## 18C The records inside the JSON

### Imported classes and personal classes

CalendarEvent represents department classes, personal classes, and dated events. Optional fields accommodate their differences.

| Fields | Meaning |
| --- | --- |
| id and source | Stable record identity and whether its source is csv or admin |
| courseCode and subject | Course or event title information |
| startMinutes and endMinutes | Numeric time boundaries |
| dayCode and date | Recurring weekday code or a concrete date |
| room | Location used for the calendar |
| classType and section | Class information when present |
| sections | Multiple associated sections when represented |
| stubCode | Imported class identifier when present |
| credits and studentCount | Imported academic information when available |
| instructorLastName and name fields | Available instructor display information |
| scheduleKey | Uploaded schedule ownership for scoped records |
| description | Event detail text |
| assistantId and assistantLabel | Assigned event assistant identity and display label |

A personal-class record describes when a student is busy. It does not, by itself, give that student duty hours. Likewise, credits are academic units and do not mean the same thing as the number of timetable hours. The solver's duty workload is calculated from time intervals.

### An uploaded assistant profile

UploadedAssistant has id, label, fileName, and events. It can also have studentId, lastName, firstName, and middleName. The events list is the student's personal class schedule. The generated duty list is stored separately in a result.

The internal id links the profile to duties and events. studentId is the school's identifier; label is the displayed name. Renaming preserves identity and updates related labels. Creating another profile creates a different record.

### A regular duty assignment

| Field | Meaning |
| --- | --- |
| assistantId and assistantLabel | The assigned student and display text |
| classId | The original imported class record |
| day | Recurring weekday |
| startMinutes and endMinutes | Assigned interval, which can be a segment in incremental results |
| courseCode and subject | Descriptive class information |
| room and section | Location and section information |

classId lets View find the original class. Removing a duty leaves that class available for reassignment.

### A saved result

StudentAssistantResult contains status and diagnostics, with optional assignments, assistantTotals, optimizedAssistantIds, relieverAssignments, appliedSettings, and summary. The summary can contain assistantCount, coverageHours, capacityHours, assignmentCount, assignedClassCount, and unassignedClassCount.

assignments is the working regular-duty list. assistantTotals summarizes regular work. optimizedAssistantIds records which assistants have already been processed for incremental generation; it is not a list of students guaranteed to have nonzero work. appliedSettings records the settings associated with the saved result when supplied.

Manual changes can save a FEASIBLE result without calling CP SAT. This does not imply a new solver proof. Use current assignments and calculated reports; retained diagnostics and historical solver metrics are not necessarily recomputed after manual edits.

### A date specific reliever record

RelieverAssignment stores date, classId, day, startMinutes, endMinutes, courseCode, room, originalAssistantId, originalAssistantLabel, and optional replacementAssistantId and replacementAssistantLabel.

The original recurring duty remains in assignments. The dated record says who covers it on that date. This is why changing a reliever does not permanently change next week's original assignment. A reliever record is stored inside the assistant result, not in a separate SQL reliever table.

### Local names and remote names

LocalAssistantData calls the active result result, its settings settings, and its result map resultsBySchedule. The API uses solverResult, schedulingSettings, and solverResultsBySchedule. The repository converts these into the SQL envelope described in Section 18B. These are translations of the same concepts across layers, not three independent scheduling engines.

Sources: `frontend/src/types.ts`; `frontend/src/api/studentAssistantApi.ts`; `frontend/src/storage/studentAssistantStorage.ts`; `frontend/src/formatters/assistantSchedule.ts`.

## 18D Events archives and deletion records

### The admin events columns

| Column | Type and rule | Meaning |
| --- | --- | --- |
| id | text primary key | Stable event card ID |
| title | text not null | Displayed event title |
| event_date | date not null | Date of this card |
| room | text not null | Room for this card |
| start_minutes | integer not null | Start minutes after midnight |
| end_minutes | integer not null | End minutes after midnight |
| updated_at | timestamptz not null | Timestamp with default now |
| assistant_id | text nullable | Assigned student's internal ID |
| assistant_label | text nullable | Assigned student's display name |
| description | text not null | Description; default empty string |
| schedule_key | text nullable | Fingerprint ownership added by migration 008 |

The event repository maps the app's courseCode to SQL title, date to event_date, scheduleKey to schedule_key, and camelCase time and assistant fields to their snake_case counterparts. There is an index named admin_events_schedule_key_idx on schedule_key.

One event form can produce several rows. Two dates with three rooms and one time range create six cards. Each can have its own assistant. A null assistant_id means no assistant is assigned to that card. A null schedule_key is legacy unscoped information, not a command to show that card in every uploaded schedule.

Exam markers use internal ID conventions in the same event system. Some records support calendar behavior rather than representing ordinary visible event work. The app excludes internal markers from event overtime totals.

### The schedule archives columns

| Column | Type and rule | Meaning |
| --- | --- | --- |
| id | uuid primary key | Snapshot identity |
| name | text not null | Human-readable archive name |
| school_year | text not null | Saved school year |
| semester | text not null | Saved semester |
| created_at | timestamptz not null | Creation instant supplied with the archive |
| snapshot | jsonb not null | Complete saved ScheduleArchive object |
| deleted_at | timestamptz nullable | Null while active; timestamp when deleted |

The snapshot has schemaVersion, id, name, schoolYear, semester, createdAt, schedule, adminEvents, assistantData, and view. schedule contains the imported data. assistantData contains the relevant scoped roster, assignments, replacements, settings, and revisions. view contains scheduleDate, assistantWeekStart, selectedAssistantId, and tab.

The local IndexedDB ArchiveRecord wraps that snapshot with id, deletedAt, pending, and optional nameConflict. These local synchronization fields are not all SQL columns and are not all part of the immutable snapshot itself.

The archive trigger prevents changing an existing snapshot's identity, name, school year, semester, creation time, or captured data. It also prevents clearing a deletion timestamp to restore a deleted archive. The unique active-name index ignores case and repeated spaces. App deletion normally sets deleted_at rather than removing the row physically.

### The admin event deletions columns

| Column | Type and rule | Meaning |
| --- | --- | --- |
| event_id | text primary key | Permanently deleted event ID |
| deleted_at | timestamptz not null | Deletion timestamp; default now |

The protected delete RPC records the ID and deletes the active event in one transaction. The event-table trigger records direct row deletions too and blocks a subsequent insert or update for a deleted ID. Anonymous and authenticated clients can read deletion records but cannot directly maintain that table through ordinary writes.

A stale save for a deleted event produces HTTP 410 through the backend. The frontend drops that obsolete pending save. A new event needs a new ID; erasing deletion records to revive old IDs would defeat the protection.

Sources: migrations 002, 004, 006, 007, 008, 009, and 010; `frontend/src/storage/archiveTypes.ts`; `backend/database/supabase/admin_event_repository.py`; `backend/database/supabase/archive_repository.py`.

## 18E Following one change through every layer

### Adding a student assistant

The user submits a profile and a personal schedule. The parser returns normalized personal-class records. The Student Assistant panel creates the profile and updates the active fingerprint's roster. Local storage saves the roster and a new roster revision. The retry queue sends a shared-assistant payload to Flask. The repository merges eligible per-schedule changes into the shared JSON envelope and saves it to Supabase.

When another device loads that envelope, its active schedule key determines which roster to show. A profile being present somewhere in the table is insufficient: it must be inside the correct roster map entry.

### Creating or manually changing duties

Create schedule sends a solver request to the local backend. CP SAT returns assignment objects. A successful, still-current response becomes a local saved result, receives a result revision, and enters the cloud queue. A manual assignment takes a shorter route: it validates eligibility, rebuilds the working result locally, and uses the same result persistence path without running the solver.

The assignments are not embedded into the original CSV file. Reopening that file on another computer without the app's saved data does not reveal the generated duties by itself.

### Saving a dated event

The booking form expands date, room, and time selections into event cards. The app stores those cards locally with scheduleKey. Each queued event save reaches the event route, validator, service, and repository. The repository writes one SQL row per card. The assistant calendar displays a card only for the matching assistant ID and selected date range.

### Replacing a duty assistant for one date

Find Reliever filters and ranks eligible candidates, takes the first, and saves a dated replacement record inside the assistant result. The original assignment stays in place. The original student's calendar displays relieved duty for that date; the replacement's calendar displays reliever duty. Removing coverage removes the dated record rather than deleting the original class or recurring duty.

### Archiving and closing current work

The app clones a snapshot and commits it to IndexedDB. Only a successful local commit allows the workflow to close the active schedule. Archive cloud synchronization is independent and can complete afterward. The historical snapshot does not depend on the active ccs-main schedule remaining open.

### Loading and retrying

Startup can load saved local data before a remote request finishes. Polling callbacks normally run at five-second intervals, but that is not a promise that all devices converge within five seconds. Pending writes, backend availability, request time, failures, and merge rules affect when another device receives a change.

The queue acknowledges the version it actually sent. If another local edit occurs during that request, the newer pending value remains. Per-schedule roster and result revisions prevent several stale-cache overwrite cases. They do not make a read-modify-write JSON save transactionally safe for unrestricted simultaneous editing.

Sources: `frontend/src/storage/localFirstSync.ts`; `frontend/src/api/apiClient.ts`; `frontend/src/storage/archiveWorkflow.ts`; `frontend/src/ui/app/App.tsx`; the assistant and event repositories.
