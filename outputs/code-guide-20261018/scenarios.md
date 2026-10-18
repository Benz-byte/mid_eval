## 22 A worked example from upload to archive

### Prepare the example

Assume file A contains CCS 1001 in MT102 on Monday from 7 AM to 10 AM, and CCS 2200 in MTCL1 on Tuesday from 1 PM to 4 PM. Anna has a personal class Monday from 8 AM to 9 AM. Ben is free for the Monday duty. Carla will be added later. These are teaching examples, not a promise that a larger real dataset produces exactly these assignments.

### Upload file A

The app reads the file into rows and asks the backend to recognize and parse its format. It calculates a fingerprint from the actual uploaded bytes. Successful parsing populates the Schedule tab and selects that fingerprint's assistant roster and saved result, if they exist.

The original file stays unchanged on disk. A previously unknown fingerprint can start with an empty assistant roster even when other students exist in the database under a different key. The filename is useful for people, but the fingerprint is the normal isolation key.

### Add Anna and Ben

Each profile stores personal classes separately from department duties. Anna's Monday conflict makes her unavailable for the overlapping Monday assignment. Ben may be eligible. Neither person receives work merely because their profile appears in the sidebar.

Choose Create schedule and review settings. With no existing result, Proceed requests a full solve. If the solver assigns Ben to Monday, the saved duty references Ben's internal assistant ID and the original CCS 1001 class ID. It also stores the weekday and interval needed to draw the duty.

### Review and make a manual change

Suppose Tuesday is unassigned and Anna is free then. Clicking the Tuesday class lets the user choose an eligible assistant. The app checks Anna's personal classes, other effective duties, reliever duties, event commitments, workload caps, and duty gap before saving. A student with zero duty hours is a valid candidate if those checks pass.

The new Tuesday duty becomes part of the saved working result. Switching to the Student Assistant tab should display it for Anna. Switching back should leave Ben's Monday duty intact. This is one saved assignment set viewed in two ways, not two separate schedules that must be manually copied.

### Add Carla and create again without full rescheduling

Carla joins the active file A roster. Leave Reschedule the entire current schedule unchecked. The app identifies assistants not already listed as processed and asks the incremental solver to fit the new student into available duty segments.

Existing valid duties are fixed input. It does not move Ben away from Monday just to give Carla that work. If no usable free segment remains, Carla can finish with zero new duties. That result is compatible with the preserve-existing-work requirement; maximum workload is a ceiling, not a guaranteed allocation.

If Carla already received a manual duty before generation, that fixed work is passed into the incremental context. The solver should adapt to it rather than declare all saved data obsolete simply because the assignment was made manually.

### Decide to rebuild everything

If the administrator wants a new distribution, check Reschedule the entire current schedule. This allows regular assignments to change, including manually made duties. Existing events remain separately saved. Replacement records survive only when their original duty still matches the new result.

Review event compatibility afterward. The current full solver does not receive dated event assignments as busy intervals, so saved events alone do not guarantee that regenerated duties avoid them. The manual event-assignment filter and the full solver do not currently have identical inputs.

### Add an event and a reliever

Create an orientation event on a concrete date, with a room and time. Assign Anna only if the event-card checks allow her. The event appears on Anna's calendar for that week, not automatically on Ben's or Carla's calendar.

If Ben cannot cover one particular Monday, Find Reliever ranks other eligible students and automatically assigns the first candidate. Assume Carla wins. Ben remains the original recurring assistant. Carla receives a dated reliever record. For the following Monday, Ben is still responsible unless that date also has coverage.

### Compare weekly totals

The weekly report adds regular-duty time actually credited that week, assigned event time, and reliever time. Covered duty time is deducted from the original assistant so the same work is not counted for both people as if both performed it. Personal class hours do not count as duty workload.

Different selected weeks can therefore have different totals even though the recurring duty assignments have not changed. Events, exam dates, and replacement dates explain many of these differences.

### Save an archive and start the next schedule

Save an archive with a distinct name, school year, and semester. The app captures file A's imported data, relevant roster, duties, events, replacements, settings, and viewing context. After the local save succeeds, the current schedule closes. The snapshot remains accessible through Archives.

Upload file B for another semester. Its different fingerprint selects a different roster and result. Anna need not be included in B merely because she served in A. Viewing A's archive still shows the captured historical roster and duties, regardless of later changes to B.

Sources: Chapters 4 through 18E and their referenced handlers, formatters, solver functions, and storage modules.

## 23 Scenario reference for everyday actions

### The same file is renamed

If the file bytes are unchanged, its SHA-256 fingerprint stays the same. The existing scoped roster and result can be reused even though the display filename changes. Legacy records using a filename fallback can behave differently; they are compatibility data rather than the normal fingerprint path.

### A file keeps its name but its content changes

The fingerprint can change. The app treats the new bytes as a different schedule scope. Do not assume matching filenames guarantee matching saved assignments. An Excel program can also change internal workbook bytes during a save even when the visible content appears similar. Archive important work before replacing files.

### The active CSV is removed

The normal working timetable becomes empty and the upload action becomes available. The source file on disk is not deleted. Per-file assistant/result caches and scoped events are different from the active selection; they are not all globally erased by closing that selection. Reuploading the same bytes can reconnect to saved scoped data. An archive is the independent historical copy to use when long-term preservation matters.

### Only a room is supplied

Recognized room-only input can add that room to the calendar without creating an assignable class. The solver needs a valid work interval and the required class information to create duty work. A room header is a location, not a duty by itself. Arbitrary text in an unrecognized file does not automatically become a room.

### Only a time is supplied

Recognized time-only input can contribute a calendar time marker. It does not invent a subject, an assistant assignment, or a valid time range. A marker at 10 AM is different from a complete class scheduled from 10 AM to 12 PM.

### A time is invalid or the format is unknown

A supported format can contain an unresolved meeting whose invalid or missing time is reported as TBA rather than a normal assignable interval. A wholly unrecognized header layout is a different error and can reject the upload with Unknown schedule format. TBA handling does not mean the parser accepts every file structure.

### An assistant has no duties yet

The profile can exist with zero duty hours. The student can still be considered for a manual duty if available. Absence from the current duty list is not a reason by itself to hide a student from eligible candidates. Availability and the active CSV roster still control whether the student can be chosen.

### Create schedule is clicked again with no new assistants

When a result already exists and full rescheduling is unchecked, the app looks for newly unprocessed assistant IDs. If none exist, it reports that situation instead of silently redistributing everyone. Check the full-reschedule option when intentionally requesting a new complete distribution.

### There is less work than assistant capacity

Some students can have fewer than the weekly maximum, including zero hours. An upper limit does not create work where none exists. The same class interval cannot be duplicated simply to fill every student's quota. Review actual available slots, eligibility, and coverage rather than treating the maximum as a target that must always be met.

### There are too few available assistants

Some work can remain uncovered when the model allows unassigned classes. An uncovered class does not necessarily mean the solver returned INFEASIBLE. It can mean the best found valid assignment set covers only part of the input. Read status, diagnostics, and the assignment list together.

### A long duty reaches the gap threshold

Suppose the required gap is 30 minutes. A duty ending at 10 AM after three continuous duty hours prevents another regular duty from starting immediately at 10 AM. A 10:30 AM start can satisfy the gap if other rules also pass. The code evaluates continuous-duty patterns; it does not insert a paid break record into the middle of a class or shorten the department timetable automatically.

### Two commitments touch at a boundary

The overlap test uses strict interval intersection. One interval ending at 9 AM and another starting at 9 AM do not overlap solely because they touch. A separate required-gap rule can still make consecutive regular duties invalid. Travel time between rooms is not a separately modeled general rule.

### The user edits data while the solver is running

The interface is not globally locked. Before applying a response, the generation handler compares the current CSV key and relevant saved inputs against the request snapshot. A stale answer is discarded rather than overwriting newer work. Discarding a response is not the same as cancelling the backend computation immediately.

### The student name changes

The same internal ID should remain, while related display labels are updated. A renamed student should keep compatible duties. The displayed full name, school student ID, and internal record ID serve different purposes. Sorting or display text must not be confused with identity.

### The personal schedule changes

The edit planner checks existing commitments against the replacement personal classes. If work becomes incompatible, the UI requires review and confirmation before unassigning affected work. The app rechecks that review context before committing, so an old confirmation is not supposed to remove newer changes silently.

### One assistant is removed

Only that student's duties and related replacement links are removed from the working result. Other students' duties remain. The imported department classes remain and can become unassigned. Related event cards remain but lose that student's assignment. Existing immutable archives retain their historical captured data.

### A manual duty is removed

The assignment is removed, not the department class. The class can be assigned to another eligible student. The changed working result is persisted with a new result revision. Removing one duty is not a request to rerun the whole solver.

### Find Reliever has an eligible candidate

The original assistant is excluded from replacement candidates. Available replacements are ranked, and the first is assigned automatically. The original recurring duty stays saved. Change Reliever becomes relevant after coverage exists; it allows selecting a different eligible replacement instead of regenerating the whole schedule.

### No reliever is available

No replacement is invented. The original assistant remains assigned and the UI reports that no reliever is available. This is not evidence that the original assistant is now available to work; it only means the system has not found substitute coverage. The administrator must resolve the operational absence separately.

### The administrator wants the original assistant back

Use Remove Reliever to remove the dated coverage record. The original recurring assignment already exists, so it becomes effective again for that date. The original assistant is intentionally not a candidate in the replacement list for their own duty. Returning responsibility is different from selecting the same person as their own substitute.

### A reliever exceeds regular workload limits

Reliever work counts as overtime and is not rejected simply for exceeding the regular-duty daily or weekly maximum. Time conflicts still disqualify the student. The recommendation compares workload criteria; it does not prove that the person is suitable under policies not represented in the code.

### An event overlaps a personal class or duty

On ordinary dates, the event-assistant filter excludes overlapping personal classes, effective regular work, and replacement duties. Another overlapping assigned event also blocks the choice. Only events assigned to that student should appear in their personal weekly calendar. The normal regular-duty caps are not simply applied as event-overtime caps.

### An exam date is selected

Exam records suppress normal classes and duties on that date without deleting the imported timetable. Dated events remain possible. The current event-assignment logic also suspends normal personal-class and duty checks for exam dates, while still rejecting overlapping assigned events. This is an implemented assumption about exam dates, not a guarantee that a student has no real examination then.

### An exam draft is cancelled

The temporary calendar preview is removed. Unsaved preview state should not permanently suppress the day's classes. Saved exam markers are different: normal classes return only when no remaining saved exam record keeps that date suppressed.

### Rooms are selected together

Select All selects the rooms available to the form. Selecting an occupied room shows the short warning. Existing booking conflicts and occupied-class replacement confirmations can affect whether saving is allowed. A warning is not an assistant assignment, and selecting every room does not automatically distribute assistants among the resulting cards.

### A booking is edited

Matching unchanged cards retain their IDs and assistant links where possible. Unambiguous changed cards can retain identity too, but assistants are revalidated for new times and locations. New cards begin unassigned. Ambiguous changes must not clone one student's assignment into multiple new overlapping cards.

### An event is deleted while another device is offline

Migration 010 records the deletion ID and blocks stale writes for that ID. The other device can remove its stale local card after learning the deletion. A deletion made before that protection existed cannot necessarily be reconstructed. Never remove the deletion log merely to make an old queued write succeed.

### An archive name already exists

Locally detected duplicates are rejected before saving a second confusing name. If two devices choose the same normalized name while offline, a cloud conflict can appear later. The rejected local snapshot remains available with a conflict state and can be renamed before retry. This exception does not make already-synced snapshots generally editable.

### Archive saving fails

A failed local IndexedDB commit must not close the current schedule. If local saving succeeds but the cloud is unreachable, the local snapshot can remain pending for remote sync. A local archive on one computer is not yet an off-device backup until remote saving succeeds.

### An archive is viewed or deleted

Viewing uses captured data in read-only mode and does not activate that archive as editable current work. Exiting preview does not mean restoring the archive into the active cache. Deleting an archive records its deletion state; it does not delete the original uploaded file or unrelated active assignments.

### Excel is exported

The exporter creates a workbook with separate room worksheets for Monday through Friday of the selected week. Conflict groups are red. Saturday and Sunday are not included by the present exporter even though the app can display them. The workbook is a formatted timetable output, not a full-fidelity archive of all assistant, reliever, revision, and synchronization data.

### The app is closed and reopened

Saved local data can be loaded from the same application profile. Normal packaged closing stops the backend process tree owned by that app instance. Separately started development services are different. A forced process kill can bypass normal shutdown. Unsaved form drafts and in-memory state should not be treated as durable records.

Sources: `App.tsx`, `StudentAssistantPanel.tsx`, `ScheduleCalendar.tsx`, `AdminEventsPanel.tsx`, `archiveStorage.ts`, `studentAssistantStorage.ts`, `assistantSchedule.ts`, `weeklyWorkload.ts`, `roomScheduleExcel.ts`, and their regression tests.

## 24 Checking saved data and diagnosing problems

### Separate local availability from remote saving

A visible card proves that the interface currently has that card's data. It does not prove a completed Supabase write. A cloudConfigured health response means usable configuration was found; it does not prove that the project is reachable or that every required migration succeeded. A successful read proves that read worked, not that all later writes will succeed.

When data is absent from Supabase, first check that the correct project and table are open. Then check the app's backend response, required columns and RPCs, cloud availability, and the relevant schedule key. Avoid deleting local storage while diagnosing because it can contain the only copy of a pending change.

### Read the tables safely in SQL Editor

These examples only read data. In Supabase SQL Editor, paste a query and click Run. Save stores the query text for reuse; it is not required to commit a normal successful query. Do not approve destructive warnings without understanding the statement that caused them.

List ordinary public tables:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_type = 'BASE TABLE'
order by table_name;
```

Inspect actual columns and types:

```sql
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;
```

Read event details and their CSV ownership:

```sql
select id, title, event_date, room,
       start_minutes, end_minutes,
       assistant_label, schedule_key
from public.admin_events
order by event_date, room, start_minutes;
```

These timestamps can be inspected too, but the default-now caveat in Section 18B still applies. A NULL schedule_key identifies legacy unscoped data; the filename cannot be recovered reliably from that NULL alone.

### Inspect the JSON rather than counting only rows

Read the active timetable's basic identity:

```sql
select id, csv_name,
       csv_events ->> 'fingerprint' as fingerprint
from public.shared_schedules;
```

Read the scoped roster map and current result:

```sql
select id,
       solver_result -> 'rostersBySchedule' as rosters,
       solver_result -> 'activeResult' as active_result,
       scheduling_settings
from public.student_assistant_schedules;
```

The arrow operator reads a JSON field. The double arrow returns its text value. Older array or direct-result representations may not contain these envelope fields, so a null result can indicate legacy structure rather than an empty database.

Read archive details without dumping every snapshot:

```sql
select id, name, school_year, semester,
       created_at, deleted_at
from public.schedule_archives
order by created_at desc;
```

Read known event deletions:

```sql
select event_id, deleted_at
from public.admin_event_deletions
order by deleted_at desc;
```

### Understand errors before trying another save

| Response or symptom | Meaning to investigate |
| --- | --- |
| HTTP 400 | Input validation failed; inspect the returned message |
| HTTP 409 for archive creation | Normalized archive name conflicts with another active archive |
| HTTP 410 for an event save | That event ID has already been permanently deleted |
| HTTP 503 | Backend repository or cloud operation failed; inspect the underlying error |
| Network request fails without a response | Local service, connection, or request delivery problem |
| Unknown schedule format | Parser did not recognize the actual imported structure |
| Saved assignments do not match | Existing class identities or intervals cannot be reused as supplied |

A 503 is not proof that the CSV is invalid. A parser error is not proof that Supabase is paused. Diagnose the layer producing the error rather than treating every failure as a database problem.

### When an old executable behaves differently

The packaged app contains the source as it existed when it was built. Updating a TypeScript or Python file in VS Code does not update an existing executable. Rebuild the package after changes. Confirm that the launched executable is the new output and that an old backend on port 5000 is not serving a different parser.

Port 5173 is the development frontend port. Port 5000 is the local backend port. If npm run dev says 5173 is occupied, find the existing development session and stop it with Ctrl+C in its terminal when appropriate. Do not kill every Python or Node process on the computer.

### What one device can and cannot demonstrate

One device can test local persistence by closing and reopening the same app profile, switching between visibly different CSVs, checking immutable archives, and comparing app actions with read-only Supabase queries. Development and packaged profiles may have separate local storage, so they are not automatically one local dataset.

An isolated second app profile with the same backend configuration can help approximate a fresh client. Automated tests can simulate stale saves and failed requests. Neither proves real two-device simultaneous editing under clock differences and network interruptions. Treat those as separate integration tests, not as conclusions from unit tests alone.

Sources: `backend/routes/`, `backend/database/supabase/client.py`, `frontend/src/api/apiClient.ts`, `frontend/src/desktop/main.ts`, migrations 001 through 010, and Chapter 20.

## 25 System boundaries and a demonstration checklist

### What the system currently promises

The application can import recognized timetable formats, retain supported partial room and time input, calculate assistant duties under modeled rules, preserve manual changes, fill remaining work incrementally, generate a full replacement distribution when requested, manage dated events and relievers, calculate weekly workloads, export room timetables, and preserve read-only archives.

Local-first persistence means supported completed actions are saved locally and queued for remote sharing. It does not mean the device cannot run out of storage, every draft is saved, or a cloud request can never fail. An archive saved only locally is still vulnerable to loss of that device's application data.

### What is not a hidden feature

The app does not rewrite the original CSV with duty assignments. Archive viewing is not a general Restore to Current operation. The animation is not an actual solver percentage. The shared ccs-main records are not independent per-user workspaces. Normal close cleanup does not guarantee cleanup after a forced crash. An optimal solver status does not prove fairness under policies that were never encoded.

The full solver does not yet consider all dated event commitments as busy intervals. Recommendation ranking does not include event overtime in the same weekly sum used by the report. Exam dates intentionally suppress normal class checks in event selection. Settings are not separately scoped historical configuration records for every CSV. These differences matter when explaining the system accurately.

### Security and data responsibility

The current Supabase policies support shared prototype access, not per-user ownership boundaries. Enabling row-level security is insufficient when policies broadly allow access. The packaged environment file can be read from distributed resources; it is not a secure vault. Privileged service-role credentials must not be distributed in a desktop client.

Profiles and schedules can contain student information. Limit access to the project and protect copies of exported workbooks, archives, and local application data. The current code should not be described as a complete authentication, authorization, audit-history, or disaster-recovery solution.

The schema intentionally retains deletion metadata to reject stale writes. This is operational protection, not a complete audit trail of every edit. There is no automatic column-by-column history of all previous names, assignments, and administrator actions.

### A practical demonstration sequence

Begin with a clearly labeled test schedule. Upload it and show its rooms and class times. Add two test assistants with visibly different personal-class conflicts. Create a schedule, explain the settings, and point out a duty that would be invalid for one student but allowed for the other.

Manually assign an eligible zero-hour student to an open duty. Switch tabs and show that the assignment persists. Add another student and generate incrementally; demonstrate that previous duties remain. Then explain that full rescheduling is a deliberate different action that permits changes.

Create a dated event, assign an available student, and show that it appears only in that person's selected week. Find a reliever for a regular duty, show the original and replacement states, then remove coverage to restore the original responsibility. Show the weekly workload report and explain why personal-class hours are excluded.

Save an archive and show that current work closes only after local saving. Upload a different schedule with different assistants. View the first archive to prove its historical roster and duties remain independent. Export Excel and explain the current Monday-through-Friday scope and red conflict formatting.

Finally, use read-only Supabase queries to show an event's schedule_key, the assistant roster map, and the archive row. Distinguish a real cloud record from a local-only card. State which checks were actually performed rather than claiming untested simultaneous-device safety.

### How to maintain this manual

When behavior changes, update the workflow explanation, relevant database or JSON field descriptions, scenario outcomes, and source reference together. A new column requires a migration; changing only a TypeScript interface does not create that column in Supabase. A new solver preference needs an objective explanation and regression tests; changing a color or button label does not change solver rules.

The source file reference and function index below help locate implementation details. The manual explains each module's role and important algorithms. Tests and the current source remain necessary when investigating an exact input, error, or operating-system condition beyond the worked examples.
