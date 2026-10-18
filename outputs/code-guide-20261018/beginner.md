## 0 Start here if the system is new to you

### What problem the application solves

The department already has a class timetable. Student assistants also have their own classes. Someone must decide which assistant can cover each department duty without attending two things at once or exceeding the regular-duty settings. Our application helps make those decisions, records manual changes, manages extra events and temporary replacements, and keeps historical copies.

Creating a schedule assigns assistants to existing class duties. It does not move the department's original classes to different rooms or change the students' enrolled class times. The input timetable supplies those times. The solver chooses who covers eligible work.

### The people and records in an example

Anna Santos and Ben Cruz are student assistants. CCS 1001 is a department class in MT102 every Monday from 7 AM to 10 AM. Anna's personal schedule contains Mathematics every Monday from 8 AM to 9 AM. Ben has no personal class then. Anna is unavailable for that whole overlapping duty; Ben may be eligible if the workload and other rules allow it.

A department class is not an assistant profile. A personal class is not a duty. A duty assignment links an assistant to a department class. An event is extra dated work. A reliever temporarily covers an existing duty on a particular date. An archive captures these records together so they can be viewed later.

### What the two tabs mean

The Schedule tab organizes the department's work by rooms and dates. It is the place to inspect classes, room conflicts, events, and assignment actions. The Student Assistant tab organizes information by person. Its calendar combines that person's personal classes, regular duties, assigned events, and replacement duties for the selected week.

Switching tabs changes the presentation of saved data. It should not delete assignments or start the solver. Moving to another week changes which dated events and relievers are shown; recurring weekday duties still apply unless date-specific rules such as an exam date suppress them.

### A first complete workflow

First, upload the department schedule. The app checks its format and creates a usable timetable. A recognized file can still contain unresolved entries; review TBA and conflict information rather than assuming every imported row is suitable for assignment.

Next, add an assistant and upload that student's personal schedule. Repeat for the other assistants. These profiles belong to the currently uploaded schedule's identifier. Adding a profile alone does not promise that the student will immediately receive duty hours.

Click Create schedule. Scheduling Settings opens. Choose the daily limit, weekly limit, and duty gap. Leave the full-reschedule option unchecked for normal incremental use. Click Proceed. The dialog closes and the button shows Creating schedule while the backend calculates. The moving fill is an activity animation, not a measured percentage.

Review the result in both tabs. Check assistant availability, uncovered duties, and the weekly workload list. You may assign eligible assistants manually to unassigned duties. Those changes are saved as working assignments; you do not need to rerun the solver just to save them.

For an event, add its title, dates, rooms, and times. Assign assistants through the relevant event card. For a temporary duty replacement, use Find Reliever on the existing assigned duty. These are different operations: one creates dated event work, and the other covers work that already has an original assistant.

When the schedule is ready to preserve, save an archive with a unique name, school year, and semester. After a successful local archive save, the current schedule closes. View the archive from Archives when needed. It remains a historical preview rather than becoming editable active work.

### What saving means in this application

There are four distinct outcomes. A form may still contain an unsaved draft. A completed action may have been saved on this device. That local change may subsequently have synchronized to Supabase. An archive is an additional historical snapshot. Do not treat these as interchangeable states.

Closing a draft is different from removing saved data. Removing the active CSV is different from deleting the original file on disk. Viewing another week is different from creating another timetable. Exporting Excel is different from backing up every database field. The later chapters explain these distinctions through examples.

### A plain language guide to code terms

A variable is a named value, such as the selected date. A function is a reusable operation, such as formatting a time. An object groups named values, such as an assistant's ID and name. An array is a list of records. A map stores values under keys, such as the roster for each uploaded schedule.

A component is a piece of the React interface. State is the data a component currently uses to draw itself. A callback is a function passed to another component so it can report an action. A request sends data to a service; a response brings back the result. An asynchronous operation can finish later, so code must await it or handle its eventual result.

A database table holds rows with named columns. JSON is a way to represent nested objects and lists. PostgreSQL JSONB stores that structure inside one column. A schema describes the database's tables, columns, types, and rules. Sections 18A through 18E explain the actual schema using those definitions.

Sources: `frontend/src/ui/app/App.tsx`, `frontend/src/ui/student-assistants/StudentAssistantPanel.tsx`, `frontend/src/ui/schedule/ScheduleCalendar.tsx`, and `frontend/src/storage/`.
