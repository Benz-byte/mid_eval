# Auto Scheduler Code Guide

A plain language explanation of the application and its main algorithms

18 October 2026

The application turns uploaded class schedules and student assistants' personal schedules into regular duty assignments. It also supports manual assignments, date-specific events, relievers, weekly workload reports, room-based Excel exports, and read-only archives. Most working changes are stored on this device first and sent to Supabase afterward.

This guide follows the current source code, including the five recent fixes and the normal-close backend cleanup. Read Chapters 1 through 5 first to understand the foundations. Chapters 6 through 15 explain the important user actions and their code. The remaining chapters cover storage, the backend, packaging, testing, and a complete source-file reference. The examples use made-up students and classes.

The important distinction is between the original class schedule, the duty assignments linked to that schedule, and an archive of both. These are separate pieces of data. Removing a duty does not delete a class, and viewing an archive does not replace the active working schedule.

## Reading route

| What you want to understand | Read first |
| --- | --- |
| What each part of the application does | Chapters 1 and 2 |
| What data is saved and how CSVs stay separate | Chapters 3 and 16 |
| Uploading and validating schedules | Chapter 4 |
| How CP SAT works and how our solver makes assignments | Chapter 5 then sections 6A through 6H and Chapter 7 |
| Manual duties and relievers | Chapters 8 and 9 |
| Events and assistant availability | Chapters 10 and 11 |
| Calendars and weekly workload rankings | Chapters 12 and 13 |
| Archiving and exporting | Chapters 14 and 15 |
| Supabase and deleted events | Chapters 16 through 18 |
| Building and closing the desktop app | Chapter 19 |
| Testing and explaining the system in a defense | Chapters 20 and 21 |
| Where a specific file belongs | Source file reference and symbol index |

## 1 The application in one picture

### Three working layers

Electron provides the desktop window. Inside that window, React renders the calendar, forms, menus, and dialogs. React runs TypeScript that has been compiled to JavaScript. It does not run the Python solver directly.

The interface sends HTTP requests to Flask at `http://127.0.0.1:5000`. This address refers to the user's own computer. Flask parses schedule rows, runs the OR-Tools solver, validates requests, and talks to Supabase through repository functions.

Supabase stores shared data remotely. Local browser storage and IndexedDB let the interface retain working data and archives when the internet is unavailable. The backend is still needed for importing and solving, even when the internet is disconnected.

```text
User clicks a control
        |
React interface inside Electron
        |-- localStorage for working data and retry queues
        |-- IndexedDB for archive snapshots
        |
HTTP request to the local Flask backend
        |-- schedule parser
        |-- OR-Tools constraint solver
        |-- Supabase repositories
                    |
              Supabase database
```

### One app does not mean one process

Electron and Python are separate operating-system processes. Electron may also create renderer and graphics processes. That is normal. The current normal-close handlers stop the backend process tree owned by the app before allowing the window to finish closing. They do not stop a separately launched VS Code development server.

### A concrete example

You upload a Monday class in MT102 from 7 AM to 10 AM and an assistant's personal schedule. The parser creates structured records for both. The solver checks whether the assistant is free and whether the duty satisfies the workload rules. If it selects the assignment, the interface saves a duty record linked to the original class ID. It then draws that record in the assistant's weekly calendar.

Sources: `frontend/src/desktop/main.ts`, `frontend/src/desktop/preload.ts`, `frontend/src/ui/app/App.tsx`, and `backend/app.py`.

## 2 How to read the code

### The React hooks used throughout the interface

`useState` stores values that affect the screen. For example, selecting an assistant updates state and causes React to draw that assistant's calendar. A state update does not automatically save anything to disk; the code must call a storage helper or use an effect that saves it.

`useEffect` runs side effects after rendering, such as loading shared data, attaching a keyboard listener, or starting a polling timer. Its cleanup function removes listeners or timers when the component is no longer using them. `useMemo` avoids repeating calculations when their inputs have not changed, such as filtering a week's events. It is a calculation cache, not persistent storage.

`useRef` holds a value without forcing a redraw. Revision counters and the current CSV key are refs so asynchronous operations can compare their starting context with the latest context before applying a response.

### Common JavaScript operations

`filter` keeps matching entries without changing the original array. `map` produces a new entry for each original entry. `some` answers whether at least one entry passes a condition. `find` returns the first matching entry. `reduce` combines entries into a single value, such as total assigned minutes.

The spread operator in `{ ...oldRecord, name: newName }` copies an object and replaces only its name. This matters because changing an assistant's name should not erase their duties, student ID, or personal schedule. A `Set` stores unique values, such as deleted event IDs. A `Map` connects keys to values, such as assistant ID to total minutes.

### Async does not mean cloud only

An `async` function returns a Promise. `await` waits for an asynchronous result, which might be a network response, file reading, or an IndexedDB transaction. A `try` block handles the normal operation; `catch` handles failure; `finally` clears busy states even if the operation fails.

In a local-first action, the interface should wait for the local write that protects the user's work, but should not make that local write wait for an internet request. This is why archive Save now waits for IndexedDB and then closes, while cloud synchronization continues separately.

Sources: `frontend/src/ui/student-assistants/StudentAssistantPanel.tsx`, `frontend/src/storage/localFirstSync.ts`, and `frontend/src/storage/archiveWorkflow.ts`.

## 3 The main records and identifiers

### Records that should not be confused

| Record | Meaning | Important links |
| --- | --- | --- |
| CalendarEvent | An imported recurring class, a dated event, or an internal exam marker | id, source, dayCode or date, room, startMinutes, endMinutes |
| UploadedAssistant | A student's identity and personal class schedule | id, studentId, label, events |
| DutyAssignment | An assistant assigned to a recurring class occurrence | assistantId, classId, day, startMinutes, endMinutes |
| RelieverAssignment | Date-specific coverage of someone else's duty | originalAssistantId, replacementAssistantId, classId, date |
| StudentAssistantResult | Current assignments, totals, relievers, settings, and solver status | assignments, optimizedAssistantIds, assistantTotals |
| ScheduleArchive | A complete saved snapshot and its viewing context | id, schedule, adminEvents, assistantData, view |

### Why the IDs matter more than the displayed names

An assistant ID links duty records to a student even when the student's name changes. A class ID links a duty to the imported class. An event ID identifies the individual card, while a booking-series key groups cards from one multi-room or multi-date booking. Recreating an ID unnecessarily can break these relationships.

The main schedule's fingerprint is a SHA-256 digest of the uploaded file's bytes. It is the normal schedule key for assistant rosters, duty-result caches, and events. Renaming the same file without changing its contents keeps the same fingerprint. Changing the bytes can produce a different fingerprint even if the file looks similar. Older saved records may use a filename-based fallback key.

### Time is stored as minutes

7 AM is 420 minutes after midnight. 10 AM is 600. Their duration is `600 - 420`, or 180 minutes. Numeric times make sorting, overlap checks, workload sums, and solver constraints simpler than comparing display strings.

@@code frontend/src/formatters/timeFormatter.ts|1|4

This helper splits an HTML time value such as `07:30`, converts the two pieces to numbers, multiplies the hours by 60, and adds the minutes. Formatting a number for the screen is a separate job.

Sources: `frontend/src/types.ts`, `frontend/src/api/studentAssistantApi.ts`, and `frontend/src/storage/archiveTypes.ts`.

## 4 What happens when you upload a schedule

### The complete route

`ScheduleCalendar.handleUpload` gets the selected file and calls `App.uploadCsv`. That function starts two operations: parsing the file and calculating its fingerprint. It does not replace the current schedule until parsing succeeds and some usable class, TBA, room, or time information exists.

`readScheduleFile` reads CSV text with a quote-aware parser, or reads XLS and XLSX sheets with SheetJS. Spreadsheet numeric identifiers use their actual numeric values instead of currency display formatting. Rows are sent as JSON to `POST /api/schedules/parse`; the upload is not a direct file write into Supabase.

### How the backend chooses a format

With `format: auto`, `parse_schedule_rows` first looks for the course-offering report header within the first 50 nonempty rows. If it finds one, it uses `_parse_course_offering_rows`. Otherwise it checks the first nonempty row for the official template's labels and calls `_parse_official_schedule_rows`. It does not blindly accept any CSV.

The course-offering parser recognizes labels such as Stub No., Course No. and Description, Time, Day, Room, Teacher, and Credits. It reads section context and metadata and combines repeated shared meetings where appropriate. Unresolved course-offering times become TBA entries rather than imaginary calendar meetings.

The official template uses labels including Subject, SubjectTitle, StartTime, EndTime, Day, RoomType, Room, StudentAmount, LastName, and FirstName. It also handles room-only and time-only rows. An incomplete class row is not necessarily treated like a room-only row: invalid required class data can reject the upload. TBA behavior depends on the parser branch.

### What succeeds afterward

The interface saves the normalized classes, rooms, extra time boundaries, TBA entries, metadata, filename, and fingerprint locally. It activates that fingerprint's assistant roster and saved duty result, then queues the active schedule for cloud synchronization.

Example: a CSV row containing only Server Room can create a calendar room column, but cannot create a solver duty. A time-only row can extend the calendar's time guides without becoming a class. Neither row invents the missing subject or assistant assignment.

Sources: `frontend/src/api/scheduleParser.ts`, `frontend/src/ui/app/App.tsx`, `backend/routes/schedules.py`, and `backend/services/schedule_parser.py`.

## 5 The basic scheduling rules

### Hard rules and preferences

A hard rule makes an assignment invalid if it is broken. A preference helps choose between valid assignments. The solver must obey personal-class conflicts, non-overlapping duties, maximum daily and weekly regular-duty minutes, and the configured gap after three continuous duty hours.

The daily and weekly settings are maximums, not required hours that every assistant must reach. An assistant can receive fewer hours when the available classes, personal schedule, or other rules leave no valid duty. Event work and reliever work are overtime in the manual workflows and are not simply added to the regular-duty maximum checks.

### The overlap rule

@@code frontend/src/ui/schedule/ScheduleCalendar.tsx|55|57

The expression is true only when one interval starts before the other ends and ends after the other starts. A duty from 7 to 9 and another from 9 to 10 touch but do not overlap. A duty from 7 to 9 and an event from 8 to 10 do overlap. A separate duty-gap rule can still forbid adjacent duties even when the overlap test allows them.

### The break after three hours

Suppose the required gap is 30 minutes. After a continuous 7 AM to 10 AM duty block, another regular duty starting at 10:15 AM is too early, while one starting at 10:30 AM satisfies the gap. Two adjacent duties from 7 to 8 and 8 to 10 can form the same continuous three-hour block.

The rule does not insert a break inside a class. It constrains the start of a later duty after a completed continuous block. The backend walks possible chains of adjacent duty occurrences and adds a constraint forbidding the entire conflicting combination. The manual-assignment screen checks the corresponding time intervals before offering a student.

Sources: `_add_duty_break_constraints` in `backend/solver/student_assistant_solver.py` and `violatesDutyGap` in `frontend/src/ui/schedule/ScheduleCalendar.tsx`.

## 6 How the solver builds a schedule

### Turning classes into a model

`solve_student_assistant_schedule` parses recurring meetings and expands day codes such as TTh into separate Tuesday and Thursday meetings. `_coverage_units` divides each meeting into units of up to 30 minutes, including a shorter last unit if necessary. These units let the solver count minutes consistently.

For every assistant and class, the solver checks whether any class unit conflicts with that assistant's personal classes or fixed duties. If so, it does not create a candidate for that assistant and class. If the pair is eligible, it creates a Boolean class variable: 1 means selected; 0 means not selected.

All unit variables for that assistant and class are tied to the class variable. This is important: the main solver is not freely distributing arbitrary half-hour pieces of one class among many assistants. It chooses a consistent assistant for the class ID and its linked occurrences.

### Adding the constraints

At-most-one constraints stop multiple assistants from being selected for the same class. Optional intervals represent selected duties on a numeric weekly timeline, and `add_no_overlap` prevents simultaneous duties for an assistant. Summed durations enforce daily and weekly limits. Fixed duties contribute to the limits and to availability checks in incremental solving.

### Choosing among valid answers

The weighted objective gives a very large reward to covering class IDs. It then balances lower and higher individual workloads and includes preferences for total assigned minutes, active duty days, adjacency, avoiding some 7 AM starts, and avoiding repeated start times. A random tie-breaker helps choose among similar solutions. These are weighted preferences, not a promise that every person gets identical hours.

The solver has a 60-second search limit and uses eight search workers. OPTIMAL means it proved an optimum for this model and objective. FEASIBLE means it found an allowed solution without proving it was best. INVALID means the input or incremental context was rejected. The unsuccessful-solve branch reports INFEASIBLE for other non-success solver statuses; it does not separately expose every internal OR-Tools status.

Finally, `_merge_assignments` converts selected coverage units into user-facing duty records. The response includes assignments, assistant totals, summary counts, diagnostics, and the applied settings.

Source: `backend/solver/student_assistant_solver.py`.

## 7 Create schedule and reschedule entire schedule

### The button and settings window

Create schedule opens Scheduling Settings. The user selects maximum daily hours, maximum weekly hours, and the duty gap. Proceed closes the settings dialog and calls `runSolver`. During the request, the button area becomes the animated Creating schedule display. It is an indeterminate activity indicator, not a measured solver completion percentage. Other interface actions are not globally blocked.

### Two generation modes

With no existing result, the app requests a full solve. With an existing result and Reschedule the entire current schedule unchecked, it finds assistants not listed in `optimizedAssistantIds` and requests an incremental solve. If there are no new assistants, it shows a message instead of rebuilding the duties silently.

An incremental solve validates the old assignments against the current class IDs and times, keeps those assignments, subtracts their occupied intervals, and builds open-duty segments. It solves only for the new assistant IDs. If a newly added assistant already has manual duties, those duties are passed as fixed work. The response combines the old records with the newly fitted assignments.

With Reschedule the entire current schedule checked, the app does not pass the existing result as incremental input. The solver may choose different regular assignments. Reliever records are retained only when their original duty still exactly matches an assignment in the new result.

### Protecting changes made while solving

Before the request, `runSolver` captures the roster, result, and settings. Afterward, it checks the current CSV key and compares the latest snapshot. If the user changed those inputs while solving, it discards the stale response instead of overwriting the user's work.

### An important event limitation

Full regeneration does not delete the separately stored events. However, the present solver request sends the main recurring classes and the assistants' personal schedules; it does not send dated event assignments as busy periods. Therefore it does not yet guarantee that a newly generated duty avoids an already assigned event. Keeping event records is implemented; automatically solving around every dated event was a suggested improvement, not an implemented rule.

Sources: `StudentAssistantPanel.runSolver`, `studentAssistantApi.solveStudentAssistantSchedule`, and `_solve_incremental_schedule` in the Python solver.

## 8 Manual duties and assistant editing

### Assigning a duty without running the solver

Clicking a class with no assigned assistant opens the manual-assignment flow. `availableRegularDutyCandidates` considers every assistant in the active CSV roster, including people with zero duty hours. It removes candidates with personal-class conflicts, effective duty or reliever conflicts, overlapping assigned events, excessive regular daily or weekly workload, or a duty-gap violation.

The list is ordered by projected weekly minutes, daily minutes, longest continuous block, duty count, and student identifier. Before saving, `assignRegularDuty` recalculates availability, verifies the class is still unassigned, and creates a DutyAssignment linked to the class ID and weekday.

`withManualDutyAssignments` rebuilds the result's assignment list, totals, and summary. It can create a FEASIBLE result even when no solver-generated result exists. Manual changes are therefore real saved schedule data, not a decoration on the calendar. The storage layer gives the changed result a new per-CSV revision.

### Editing and removing assistants safely

Changing only a name preserves the assistant ID and updates labels in related duty and reliever records. `planAssistantEdit` checks replacement personal schedules against that assistant's existing commitments and returns a proposed result plus a conflict list. It does not mutate the saved records while the user is reviewing the list.

The edit form requires confirmation before saving changes that unassign conflicting work. It checks the review snapshot again so a stale confirmation does not erase newer assignments. The app shell updates or clears the assistant labels on the affected events without recreating those event cards.

Removing an assistant uses `withoutAssistantAssignments`, which filters out only that assistant's duties and reliever links and recalculates the remaining totals. It does not erase everyone else's result or delete the imported classes. Their event assignments are cleared while the event cards remain.

Sources: `frontend/src/formatters/assistantSchedule.ts`, `frontend/src/storage/studentAssistantStorage.ts`, `StudentAssistantPanel.saveEditedAssistant`, and `ScheduleCalendar.assignRegularDuty`.

## 9 Relievers and overtime

### Finding someone to cover a duty

The reliever flow starts from a duty that already has an original assistant. `rankRelievers` excludes that person and removes students who have an overlapping personal class, event, effective duty, or existing replacement duty. The remaining candidates can exceed the regular-duty workload limits because covering a duty is treated as overtime.

Candidates are sorted by projected weekly workload, daily workload, longest continuous block, number of duties, and student identifier. Find Reliever takes the first eligible candidate, saves a date-specific RelieverAssignment, and closes the flow. It does not rerun the solver or permanently replace the original recurring DutyAssignment.

### Original assistant and replacement assistant

For that date, the original assistant sees a relieved-duty state and the replacement sees a reliever-duty state. On a different week without that dated record, the original recurring duty still applies. This separation is why a reliever record contains both the original and replacement assistant IDs and a concrete date.

If no candidate exists, the code leaves the original assignment in place and shows No reliever available. It does not store a fake replacement or delete the original duty. Change Reliever appears after coverage exists and allows a different eligible candidate to be saved. Remove Reliever removes only that date-specific coverage record.

### What ranking does and does not mean

Recommended means first according to the coded ordering, not a separately trained prediction model. The ranking's effective-workload calculations differ from the weekly report: event work is checked as a time conflict but is not added to the reliever ranking's effective weekly minute sum. The weekly report separately includes event overtime. A candidate ranking is not the same calculation as the final report total.

Sources: `ScheduleCalendar.rankRelievers`, `effectiveIntervalsFor`, `effectiveWeeklyMinutes`, `persistRelieverRecords`, `findRelievers`, and `relieverRecordFor`.

## 10 Events rooms dates and exam dates

### One booking can create many cards

AdminEventsPanel maintains the selected dates, rooms for each date, and time ranges for each date. These are temporary form values until the user saves. Applying rooms or times copies the selected values to target dates. Select All selects the available room names; it does not invent rooms outside the current schedule.

The save operation expands the selection into a card for every date, room, and time range combination. For example, two dates, three rooms on each date, and two time ranges per date produce 12 cards. Each card has its own event ID and schedule key, so assigning an assistant to one card does not automatically assign every room and time.

### Occupied rooms and conflicts

The form distinguishes scheduled classes, other events, and existing room bookings. Selecting occupied rooms displays the short warning text. Existing room bookings can block a conflicting selection; class or event conflicts can require the form's replacement confirmation. This is not the same as claiming that every occupied room can always be booked without review.

### Exam dates hide classes without deleting the CSV

Exam bookings and internal exam markers encode their kind in the event ID. `isExamDate` checks whether such a record exists on a date. Calendar, weekly workload, and export code then suppress normal classes or regular duties for that date while keeping dated events visible. The source CSV class records are not physically removed.

The form can also preview exam dates while editing, so the calendar updates behind the drawer. Closing an unsaved form removes that preview; it is not a permanent class deletion. Deleting or changing the saved exam records restores the normal display where no other exam marker remains.

Title and description text are stored separately. AutoExpandingTextarea resizes the input to its content, and event details show the description when a card is opened.

Sources: `frontend/src/ui/admin-events/AdminEventsPanel.tsx`, `frontend/src/formatters/examPeriod.ts`, and the event-save handlers in `App.tsx`.

## 11 Assigning assistants to events and editing bookings

### Availability is checked for the selected card

`availableEventAssistants` starts with the active CSV's assistants. On ordinary dates, it removes people with an overlapping personal class, regular duty, or reliever duty. On exam dates, the current rule suspends those normal class and duty checks. Overlapping event assignments are still forbidden on exam dates.

There is no normal-duty workload cap in this event-assignment filter, because event work is overtime. That does not mean an assistant can be in two rooms at the same time. Once the student is assigned to one overlapping event, they disappear from another card's available selection. An event appears in an assistant's weekly calendar only when its assistantId matches that student.

### Why editing should preserve card identity

Before the fix, updating a booking deleted its old cards and created new ones, losing their IDs and assistant links. `editedBookingEvents` now matches exact unchanged date-room-time cards first. It then tries unambiguous changes to one dimension and finally a unique remaining old/new pair. Every match consumes one old card, so an assignment cannot be copied to several rooms.

Newly added cards start unassigned. When the exam kind changes, a new kind-compatible ID can be required; otherwise matched cards keep their IDs. `bookingSeriesKey` strips numeric/date suffixes to keep cards in a recognizable booking series.

### Revalidation and confirmation

`validateEditedEventAssistants` rechecks changed slots against personal classes, regular duties, reliever duties, and the final set of scoped events. Text-only edits preserve assignments without needlessly changing availability. Removed assigned cards and invalid retained assignments are listed in a confirmation prompt.

If the user cancels, nothing is deleted and the editor stays open. If confirmed, App commits one new local calendar snapshot and queues the changes together. Cloud event requests are still individual requests, not a multi-card database transaction.

Sources: `frontend/src/formatters/bookingEdit.ts`, `frontend/src/formatters/bookingSeries.ts`, `App.commitEventEdit`, and `ScheduleCalendar.availableEventAssistants`.

## 12 How the calendars are drawn

### Dates are views over stored data

The Schedule tab's daily view places rooms across the top and times down the side. Weekly view uses dates for the selected room. ScheduleDateNavigation combines previous/next navigation with the clickable date heading and date-picker controls. Moving the date does not generate new assignments.

The assistant calendar expands recurring weekday codes and combines that person's personal classes, regular duties, assigned dated events, and relevant reliever records. The selected Monday determines the seven displayed dates. An event outside that week is filtered out even if it belongs to the same assistant.

### Turning minutes into positions

Both calendars convert elapsed minutes from the visible start into vertical positions. The scale uses a row height and the current zoom. A block's height follows its duration, so a three-hour duty is taller than a one-hour event. The assistant view also considers the available viewport height when choosing its base scale.

CalendarZoomControls changes the value from 75 percent to 200 percent in 25-point steps; the middle button resets it to 100 percent. Zoom changes presentation, not class times or solver inputs. The two tabs maintain their own view state.

### Conflict colors are not solver instructions

The Schedule tab compares pairs of visible events in the same room. It calculates `max(start times)` and `min(end times)`. If the first value is smaller than the second, it stores the overlapping interval and shows the warning or conflict color. Weekly conflict checks repeat this per day.

Room-time conflicts in the imported data are different from an assistant's personal availability conflict. A red room card indicates conflicting room records; it is not proof that the solver assigned one student twice.

View from an assistant duty sends a class ID and date to App. The Schedule tab focuses and briefly highlights that card. The focus request is marked consumed and cleared according to the interaction logic; it is not a permanent assignment flag.

Sources: `ScheduleCalendar.tsx`, `AssistantWeeklyCalendar.tsx`, `ScheduleDateNavigation.tsx`, and `CalendarZoomControls.tsx`.

## 13 Weekly workload reports

### The report includes the whole roster

WeeklyWorkloadSummary shows a ranked list rather than a separate report of all individual duty descriptions. `weeklyWorkloads` creates a row for every assistant, including people with zero assigned minutes. Each row has regular-duty, event, reliever, and total minutes.

For recurring duties, the function maps the assignment's weekday onto the selected week. Exam dates do not contribute regular-duty minutes. Dated events count only when the date is within that week and the assistantId matches a roster member. Internal exam markers are not event overtime.

### Avoiding double counting when someone is relieved

If another student covers part of a duty, the original assistant's credited duty minutes are reduced by the actual covered interval. The function intersects each reliever interval with the duty and merges overlapping coverage before subtracting it. This prevents the same covered time from being subtracted twice.

The replacement receives reliever minutes for their date-specific record. For example, if Maria has a three-hour duty and Juan covers its middle hour, Maria's effective duty total is two hours and Juan receives one reliever hour in the report. This reporting capability does not imply that every manual UI path allows creating arbitrary partial coverage records.

### Sorting the results

The total is regular-duty minutes plus event minutes plus reliever minutes. `sortWeeklyWorkloads` returns a sorted copy, descending by default or ascending when selected. Equal totals are ordered by name and then ID, which makes the display stable rather than randomly shuffling tied students.

The report does not write assignments back to the solver and does not change the schedule. It is a calculated view over the selected week's data.

Sources: `frontend/src/formatters/weeklyWorkload.ts` and `frontend/src/ui/student-assistants/WeeklyWorkloadSummary.tsx`.

## 14 Archives are saved snapshots

### Capturing and saving

createScheduleArchive validates that a schedule is open and that archive details are present. It captures the imported schedule, current CSV's event records, relevant assistants and duty result, settings, and viewing dates. It scopes roster and result caches to that schedule rather than copying unrelated CSV histories.

The snapshot is cloned through JSON serialization so later changes to the active objects cannot silently alter the archive. Its UUID and schemaVersion identify the snapshot and its supported structure. Large archive snapshots are stored in the separate auto-scheduler-archives IndexedDB database.

@@code frontend/src/storage/archiveWorkflow.ts|4|8

The await protects the local commit. Only after IndexedDB succeeds does the supplied close action run. App then clears the current working schedule and closes the archive manager. A failed local save does not call that action. Cloud synchronization is started separately and cannot delay this local save merely because a request is slow.

### Viewing is separate from editing current work

ArchivePreview uses the archived snapshot as an explicit data source and sets readOnly on the calendar. ArchivedAssistantPanel uses the same captured assistant data. Creating schedules, assigning students, deleting events, and writing normal view preferences are disabled in those preview paths. Viewing an archive does not activate its CSV in the normal working storage.

### Names and offline conflicts

Local archive names are checked inside the save transaction after trimming, collapsing spaces, and ignoring case. Supabase has the corresponding unique active-name index. A name can still be claimed on another device while this device is offline.

If that happens, the local archive remains viewable with nameConflict set. Other archives continue syncing. Rename changes only that rejected, never-uploaded snapshot's name and retries. Synced archive snapshots remain immutable. Deleting a conflicting local archive does not delete the other device's differently identified archive.

Sources: `archiveTypes.ts`, `archiveStorage.ts`, `archiveWorkflow.ts`, `ArchiveManager.tsx`, `ArchivePreview.tsx`, and `ArchivedAssistantPanel.tsx`.

## 15 Exporting a room schedule to Excel

### What the workbook contains

createRoomScheduleExcel creates one worksheet per distinct room. It exports the selected week's Monday through Friday dates, not all seven calendar days. Empty rooms can still have worksheets. Normal recurring classes are omitted on exam dates, while valid dated events remain eligible for export.

The function sanitizes worksheet names because Excel forbids some characters, limits names to 31 characters, and requires case-insensitive uniqueness. It adds suffixes when needed. Time boundaries include regular half-hour guides and every actual event start and end so non-round times can be represented accurately.

### Why the export builds XML

The implementation writes the XLSX package's worksheet, style, relationship, workbook, and content-type XML parts. SheetJS's CFB utilities package those parts into a ZIP-based workbook. This gives the code control over merged schedule blocks, row heights, black borders, wrapped text, and color fills.

Events in the same room and day are sorted and grouped when their intervals overlap. Conflict groups are written with a red fill and include their individual times. Non-conflicting occupied cells use the ordinary schedule style. Touching boundaries alone do not produce an overlap group.

### Downloading without changing data

downloadRoomScheduleExcel builds a browser Blob from the workbook bytes, creates a temporary object URL, clicks a download link, then revokes that URL. It does not modify the source CSV, the assignment result, or the Supabase tables.

The existing export text lists course, identifier, instructor, and room. It does not automatically mean the workbook includes every assistant or reliever detail visible in the app; those fields would need explicit export formatting code.

Source: `frontend/src/export/roomScheduleExcel.ts`.

## 16 Local storage cloud queues and CSV isolation

### Where data is kept

| Location | Main content | What to remember |
| --- | --- | --- |
| React state | Current screen values and calculated views | Lost when the process exits unless persisted |
| localStorage | Active schedule, assistant caches, events, preferences, retry queues | Device and application-origin specific |
| IndexedDB | Complete archive records and pending archive sync state | Separate archive database on this device |
| Supabase | Shared schedule, scoped rosters and results, events, archives, deletion records | Remote persistence after successful synchronization |

### How retry queues work

A queue helper serializes the change locally and starts a background flush. A failed request leaves the pending entry available for later retry. The flushing functions share an in-flight Promise so several callers do not start overlapping copies of the same queue operation.

After a successful request, the code rereads the latest queue before removing anything. It clears the entry only if it still matches what was sent. If the user edited again while the request was running, the newer value stays pending.

@@code frontend/src/storage/localFirstSync.ts|62|66

The pending variable is the request's snapshot, not a live object. The comparison with latest is the protection against acknowledging away a newer edit. `finally` releases the in-flight lock whether the network call succeeds or fails.

### Isolation does not mean one database table per CSV

Events carry scheduleKey. Student assistant data has rostersBySchedule and resultsBySchedule maps keyed by the fingerprint. Uploading B activates B's roster and result; it does not erase A's cache. Legacy unscoped assistants are preserved in an unlinked pool and require explicit linking.

The cloud shared_schedules record still represents one shared active schedule, using the fixed ID ccs-main. Per-CSV assistant and event histories are scoped, but the system is not a fully independent multi-user workspace system. Editing the shared active schedule from another device can affect which schedule is loaded.

Sources: `frontend/src/storage/`, `App.tsx`, and the schedule and student assistant Supabase repositories.

## 17 Versioned assignments and permanent event deletion

### Why roster versions alone were insufficient

Two devices can have the same assistant list but different duty assignments. Protecting only rosterRevisions does not tell the backend which assignment result is newer. The application now stores independent resultRevisions for each CSV.

A real result change receives a new timestamp-and-UUID revision. Switching CSVs or hydrating remote data does not mint a new edit. Frontend and backend merge logic compare these per-CSV revisions so an old cached A result included in a B save does not overwrite A's newer duties. A clear retains its revision even when the result itself is absent.

Offline edits to several CSVs remain in the cached maps and can be sent in one pending snapshot. The backend accepts newer revisioned results rather than treating every cached result as a new write. Roster revision checks still prevent a rejected older roster from restoring its assignments.

### Why a deleted event needs a record

Hard deletion alone leaves no evidence distinguishing never existed from existed and was deleted. Migration 010 creates admin_event_deletions. The delete RPC records the ID and removes its event in one transaction, even if the event has not yet been uploaded.

A database trigger blocks a later insert or update using a deleted ID. It also records IDs for direct deletes from admin_events. A per-ID transaction lock serializes cooperating deletion and write checks. The backend converts a deleted-event save into HTTP 410; the frontend removes that stale queued PUT instead of retrying it forever.

Sync snapshots include deleted IDs. Local storage keeps those IDs, filters stale cached cards, and notifies the calendar to remove known-deleted cards. Ordinary network errors are different: they retain the pending change for retry. Deletions made before migration 010 cannot be reconstructed automatically.

### Limits of the protection

Per-CSV revisions protect sequential synchronization against stale caches. The assistant repository still reads and writes a shared JSON envelope; it is not a transactional collaborative editor with conflict dialogs for simultaneous multi-device edits. Device clock differences are also a limitation of timestamp-based ordering. Do not promise safe simultaneous editing based only on these fixes.

Sources: `studentAssistantStorage.ts`, `localFirstSync.ts`, `student_assistant_repository.py`, `admin_event_repository.py`, and migration 010.

## 18 The backend routes and database tables

### The layers on the Python side

A route receives an HTTP request and chooses a response status. A model validator checks the payload's shape and required data. A service connects that request to the relevant operation. A repository maps application fields to database fields and performs Supabase REST calls. The solver is a separate computational component, not a database repository.

For example, updating an event follows routes/admin_events.py, services/admin_event_service.py, models/admin_event.py, and database/supabase/admin_event_repository.py. The validator checks required event fields and times; the repository checks deleted IDs and maps courseCode to title and scheduleKey to schedule_key.

### Main endpoints

| Request | Purpose |
| --- | --- |
| GET /api/health | Reports local service health and whether cloud credentials are configured |
| POST /api/schedules/parse | Normalizes supplied spreadsheet rows |
| GET or PUT /api/schedules/shared | Loads or saves the shared active schedule |
| GET /api/admin-events | Returns ordinary event records |
| GET /api/admin-events?include_deleted=true | Returns events plus deletion metadata |
| PUT or DELETE /api/admin-events/id | Saves an individual event or permanently records its deletion |
| GET or PUT /api/student-assistants/shared | Transfers scoped rosters, results, settings, and revisions |
| POST /api/student-assistant/solve | Runs full or incremental constraint solving |
| GET /api/archives | Returns shared archive records and deletion states |
| PUT or DELETE /api/archives/id | Creates an immutable snapshot or marks its deletion |

### Cloud storage layout

shared_schedules stores the active imported schedule in a JSON envelope. student_assistant_schedules stores a scoped cache envelope in solver_result, alongside the compatibility assistants field and scheduling settings. admin_events stores individual event cards with dates, rooms, times, assistants, descriptions, and schedule keys. schedule_archives stores complete snapshots separately. admin_event_deletions stores permanently deleted event IDs.

The Supabase client uses HTTP with a 15-second timeout and raises RuntimeError on service errors. Flask maps RuntimeError to 503. Validation errors commonly return 400; archive name conflicts return 409; rejected saves for deleted events return 410.

## 19 Desktop startup shutdown and building

### Development and packaged mode

In development, npm run dev starts Vite, Electron, and Flask as separate development commands. Electron loads http://localhost:5173. In the packaged app, Electron starts the bundled auto-scheduler-backend executable and loads dist-react/index.html. The preload bridge exposes the local Flask URL to the isolated interface.

The packaged startup currently opens the window without waiting for the health endpoint. The backend still uses fixed port 5000; dynamic ports and single-instance management were discussed but are not implemented in this source snapshot. An old backend occupying that port can make a new interface talk to the wrong parser version.

### What normal closing now does

mainWindow's close handler and app's before-quit handler call stopFlask. On Windows, stopBackendProcess uses a synchronous taskkill command for the exact spawned backend PID with the full-tree option. It waits for the command to finish, including the child process created by the one-file Python executable. It does not kill all Python processes by name.

If cleanup fails, the close is prevented and an error is shown rather than deliberately leaving an unowned backend behind. Development's separately started Flask server is not owned by this Electron child reference. Forced termination or a crash can bypass normal close handlers; those cases are not equivalent to clicking X.

### Packaging and startup speed

npm run dist:win builds the Python executable with PyInstaller, transpiles Electron code, builds React, and runs electron-builder for a portable executable and MSI. The current backend uses onefile packaging, and the portable app also extracts resources. This helps explain startup delay. Folder-based backend packaging and deferred solver loading have not been implemented.

The package currently copies .env as a resource. The frozen backend looks for it next to the packaged backend resource folder's parent. The latest source is not automatically inserted into an old executable: rebuild after code changes and wait for packaging to finish.

Sources: `frontend/src/desktop/`, `scripts/build-backend.mjs`, `frontend/electron-builder.json`, `frontend/vite.config.ts`, and `package.json`.

## 20 Testing and diagnosing failures

### What the automated checks prove

npm test runs Python backend tests, frontend/helper regression tests, and desktop shutdown unit checks. The tests use synthetic fixtures and mocked database or network calls rather than changing live Supabase records. npm run build validates TypeScript and creates the production interface; npm run transpile:electron validates and emits the desktop entry points.

The optional Windows shutdown integration test creates its own parent and child processes and checks that both stop. The Electron smoke harness uses an isolated profile and synthetic backend responses to exercise real interface actions, including assistant edits, event edits and deletion, and archive saving while cloud requests are deliberately held.

Passing these checks is not the same as testing the distributed executable against a real database on two devices. Packaged startup, cloud migrations, actual network credentials, and real two-device use still need appropriate verification. Existing unrelated lint findings should not be described as newly fixed merely because targeted files pass lint.

### A practical debugging order

| Symptom | First things to check |
| --- | --- |
| Unknown schedule format | Confirm the actual file headers and the running backend's parser version; check for an old process on port 5000 |
| CSV parses but no assistant roster appears | Confirm the active fingerprint and the scoped roster; check the explicit legacy-linking pool |
| Event is local but absent from Supabase | Check pending sync, backend errors, credentials, and required migrations including 010 |
| Old event reappears | Verify migration 010 and deleted-ID propagation; distinguish historical unrecorded deletions |
| No valid manual duty candidate | Check personal classes, duties, events, regular limits, and the duty gap |
| No reliever candidate | Check overlapping commitments; do not assume a regular workload maximum blocked overtime |
| Archive name cannot sync | Look for Rename on the locally saved conflict record; preserve the snapshot |
| New code does not appear in the app | Check that the rebuilt executable is the one being opened and that an old backend is not answering |

### Safe testing habit

Use test CSVs with visibly different contents and different students when checking isolation. Do not delete real Supabase rows merely to make a test pass. Back up meaningful schedules as archives, and remember that clearing app data also removes unsynced local records.

## 21 Questions you should be able to answer

### Why use a solver instead of randomly assigning assistants

The solver searches combinations while enforcing availability and workload constraints. Randomness is used only to help choose among similar model choices; it does not replace the constraints.

### Does maximum workload mean every student must receive that many hours

No. It is an upper bound. Personal schedules and available class duties can leave a student with fewer assigned hours, including zero.

### Can the app work without internet

Local viewing and local saves can work. Parsing and schedule generation still need the bundled local Flask service. Remote sharing needs internet and a working Supabase project. A paused cloud project does not mean the locally stored schedule has disappeared.

### Does removing the CSV delete its original file

No. removeCsv clears the application's active view and active schedule selection. The app does not write generated duties into the source CSV on disk. Duties, rosters, and events are maintained in application storage under the file's fingerprint.

### Does an archive restore an editable current schedule

No. Current archive viewing is read-only. It gives historical preview and supported exports without replacing active work. There is no general Restore to Current feature in the present code.

### Are the scheduling settings applied to overtime

The daily maximum, weekly maximum, and duty gap constrain regular duty generation and manual regular duty assignment. Reliever and event availability still prevent overlapping commitments, but those overtime flows do not simply enforce the same regular-duty caps.

### Can we guarantee all events stay compatible after a full reschedule

Not yet. Events stay saved, but dated event commitments are not included as busy periods in the full solver request. That is a remaining design limitation, not a completed feature.

### What should be explained honestly about syncing

The app queues changes locally and retries shared saves. Scoped revisions and event deletion records address specific stale-data failures. It is still a shared prototype with limited conflict handling, not a fully transactional multi-user collaboration system.

### Is the database ready for public deployment

The current policies allow shared prototype access to anonymous or authenticated clients. These are not per-user authorization boundaries suitable for a public deployment. Bundling an environment file does not make its contents secret; do not distribute privileged service-role credentials.

## Source file reference

The following reference covers application source files, styles, migrations, configuration, and test tooling. Generated builds, dependency packages, spreadsheets, and output artifacts are not independent application features. Empty __init__.py files mark Python packages; they do not contain separate business logic.

@@inventory

## Important function and handler index

This index identifies named functions, exported data contracts, and selected screen declarations in the current source. Line numbers are navigation aids for this snapshot and will change when files are edited. For the reasoning behind the functions, use the preceding process chapters rather than treating a function name as a complete explanation.

@@symbols

## Glossary

| Term | Meaning in this application |
| --- | --- |
| Backend | The local Python service that handles requests and runs the solver |
| Boolean decision variable | A solver value that is either selected or not selected |
| Constraint | A condition that a valid solver answer must satisfy |
| Fingerprint | A SHA-256 identifier derived from uploaded file bytes |
| Hydration | Loading saved local or remote data into the current application's state |
| Incremental solve | Filling available duties for newly added assistants while preserving saved assignments |
| IndexedDB transaction | A local database operation that commits or fails as a unit |
| JSON envelope | An object holding several related fields or keyed caches inside one stored value |
| Objective | The weighted preferences the solver tries to maximize among valid choices |
| Optimized assistant IDs | The saved set used to distinguish previously processed assistants from new additions |
| Pending queue | Locally stored changes awaiting successful synchronization |
| Read only | Viewing captured data with editing actions disabled |
| Revision | A per-CSV marker used to compare newer and older saved changes |
| Roster | The assistants associated with one schedule fingerprint |
| Snapshot | A captured copy of related data at a particular time |
| Tombstone | A retained deletion record that prevents stale data from being recreated |
| Upsert | Insert a new record or update the existing record with the same key |

