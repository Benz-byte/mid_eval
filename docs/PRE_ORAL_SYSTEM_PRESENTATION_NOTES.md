# Pre-Oral System Presentation Notes

## Purpose of these notes

Use these notes as speaking prompts. Do not read them word for word. During the
demonstration, explain what the administrator is doing, what the system checks,
and which specific objective the feature proves.

## One-sentence system description

The Automated Laboratory Assistant Scheduling System is an administrator-only
desktop application that imports the existing CCS class and room schedule,
uses CP-SAT to generate feasible regular-duty assignments for laboratory
assistants, manages events and vacant rooms, and uses lexicographic
multi-criteria sorting to recommend relievers.

## Important scope clarification

- The system does not create the institutional class schedule.
- It does not assign subjects or instructors to rooms.
- The existing class and room schedule is an input to the system.
- The system assigns laboratory assistants to feasible laboratory duties.
- Regular duty is limited to a maximum of 20 hours per week. An assistant is
  allowed to receive fewer than 20 hours.
- Event and reliever assignments are recorded separately as overtime.
- The desktop application is intended for the administrator. Student
  assistants are schedule subjects, not direct users of the current app.

## Technical overview to explain before the demonstration

```text
Administrator
    |
    v
Electron + React desktop interface
    |
    v
Bundled local Flask backend
    |
    +-- CP-SAT solver for regular-duty schedules
    |
    +-- Supabase for shared cloud records
    |
    +-- Local storage for immediate local access and offline fallback
```

Suggested explanation:

> The administrator uses a packaged Electron desktop application. React and
> TypeScript provide the interface. A Flask backend and the CP-SAT solver are
> bundled inside the application and run locally, so schedule generation can
> operate without internet access. Supabase stores and synchronizes shared
> records when an internet connection is available.

## Recommended live demonstration order

Prepare the official class schedule and several assistant class-schedule files
before presenting. Use realistic data with at least one event, one absence, and
several eligible relievers.

### Part 1: Load the existing CCS schedule

Specific objectives supported: Objectives 1, 2, and 4.

Clicks:

1. Open the packaged Auto Scheduler desktop application.
2. Select the **Schedule** tab.
3. Click **Upload Schedule**.
4. Select the official `.csv`, `.xls`, or `.xlsx` class schedule.
5. Choose a date using the date field.
6. Switch between **Daily** and **Weekly** views.
7. In Weekly view, use the room selector to move between laboratory rooms.
8. If available, open the **Conflicts** or **TBA** indicator to show the input
   validation information.

What to explain:

> The uploaded file is the existing institutional schedule. The application
> parses its rooms, subjects, instructors, sections, days, and times. This
> schedule becomes the source of possible laboratory duties and the basis for
> checking room availability. The system does not generate or modify the
> instructors' teaching schedule.

What each control does:

- **Upload Schedule** imports the official schedule.
- The date input changes the displayed calendar date.
- **Daily** displays all selected rooms for one date.
- **Weekly** displays one selected room from Monday to Friday.
- The filter button limits the display by room or instructor.
- **Conflicts** identifies overlapping schedule entries in the imported data.
- **TBA** lists incomplete schedule records.
- **Remove CSV** removes the current imported schedule. Do not click this
  during the live demonstration.

### Part 2: Add laboratory assistants

Specific objectives supported: Objectives 1 and 2.

Clicks:

1. Select the **Student Assistant** tab.
2. Click the menu icon in the upper-left corner.
3. Click **Add Student Assistant**.
4. Enter the last name, first name, and optional middle name.
5. Upload the assistant's class schedule.
6. Click **Add Student**.
7. Repeat for the other prepared assistants.
8. Use the sidebar to select an assistant and view that person's calendar.

What to explain:

> Each assistant's uploaded class schedule represents times when that person
> is unavailable for regular duty. The solver uses this information as a hard
> scheduling constraint. A laboratory duty cannot overlap the assistant's
> personal class schedule.

Additional controls:

- The search field finds an assistant by name or student ID.
- The pencil button edits the profile or replaces the class-schedule file.
- The delete button removes the profile, class schedule, and assignments.
- **Scheduling Settings** changes the minimum break required after three
  continuous hours of regular duty.

### Part 3: Generate the optimized regular-duty schedule

Specific objectives demonstrated: Objectives 1, 2, and 5.

Clicks:

1. Confirm that the top-right indicator shows the main schedule as uploaded.
2. Click **Create optimized schedule**.
3. Wait for **Schedule created**.
4. Select different assistants from the sidebar.
5. Point to personal-class blocks and assigned-duty blocks on the weekly
   calendar.
6. Click **Weekly Summary**.
7. Show **Regular duty scheduled**, **Event overtime**, **Reliever overtime**,
   and **Total workload**.

What happens after the click:

1. React sends the official schedule, assistant profiles, class schedules, and
   scheduling settings to the bundled Flask backend.
2. Flask validates the request and passes it to the CP-SAT solver.
3. The solver removes assistant-duty combinations that conflict with personal
   classes.
4. It prevents overlapping regular duties.
5. It limits regular duty to a maximum of 20 hours per assistant per week and
   six hours per day.
6. It applies the configured break after three continuous duty hours.
7. It maximizes feasible laboratory coverage and balances regular workload.
8. The result is returned to React, displayed in the calendars, saved locally,
   and synchronized to Supabase.

Suggested explanation:

> This demonstrates the automated scheduling objective. Twenty hours is the
> maximum regular workload, not a required workload. An assistant may receive
> 10 or 15 hours if those are the feasible assignments. Event and reliever work
> is displayed separately as overtime and is not counted against the regular
> 20-hour limit.

#### Where CP-SAT is located

- Main solver: `backend/solver/student_assistant_solver.py`
- Weekly maximum: lines 13 and 393-401
- No overlapping duties: line 402
- Daily maximum: lines 404-410
- Workload-balancing objective: lines 456-475
- Solver execution and result handling: begins around line 478

Do not open the source code unless the panel requests technical evidence.

### Part 4: Demonstrate an absence and reliever assignment

Specific objective demonstrated: Objective 3.

This is also where Lexicographic Multi-Criteria Sorting appears.

Clicks:

1. Return to the **Schedule** tab.
2. Select a date containing a class with an assigned assistant.
3. Click the class card showing the assigned assistant.
4. In **Report Student Assistant Absence**, choose **This duty only** or
   **This day**.
5. Click **Find Reliever**.
6. Explain the candidate list and point to the **Recommended** label.
7. Select the recommended candidate or another eligible candidate.
8. Click **Assign Reliever**.
9. Review the confirmation details.
10. Click **Confirm Assignment**.
11. Point to the updated class card and the reliever's weekly calendar.
12. Open **Weekly Summary** for the replacement assistant and show the reliever
    overtime.

What happens after **Find Reliever**:

1. The absent assistant is removed from consideration.
2. Assistants with an overlapping personal class are removed.
3. Assistants with an overlapping regular duty, event, reliever duty, or
   already reserved replacement are removed.
4. The remaining eligible assistants are sorted by priority.
5. The first candidate is marked **Recommended**.

#### Lexicographic priority order

1. Lowest resulting weekly workload
2. Lowest resulting daily workload
3. Shortest resulting consecutive-duty duration
4. Fewest resulting duties for that day
5. Student ID as the deterministic final tie-breaker

The second criterion is considered only if the first criterion is tied. The
third is considered only if the first two are tied, and so on. This ordered
comparison is why the method is lexicographic.

Suggested explanation:

> Lexicographic multi-criteria sorting is applied after the system filters out
> unavailable assistants. Candidates are compared according to an ordered set
> of workload criteria. Weekly workload has the highest priority. Lower
> criteria are evaluated only when the preceding criterion is tied. The
> highest-ranked eligible candidate is presented as the recommended reliever,
> while the administrator retains final approval.

#### Where lexicographic sorting is located

- Function: `rankRelievers`
- File: `frontend/src/ui/schedule/ScheduleCalendar.tsx`
- Eligibility filtering: lines 606-620
- Candidate measurements: lines 621-633
- Lexicographic sorting: lines 635-640

The implementation uses chained `||` comparisons. A comparison that returns
zero means a tie, so the next lower-priority comparison is evaluated.

### Part 5: Demonstrate event and vacant-room management

Specific objective demonstrated: Objective 4.

Clicks:

1. Stay on the **Schedule** tab.
2. Click **Add Event**.
3. Enter the event title.
4. Use the calendar button to select one or more dates.
5. Choose or add the required time slots.
6. Review **Room availability**.
7. Explain the labels **Vacant**, **Occupied**, **Has an event**, and
   **Already booked**.
8. Select an available room.
9. Click **Add Event**.
10. Close the event panel and select the event card on the schedule.
11. Click **Add Assistant**.
12. Select an available laboratory assistant.
13. Click **Save**.
14. Open that assistant's **Weekly Summary** and show the event overtime.

What to explain:

> Room availability is calculated using the imported class schedule and saved
> administrative events. For assistant assignment, the system excludes people
> who have a personal class, regular duty, reliever duty, or another event at
> the selected date and time. Event assignments are recorded as overtime.

Additional event controls:

- **Add Time Slot** adds another period to the selected date.
- **Apply Times** copies selected time slots to other event dates.
- **Apply Rooms** copies selected rooms to other event dates.
- Selecting an existing event card opens its details.
- **Edit** changes an event or booking.
- **Delete** removes the selected event card after confirmation.
- **Manage Events** displays saved event groups and allows deletion.

## Objective-to-demonstration summary

| Specific objective | Feature to demonstrate | Evidence |
|---|---|---|
| Automated laboratory-assistant scheduling | Create optimized schedule | Generated weekly duty assignments |
| Workload balancing and constraint management | Calendar and Weekly Summary | No class overlap; regular duty remains at or below 20 hours |
| Reliever assignment and schedule adjustment | Report absence and Find Reliever | Ranked eligible candidates and confirmed replacement |
| Event and vacant-room management | Add Event and Add Assistant | Room status, saved event, and available assistant assignment |
| CP-SAT integration | Create optimized schedule | Feasible or optimal solver result and balanced assignments |

## How local and Supabase saving works

Suggested explanation:

> When the administrator changes schedules, assistants, events, relievers, or
> settings, the app saves the change locally first and attempts to synchronize
> it with Supabase. This allows the packaged desktop application and CP-SAT
> solver to continue operating without internet access. Cloud synchronization
> and updates across installations require an internet connection.

Do not claim that assistants currently have accounts or a web portal. The
current application is administrator-only.

## Questions the panel may ask

### Why use CP-SAT?

> Scheduling contains many yes-or-no assignment decisions and hard constraints.
> CP-SAT efficiently searches feasible combinations while preventing conflicts
> and optimizing coverage and workload balance.

### Does every assistant need exactly 20 hours?

> No. Twenty hours is the maximum regular-duty workload. Fewer hours are
> allowed when there are not enough feasible duties or when availability is
> limited.

### Can the displayed total exceed 20 hours?

> Yes. The total can exceed 20 because event and reliever assignments are
> recorded separately as overtime. The 20-hour constraint applies to regular
> laboratory duty.

### Is lexicographic sorting part of CP-SAT?

> They have separate purposes. CP-SAT generates the regular-duty schedule.
> Lexicographic multi-criteria sorting ranks eligible reliever candidates after
> an absence is reported.

### Does the system schedule professors and subjects?

> No. It imports the existing institutional schedule and uses it as the basis
> for laboratory-assistant assignments and room-availability checking.

### Can the app work without Wi-Fi?

> The administrator can open the app, access locally saved information, import
> files, and run CP-SAT without Wi-Fi. Internet access is required for Supabase
> synchronization.

### Why can the administrator choose someone other than the recommended reliever?

> The ranking provides decision support, but the administrator retains final
> authority because operational circumstances may not be completely represented
> in the stored schedule data.

### Are archiving and exporting included?

> They are technically feasible enhancements, but they are not currently part
> of the implemented specific objectives. Their implementation depends on the
> official adviser and panel revision requirements.

## Demo safety checklist

- Use the packaged application, not `npm run dev`.
- Test the same MSI or portable executable on the presentation computer.
- Prepare all schedule files in one easy-to-find folder.
- Confirm the imported official schedule has valid rooms and dates.
- Prepare enough assistants to generate meaningful assignments.
- Know in advance which class card will be used for the absence demonstration.
- Confirm that at least two eligible reliever candidates appear.
- Prepare one event date and time with both vacant and occupied rooms.
- Confirm Supabase synchronization before the presentation.
- Keep a local backup of the demo files and the portable executable.
- Keep screenshots or a short backup recording in case the live demonstration
  encounters an equipment problem.

## Closing statement after the demonstration

> The demonstration shows that each approved specific objective has a
> corresponding working module. CP-SAT produces feasible regular-duty
> assignments under the defined constraints, while lexicographic multi-criteria
> sorting ranks the eligible relievers. Event management, vacant-room
> identification, workload monitoring, local operation, and Supabase
> synchronization complete the administrator's scheduling workflow.
