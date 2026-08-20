# Auto Scheduler: Beginner-Friendly Project Guide

This document explains how to install the project, how its parts communicate,
what CP-SAT does, and what every file in the repository is for. It is written
for someone who has little or no programming experience.

## 1. What the Application Does

Auto Scheduler is a desktop application with two main features:

1. **Schedule** displays an imported class schedule by date and room. It also
   lets a user create, edit, and delete special events.
2. **Student Assistant** imports several assistants' personal class schedules
   and creates recurring weekly duty schedules that avoid their classes.

The application runs locally on the computer. Supabase stores shared data so
different computers can see the same schedules. A local browser-storage copy is
also kept so the interface remains useful when the database is unavailable.

## 2. The Technologies in Plain Language

- **React** builds the buttons, forms, calendars, and other visible interface.
- **TypeScript** is JavaScript with extra checks that catch many mistakes before
  the application runs.
- **Vite** starts the React development server and builds the interface.
- **Electron** puts the web-style React interface inside a desktop window.
- **Flask** is a small local Python web service used by the scheduler.
- **OR-Tools CP-SAT** searches for a student-assistant assignment that satisfies
  the scheduling rules.
- **Supabase** is the online PostgreSQL database and real-time synchronization
  service.
- **CSV** files contain the main class schedule and assistants' personal class
  schedules.

## 3. How the Parts Communicate

```text
User
  |
  v
React interface in the Electron window
  |                         |
  | HTTP request            | Database requests
  v                         v
Local Flask service       Supabase
  |
  v
CP-SAT solver
```

Example when the user creates an assistant schedule:

1. React reads the uploaded CSV files.
2. React converts every valid CSV row into a JavaScript event object.
3. React sends the main schedule and assistant schedules to Flask as JSON.
4. Flask gives the JSON to the CP-SAT solver.
5. The solver returns assignments or an explanation that no solution exists.
6. React draws the result on the weekly calendar.
7. React saves the imported assistants and latest result locally and in
   Supabase.

## 4. Install and Run

### Requirements

Install:

- Node.js 18 or newer
- Python 3.10 or newer
- Git, if cloning
- Visual Studio Code or another editor

Check the installations:

```powershell
node --version
npm --version
python --version
```

### Clone from GitHub

```powershell
git clone https://github.com/Benz-byte/mid_eval.git
cd mid_eval
code .
```

If `code` is not recognized, open Visual Studio Code, choose **File → Open
Folder**, and select the `mid_eval` folder.

### Download as ZIP

1. On GitHub, choose **Code → Download ZIP**.
2. Extract the ZIP.
3. Open the extracted folder in Visual Studio Code.

Do not run the project from inside the ZIP.

### Install everything

From the folder containing `package.json`, run:

```powershell
npm install
```

This installs the JavaScript packages. The `postinstall` script also runs
`scripts/setup-python.mjs`, which installs Flask, Flask-CORS, and OR-Tools.

### Start the application

```powershell
npm run dev
```

This starts:

- React/Vite at `http://localhost:5173`
- Flask at `http://127.0.0.1:5000`
- The Electron desktop window

## 5. Supabase Configuration and Tables

The frontend uses:

```env
VITE_SUPABASE_URL=your-project-url
VITE_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

A publishable key is intended for frontend applications. Never commit a
service-role key, secret key, private key, or database password.

Run the SQL migrations in numerical order using **Supabase Dashboard → SQL
Editor**:

1. `001_shared_schedule.sql`
2. `002_admin_events.sql`
3. `003_student_assistant_schedules.sql`

The tables are:

| Table | What it stores |
|---|---|
| `shared_schedules` | The main imported CSV filename and its parsed class rows |
| `admin_events` | Manually created events, one event per database row |
| `student_assistant_schedules` | Imported assistant schedules and the latest solver result |

If the student assistants disappear on another computer and Supabase reports
404, the third migration has not been run.

## 6. How CP-SAT Works

### What “CP-SAT” means

**CP** means constraint programming. A constraint is a rule such as “Chris
cannot work during his Math class.”

**SAT** refers to Boolean satisfiability. A Boolean value has only two choices:
true or false. The scheduler creates many yes/no questions such as:

```text
Should Chris cover CCS 2100?  yes or no
Should Rene cover CCS 2200?   yes or no
```

The solver tries combinations intelligently. It does not simply test every
possible schedule one at a time.

### Inputs

The solver receives:

- The main class schedule: possible duties that may be covered
- A list of assistants
- Each assistant's personal classes: times when that person is unavailable

Times are stored as minutes after midnight. For example:

```text
8:00 AM  = 480 minutes
1:30 PM  = 810 minutes
```

Using numbers makes comparison and addition easier.

### Preparing the data

`MW` becomes separate Monday and Wednesday meetings. `TTh` becomes Tuesday and
Thursday meetings.

Each meeting is divided into 30-minute coverage units. A two-hour class becomes
four units:

```text
8:00–8:30
8:30–9:00
9:00–9:30
9:30–10:00
```

The units make it easy to count exact working time. However, all units belonging
to one CSV class row are tied to one assistant. A class is never split between
assistants, and an `MW` class uses the same assistant on both days.

### Decision variables

For every allowed assistant-and-class combination, the model creates a Boolean
variable:

```text
1 = assign this class to this assistant
0 = do not assign it
```

If an assistant's personal class overlaps any meeting of a duty class, that
combination is not created at all.

### Hard constraints

A hard constraint may never be broken:

1. **At most one assistant per class.**
2. **Exactly 20 duty hours per assistant each week.**
3. **No assistant can perform two duties at the same time.**
4. **No duty can overlap an assistant's personal class.**
5. **An assistant can have at most six duty hours in one day.**
6. **All meetings from one CSV class row use the same assistant.**

Classes are currently allowed to remain unassigned for testing.

### Optimization goal

After satisfying the hard constraints, the solver maximizes:

```text
number of classes assigned
```

This means it tries to cover as many classes as possible while still giving
every uploaded assistant exactly 20 valid weekly hours.

### Solver result

Possible statuses:

- `OPTIMAL`: the solver proved that it found the best possible result.
- `FEASIBLE`: it found a valid result but reached the time limit before proving
  that no better result exists.
- `INFEASIBLE`: the rules cannot all be satisfied.
- `INVALID`: required input is missing or malformed.

The solver gets up to 60 seconds and uses eight worker threads.

### Small example

Suppose Ana has Math on Monday from 8:00 to 10:00. A Monday duty from 9:00 to
11:00 is rejected for Ana because the times overlap. A Monday duty from 10:00
to 12:00 is allowed because one period ends exactly when the other begins.

## 7. Source Files Explained

### Root application files

#### `package.json`

This is the JavaScript project manifest.

- `dependencies` lists packages needed while the app runs, such as React and
  Supabase.
- `devDependencies` lists development tools such as Electron, TypeScript,
  ESLint, and Vite.
- `npm run dev` starts React, Electron, and Flask together.
- `npm run build` checks TypeScript and builds the React interface.
- `npm run lint` checks code style and common programming mistakes.
- `postinstall` installs the Python requirements after `npm install`.

#### `package-lock.json`

This generated file records exact package versions. It makes installations on
different computers more consistent. Developers normally do not edit it by
hand.

#### `index.html`

This is the small HTML page into which React is inserted. The visible interface
is created by React rather than written directly in this file.

#### `frontend/vite.config.ts`

This configures Vite and the React plugin used during development and building.

#### `eslint.config.js`

This configures ESLint, which reports suspicious or inconsistent TypeScript and
React code.

#### `frontend/electron-builder.json`

This tells Electron Builder how to package the desktop application, which icon
to use, and which application files to include.

#### `assets/desktopIcon.png`

This is the image used as the packaged desktop application icon.

#### `tsconfig.json`

This is the main TypeScript configuration. It points TypeScript toward the
separate application and Node configuration files.

#### `frontend/tsconfig.app.json`

This configures TypeScript checks for browser-facing React code in `src`.

#### `frontend/tsconfig.node.json`

This configures TypeScript checks for Node-based configuration code such as
Vite's config file.

#### `README.md`

This is the short description normally displayed on the repository's GitHub
home page.

#### `EXPLANATION.md`

This is the detailed setup and code guide you are reading.

### React interface files

#### `frontend/src/ui/app/main.tsx`

This is the React starting point. It finds the HTML element named `root` and
renders the main `App` component inside it.

#### `frontend/src/ui/app/index.css`

This contains global page styles and basic browser resets applied before the
more specific application styles.

#### `frontend/src/ui/app/App.tsx`

This is the largest frontend file and controls most visible behavior.

Important sections:

- `CalendarEvent` describes the common shape of a class or admin event.
- `parseCsv` reads CSV text while correctly handling commas inside quotes.
- `parseCsvTime` converts CSV times into minutes after midnight.
- `csvRowsToEvents` converts valid CSV rows into `CalendarEvent` objects.
- `matchesSelectedDay` understands ordinary days plus `MW` and `TTh`.
- Local-storage functions restore the last schedule, active tab, date, events,
  assistants, and solver result.
- `ScheduleCalendar` draws the room-based calendar and its class/event blocks.
- `AdminEventsPanel` validates event times, finds vacant rooms, and supports
  adding, editing, and deleting events.
- `AssistantWeeklyCalendar` draws purple personal-class blocks and blue duty
  blocks. The label inside each block explains its type.
- `StudentAssistantPanel` uploads multiple assistant CSVs, calls Flask, switches
  between assistants, draws results, and saves shared assistant data.
- `App` holds the shared state, loads Supabase data, subscribes to database
  changes, and decides which tab is visible.

React state such as `useState(...)` is the component's memory. `useEffect(...)`
runs synchronization work after rendering, such as loading Supabase data or
subscribing to changes. `useMemo(...)` avoids recalculating derived data when
its inputs have not changed.

#### `frontend/src/ui/app/App.css`

This controls layout, colors, spacing, calendars, event blocks, forms, the
event drawer, responsive widths, and scrollbars. CSS changes appearance; it
does not decide scheduling rules.

#### `frontend/src/types/electronApi.ts`

This tells TypeScript that the browser window contains
`window.electron.flaskUrl`. The actual value is provided by the preload script.

### Frontend API files

#### `frontend/src/api/scheduleApi.ts`

This reads and writes the singleton `ccs-main` row in `shared_schedules`.
It also subscribes to real-time changes so another device's upload can refresh
the current device.

#### `frontend/src/api/adminEventApi.ts`

This converts between frontend event objects and `admin_events` database rows.
It contains functions to load, save, delete, and subscribe to events.

#### `frontend/src/api/studentAssistantApi.ts`

This reads and writes the singleton `ccs-main` row in
`student_assistant_schedules`. The row contains the uploaded assistants and the
latest solver result as JSON. Its real-time subscription refreshes other
running devices.

#### `frontend/src/api/studentAssistantApi.ts`

This defines the TypeScript shapes of solver inputs and outputs. Its
`solveStudentAssistantSchedule` function sends an HTTP POST request to:

```text
http://127.0.0.1:5000/api/student-assistant/solve
```

It converts the Flask response back into data the React calendar can use.

### Electron files

#### `frontend/src/desktop/main.ts`

This is the desktop-process entry point.

- It creates a 1280×800 Electron window.
- During development it loads the Vite address.
- In a packaged application it loads the built HTML file.
- In production it starts Flask automatically.
- It stops Flask when the application closes.
- `contextIsolation: true` and `nodeIntegration: false` prevent ordinary
  webpage code from having unrestricted computer access.

#### `frontend/src/desktop/preload.ts`

This safely exposes only the Flask URL to React:

```ts
window.electron.flaskUrl
```

#### `frontend/src/desktop/environment.ts`

This contains the small `isDev` helper used to decide whether the program is
running from source or as a packaged application.

#### `frontend/src/desktop/tsconfig.json`

This tells TypeScript how to compile Electron's main process.

#### `frontend/src/desktop/tsconfig.preload.json`

This separately configures compilation of the secure preload script.

### Python files

#### `backend/app.py`

This creates the Flask service.

- `CORS(app)` allows the local React address to call Flask.
- `GET /api/health` returns `{"status":"ok"}` for a simple health check.
- `POST /api/student-assistant/solve` accepts JSON, validates that it is an
  object, calls the solver, and returns JSON.
- Invalid requests receive HTTP status 400.

#### `backend/requirements.txt`

This lists the Python packages installed by `npm install`:

- Flask: local HTTP service
- Flask-CORS: permission for the React development address to call Flask
- OR-Tools: CP-SAT scheduling engine

#### `backend/solver/__init__.py`

This marks `backend/solver` as a Python package so `app.py` can import the solver.

#### `backend/solver/student_assistant_solver.py`

This contains the complete CP-SAT model.

- Constants define weekday order, 20 hours per week, six hours per day, and
  30-minute units.
- `Meeting` stores one actual meeting day and time.
- `CoverageUnit` stores one smaller portion used for minute calculations.
- `_expand_days` converts combined day codes.
- `_parse_meetings` validates input and creates `Meeting` objects.
- `_coverage_units` divides meetings into 30-minute pieces.
- `_overlaps` detects time conflicts using:

  ```text
  first start < second end AND first end > second start
  ```

- `_merge_assignments` joins consecutive 30-minute results back into readable
  calendar blocks.
- `_assignment_payload` converts a Python object into JSON-ready fields.
- `solve_student_assistant_schedule` validates inputs, creates variables,
  adds constraints, sets the maximizing goal, runs CP-SAT, and returns results.

### Database files

#### `backend/database/supabase/client.py`

This reads the Supabase URL and publishable key from the project environment
and sends authenticated REST requests for the backend repositories. When cloud
settings are absent, the frontend continues using its local cache.

#### `database/supabase/migrations/001_shared_schedule.sql`

This creates `shared_schedules`, its prototype read/write security policies,
and its real-time publication entry.

#### `database/supabase/migrations/002_admin_events.sql`

This creates `admin_events`, migrates older event JSON into individual rows,
adds read/create/update/delete policies, and enables real-time updates.

#### `database/supabase/migrations/003_student_assistant_schedules.sql`

This creates `student_assistant_schedules` with:

- `id`: the shared row name
- `assistants`: imported assistant data stored as JSON
- `solver_result`: latest generated result stored as JSON
- `updated_at`: last database update time

It also adds prototype read/create/update policies and real-time updates.

### Installation script

#### `scripts/setup-python.mjs`

This runs automatically after `npm install`.

1. It looks for a working Python command.
2. It prints a clear error if Python is missing.
3. It runs:

   ```powershell
   python -m pip install -r backend/requirements.txt
   ```

4. It stops installation if the Python packages fail to install.

### Sample data files

The files below are example assistant schedules, not application code:

- `student_assistant_weekly_class_schedule.csv`
- `student_assistant_weekly_schedule_2.csv`
- `student_assistant_weekly_schedule_3.csv`
- `student_assistant_weekly_schedule_4.csv`
- `student_assistant_weekly_schedule_5.csv`

They can be uploaded in the Student Assistant tab to test multiple people.

## 8. Where Data Is Saved

| Data | Local fallback | Supabase |
|---|---|---|
| Main CSV classes | Browser local storage | `shared_schedules` |
| Admin events | Browser local storage | `admin_events` |
| Assistant CSV data | Browser local storage | `student_assistant_schedules` |
| Latest solver result | Browser local storage | `student_assistant_schedules` |

“Browser local storage” here belongs to Electron's embedded browser on that
computer. It is not automatically shared with other computers.

## 9. Common Problems

### VS Code shows no files

Use **File → Open Folder** and select the extracted or cloned project folder.

### Electron is blank

Wait for Vite to print its local address, then press `Ctrl+R` in Electron.
Look in the terminal for a JavaScript or Flask error.

### `npm` or `python` is not recognized

Install the missing program, enable Python's **Add Python to PATH** option, and
restart Visual Studio Code.

### Flask package is missing

```powershell
python -m pip install -r python\requirements.txt
```

### Assistant database is unavailable

Run `database/supabase/migrations/003_student_assistant_schedules.sql` in the
Supabase SQL Editor. A publishable key can use an existing table but cannot
create a table.

### A schedule is infeasible

Check:

- There are at least 20 available duty hours per assistant.
- Personal classes do not block too many duty opportunities.
- Each assistant can reach 20 hours without exceeding six hours on one day.
- Whole recurring classes can be assigned without splitting them.

### A port is already in use

Close older Vite, Electron, or Flask processes, then run `npm run dev` again.

## 10. Code Walkthrough, From Top to Bottom

This section is the closest useful version of a **line-by-line explanation**.
Lines that form one instruction are explained together. For example, an
`import` that spans four printed lines is one instruction, so explaining each
printed line separately would make the guide harder, not easier, to follow.

Some words used below:

- A **variable** is a named box that holds information.
- A **function** is a named set of instructions that can be reused.
- A **parameter** is information given to a function.
- A **return value** is the answer sent back by a function.
- An **array** is a list.
- An **object** is a group of named values.
- A **component** is a React function that draws part of the screen.
- `const` creates a name whose reference will not be replaced.
- `let` creates a name whose value may be replaced later.
- `if` runs code only when a condition is true.
- `for` repeats code for the items in a list.
- `async` means a function may have to wait for work such as a database call.
- `await` pauses that function until the awaited work finishes.
- `null` means “there is deliberately no value.”
- `?.` safely reads a value only if the value on its left exists.
- `??` uses the value on its right only when the value on its left is missing.
- `...` copies or spreads the items from an array or object.

Line numbers can move as the project changes. Use the function and file names
as the reliable landmarks.

### `frontend/src/ui/app/main.tsx`: start the visible application

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './index.css'
```

- The first line brings in React's development checker.
- The second brings in the instruction that attaches React to the web page.
- The third brings in this project's main screen.
- The fourth loads global colors, sizing, and layout rules.

```tsx
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

`document.getElementById('root')` finds the empty `<div id="root">` in
`index.html`. The `!` tells TypeScript that the author knows this element
exists. `createRoot` turns it into React's drawing area. `render` places
`App` inside it. `StrictMode` helps reveal unsafe behavior during development;
it does not draw anything visible.

### `frontend/src/ui/app/App.tsx`: types and constants

The imports at the top collect four kinds of tools:

1. React tools such as `useState`, `useEffect`, and `useMemo`.
2. Icons used on buttons.
3. repository functions that read and write Supabase.
4. the function that asks the local Python solver to build a schedule.

The `CalendarEvent` interface is a description, not stored data. It tells
TypeScript that every calendar entry must have an ID, day, start and end time,
room, and the other displayed class fields. Interfaces such as
`AdminEventForm`, `AssistantSchedule`, and `Tab` do the same for forms,
uploaded assistants, and the two possible page tabs. These checks disappear
when the finished app runs; their job is to catch mistakes while coding.

Constants such as the storage keys prevent the same text from being typed in
many places. `DAY_ORDER`, hour limits, calendar start/end times, and similar
constants give meaningful names to values that would otherwise look like
unexplained numbers.

### `toDateInputValue`

```tsx
function toDateInputValue(date: Date) {
  const offset = date.getTimezoneOffset()
  return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 10)
}
```

1. The function receives a JavaScript date.
2. `getTimezoneOffset()` finds the difference between local time and UTC.
3. `getTime()` changes the date into milliseconds.
4. The offset is subtracted so the local day does not accidentally become the
   previous or next day during conversion.
5. `toISOString()` produces text such as
   `2026-07-31T00:00:00.000Z`.
6. `slice(0, 10)` keeps only `2026-07-31`, the format required by an HTML date
   box.

### `createEmptyAdminForm`

This returns a fresh event form. The date parameter defaults to today. Every
text field begins empty, giving React a complete and predictable object to put
in its state. Calling this after saving also clears the form.

### `parseCsv`

This function changes the raw text of an uploaded CSV file into rows and
columns.

1. `rows`, `row`, and `field` start as empty containers.
2. `insideQuotes` remembers whether the reader is currently inside quoted
   text.
3. The `for` loop examines one character at a time.
4. A quote followed by another quote means a literal quote inside a field.
5. A single quote switches quoted mode on or off.
6. A comma ends a field only when it is outside quotes. This is why a subject
   such as `"Programming, Part 1"` is kept together.
7. A line break ends the current row, again only outside quotes.
8. `\r` is ignored because Windows line endings contain both `\r` and `\n`.
9. Ordinary characters are added to the current field.
10. The last field and row are added after the loop because a file does not
    always end with a line break.
11. Completely empty rows are removed.

### `parseCsvTime`, `parseInputTime`, and `formatTime`

The program does time calculations with **minutes after midnight**. For
example, 8:30 AM becomes `8 × 60 + 30 = 510`.

- `parseCsvTime` accepts the time text found in CSV files. It trims spaces,
  recognizes AM/PM, checks that the numbers are valid, changes 12 AM to hour
  zero, adds 12 for PM when needed, and returns total minutes. Bad text returns
  `null`, which lets the caller skip an invalid row safely.
- `parseInputTime` handles the browser's simpler 24-hour `HH:MM` value. It
  splits at `:`, converts both parts to numbers, then calculates total minutes.
- `formatTime` performs the reverse operation for people. It calculates the
  hour and minute, chooses AM or PM, changes hour zero to 12, and pads minutes
  such as `5` to `05`.

### `normalizeField` and `csvRowsToEvents`

`normalizeField` trims surrounding spaces and changes a heading to lowercase.
That lets headings such as `Room`, ` room `, and `ROOM` be treated alike.

`csvRowsToEvents` converts the table made by `parseCsv` into calendar objects:

1. It stops with an empty list when there is no header row.
2. It normalizes the headings and finds each needed column by name.
3. It loops through all data rows after the heading.
4. It reads and validates the start and end times.
5. A row is skipped if its day is missing or its time is invalid.
6. A stable ID is assembled from the row's values and position.
7. A `CalendarEvent` object is made with all class details.
8. The completed list is returned.

This separation is useful: `parseCsv` understands CSV punctuation, while
`csvRowsToEvents` understands what this application's columns mean.

### Small loading helpers

- `matchesSelectedDay` checks whether an event belongs on the chosen date. It
  also expands combined codes such as `MW` and `TTh`.
- `loadAdminEvents` reads saved admin events from browser storage. `try/catch`
  prevents old or damaged saved text from crashing the app.
- `loadCsvSchedule` restores the last imported main CSV and its filename.
- `loadActiveTab` restores which tab was open and falls back to the Schedule
  tab.
- `loadScheduleDate` restores the selected calendar date and falls back to
  today.

All browser-storage values are text. `JSON.parse` turns saved JSON text back
into arrays or objects; `JSON.stringify` does the opposite when saving.

### `ScheduleCalendar`

This component draws the main day calendar.

1. Its parameters supply events, the selected date, and functions for changing
   the date.
2. `useMemo` builds the list of events for only the selected weekday. React
   recalculates it only when the source events or date change.
3. Another calculation collects and sorts the rooms, which become columns.
4. Hour values become horizontal guide lines.
5. `positionForMinute` converts a time into a vertical pixel position. In
   simple terms, later times are drawn farther down.
6. `moveDate` makes a copy of the selected date, moves it by a requested number
   of days, and gives it back to the parent.
7. `selectDate` converts the date input's text into a local `Date`.
8. The returned JSX draws navigation buttons, a date input, time labels, room
   headings, and event blocks.
9. Each event block's `top` comes from its start time and its `height` comes
   from its duration.
10. A `key` gives React a stable identity for each repeated room or event.

JSX looks like HTML, but values inside `{...}` are JavaScript. An expression
such as `events.map(...)` means “make one visible block for every event.”

### `AdminEventsPanel`

This component owns the add/edit form for special events.

- `useState` remembers the form values and the ID currently being edited.
- `useMemo` finds rooms that are not occupied during the proposed event time.
- `updateField` copies the old form and replaces one named field. React state
  must be replaced rather than edited directly.
- `submit` prevents the browser's normal page reload, validates the values,
  checks that the end is later than the start, sends the form to the parent,
  then clears the form.
- `startEditing` copies an existing calendar event into form-friendly values.
- Canceling clears the editing ID and restores a blank form.
- The JSX changes button labels depending on whether the user is adding or
  editing and maps saved events into rows with Edit and Delete buttons.

The component does not directly write Supabase. It asks its parent to save or
delete. This keeps the form concerned with form behavior and the parent
concerned with shared application data.

### Assistant loading and calendar helpers

`loadLocalAssistantData` reads the uploaded assistant list and last solver
result from browser storage. It validates the basic shapes and returns empty
defaults if parsing fails.

`expandedDayCodes` turns a combined day code into individual days. The
assistant view needs this because it has one separate column per weekday.

`AssistantWeeklyCalendar` draws two kinds of blocks:

- personal classes, showing when the assistant is unavailable;
- generated duty assignments, showing when that assistant should work.

Its `position` function changes minutes into vertical pixels. It filters data
for each day, then maps the data into absolutely positioned blocks. Different
CSS classes give personal classes and duties different colors.

### `StudentAssistantPanel`

This component controls the entire assistant workflow.

1. State remembers uploaded assistants, the selected assistant, whether the
   solver is running, the latest result, and any error message.
2. An effect restores shared data when the component first loads or receives
   updated props.
3. The upload handler reads every selected CSV with `file.text()`.
4. Each file passes through `parseCsv` and `csvRowsToEvents`.
5. Empty or invalid schedules are rejected with a readable message.
6. Valid files become assistant objects with IDs, labels, and schedules.
7. `saveAssistantData` saves locally first, then tries Supabase. Local saving
   keeps the screen useful even if cloud access is unavailable.
8. The generate handler checks that the main and assistant schedules exist.
9. It sets the running flag so the interface can disable the button and show
   progress.
10. It calls `solveStudentAssistantSchedule`, stores the answer, and chooses an
    assistant to display.
11. `try/catch/finally` means: try the request, show a useful error if it
    fails, and always turn off the running flag at the end.
12. `visibleDiagnostics` hides messages that are not useful in the successful
    view.
13. The returned JSX draws upload controls, assistant selector buttons, totals,
    solver messages, and `AssistantWeeklyCalendar`.

### The main `App` component

`App` is the application's coordinator.

- Its state holds the selected tab, main CSV data, date, admin events, and
  shared assistant data.
- Effects save state to browser storage whenever those values change.
- Startup effects request the latest Supabase rows. If Supabase is not
  configured or is temporarily unreachable, local values remain available.
- Subscription effects listen for database changes made by another running
  computer and reload the relevant information.
- The CSV upload handler reads the main schedule, converts it to events, saves
  it, and tries to publish it to Supabase.
- `removeCsv` removes the imported main schedule from the screen and local
  storage.
- `saveAdminEvent` either creates a new ID or preserves the edited event's ID,
  updates the local list, and sends the event to Supabase.
- `deleteAdminEvent` removes the selected event locally and from Supabase.
- The final JSX draws the sidebar/header and chooses either the main Schedule
  screen or the Student Assistant screen according to the active tab.

The repeated pattern “update locally, then update Supabase” is intentional:
the user sees an immediate response and the application can still operate
locally when the network is unavailable.

### `frontend/src/api/*.ts`: talking to Flask

The frontend API files send HTTP requests to the local Flask service. Flask
validates and processes requests, and the repositories under
`backend/database/supabase/` perform shared-data CRUD. Local storage remains
the immediate offline copy.

`scheduleApi.ts` handles the shared main schedule, `adminEventApi.ts` handles
individual events, and `studentAssistantApi.ts` handles assistant data and
solver requests. Their matching Python repositories convert between API field
names and Supabase columns.

### `frontend/src/api/studentAssistantApi.ts`: send work to Python

The interfaces at the top describe the exact request and answer shapes. For
example, `DutyAssignment` guarantees that a returned assignment contains its
assistant, class, day, times, and room.

Inside `solveStudentAssistantSchedule`:

1. `fetch` sends a request to the Flask URL exposed by Electron.
2. `method: 'POST'` says the request is submitting data.
3. The content-type header says the body is JSON.
4. `JSON.stringify({ mainSchedule, assistants })` turns the two JavaScript
   values into request text.
5. `await response.json()` turns Flask's JSON reply back into an object.
6. A failed response becomes an exception unless it is a normal validation
   answer that the interface knows how to display.
7. A successful or expected result is returned to React.

### `frontend/src/desktop/main.ts`: create the desktop program

The imports provide Electron's app/window objects, file-path helpers, the
ability to start another process, and the local `isDev` check.

- `__dirname` reconstructs the current folder because modern ES modules do not
  create that name automatically.
- `flaskProcess` remembers the running Python process. It starts as `null`
  because Python is not running yet.
- `startFlask` chooses the Python script's development or packaged location,
  chooses `python` on Windows and `python3` elsewhere, and starts it with
  `spawn`.
- The `stdout` and `stderr` listeners copy Python messages into Electron's
  console, which makes troubleshooting possible.
- The `close` listener records that the Python process has ended.
- `stopFlask` ends Python. Windows uses `taskkill` for the entire child process
  tree; other systems send the normal `SIGTERM` shutdown signal.
- The `ready` event starts Flask in a packaged build and creates a 1280 by 800
  desktop window.
- `preload` names the limited bridge script.
- `contextIsolation: true` and `nodeIntegration: false` keep ordinary page code
  separated from powerful computer functions.
- Development loads Vite at port 5173 and opens developer tools. Production
  loads the built HTML file.
- `before-quit` stops Python.
- `window-all-closed` quits the app except on macOS, where applications
  commonly remain open after their last window closes.

### `frontend/src/desktop/preload.ts` and `frontend/src/desktop/environment.ts`

The preload script uses `contextBridge.exposeInMainWorld` to give React one
safe value: `window.electron.flaskUrl`. React receives the local service
address without receiving unrestricted Node.js access.

`isDev` checks Electron's packaged flag. It returns `true` while running from
source and `false` for an installed build.

### `backend/app.py`: receive the browser request

```py
from flask import Flask, jsonify
from flask import request
from flask_cors import CORS
from solver.student_assistant_solver import solve_student_assistant_schedule
```

These lines import the web service, JSON response helper, incoming request,
cross-origin permission helper, and this project's scheduling function.

Inside `create_app`:

1. `Flask(__name__)` creates the service.
2. `CORS(app)` allows the Electron/Vite page to call that service.
3. `@app.get("/api/health")` attaches the next function to a simple health
   address. It returns `{"status": "ok"}`.
4. `@app.post(...)` attaches the solver function to the solve address.
5. `request.get_json(silent=True)` reads JSON without showing Flask's default
   error page for malformed input.
6. A value that is not a JSON object receives status `INVALID` and HTTP 400.
7. Valid input is passed to `solve_student_assistant_schedule`.
8. Validly processed answers use HTTP 200; invalid input uses HTTP 400.
9. `jsonify` converts the Python dictionary into a JSON response.
10. `return app` gives the completely configured service back to the caller.

`app = create_app()` constructs the service. The final `if` block runs it only
when this file is launched directly. It listens only on this computer at port
5000, disables debug mode, and disables the reloader so Electron gets one
predictable Python process.

### `backend/solver/student_assistant_solver.py`: build the schedule

The imports provide grouped lists, compact data classes, flexible type hints,
and Google's CP-SAT solver.

The constants say:

- which number belongs to each weekday;
- how combined weekday codes expand;
- every assistant needs exactly 20 hours per week;
- an assistant may work at most 6 hours per day;
- the solver divides coverage into 30-minute pieces.

`Meeting` is a frozen data class for a real class meeting. “Frozen” means its
values cannot be accidentally changed after creation. `CoverageUnit` is one
piece of a meeting. Its `duration` property simply returns `end - start`.

#### `_expand_days`

The function removes spaces, expands `MW` or `TTh`, accepts a single known day,
and rejects an unsupported day with a precise error. The trailing comma in
`(normalized,)` is what makes a one-item Python tuple.

#### `_parse_meetings`

1. Start with an empty meeting list.
2. `enumerate` loops over events while also providing a row number.
3. Read start/end values, using `-1` when missing.
4. Reject negative, backwards, equal, or beyond-midnight times.
5. Use the supplied ID or create a fallback ID.
6. Expand combined weekdays and make one `Meeting` for each actual day.
7. Convert optional values to trimmed strings so missing values do not cause
   type errors.
8. Return all parsed meetings.

#### `_coverage_units`

For every main-schedule meeting, `cursor` begins at its start. The `while` loop
makes 30-minute pieces until the end is reached. `min` makes the last piece
shorter when necessary. The cursor then moves to that piece's end. This gives
the solver small choices while preserving the exact number of minutes.

#### `_overlaps`

Two periods conflict when they are on the same day, the first starts before
the second ends, and the first ends after the second starts. Periods that
merely touch—one ends exactly when another begins—do not overlap.

#### `_merge_assignments` and `_assignment_payload`

The solver chooses small units, but people need readable blocks.

1. Selected units are grouped by assistant and original meeting.
2. Each group is sorted by start time.
3. Neighboring units are extended into one continuous period.
4. A gap closes the current block and starts another.
5. `_assignment_payload` changes each completed block into a JSON-ready
   dictionary using the frontend's expected field names.
6. The final list is sorted by weekday, time, room, and assistant.

#### `solve_student_assistant_schedule`: validation

The function first reads `mainSchedule` and `assistants`. Missing or empty
lists return `INVALID` with instructions a person can act on.

Inside `try`, it parses the main schedule, cuts it into coverage units, and
parses every assistant's personal classes. The two dictionaries connect an
assistant ID to their visible name and busy meetings. `except` catches bad
input and returns its message instead of crashing Flask.

It next compares all assistants' required minutes with all available coverage
minutes. If there are not enough total hours even before considering clashes,
it immediately returns `INFEASIBLE` and explains the shortage.

#### Create the CP-SAT model

`model = cp_model.CpModel()` creates an empty mathematical decision model. The
dictionaries after it organize the model's variables:

- `assignment_vars`: whether an assistant covers one small unit;
- `optional_intervals`: the selected units placed on a weekly timeline;
- `assistant_unit_vars`: all unit choices belonging to one assistant;
- `daily_vars`: choices grouped by assistant and day;
- `class_assistant_vars`: whether one assistant takes an original class;
- `unit_candidates`: assistants who could take a unit.

`units_by_class` groups the small pieces back under their original classes.

For every assistant and class:

1. Check the class units against every personal busy meeting.
2. `continue` skips that whole class if there is any conflict.
3. Create a yes/no `class_variable` for a conflict-free candidate.
4. Create a yes/no variable for each unit in that class.
5. Register the variable in each helpful grouping dictionary.
6. `model.add(variable == class_variable)` means an assistant takes all pieces
   of a class or none of them.
7. Build an optional interval on a single week-long timeline. It exists only
   if its assignment variable is true.

#### Add the rules

- `add_at_most_one` on every coverage unit prevents two assistants from
  covering the same time.
- `add_at_most_one` on every class prevents a class from being split among
  assistants.
- The equality with `MINUTES_PER_WEEK` requires exactly 20 hours for every
  assistant.
- `add_no_overlap` prevents one assistant from receiving simultaneous duties.
- The daily inequality limits an assistant to six hours on any day.
- `maximize(sum(class_assistant_vars.values()))` asks for the valid schedule
  that covers the greatest number of complete classes.

These are **hard rules** except for the last line, which is the preference used
to choose among schedules that obey every hard rule.

#### Run and return the result

The solver receives up to 60 seconds and may use eight worker threads.
`solve(model)` performs the search.

If it cannot find a solution, the function returns `INFEASIBLE` with the
relevant limits. Otherwise:

1. Look at every assignment variable.
2. Keep the units whose value is true.
3. Add their durations to each assistant's total.
4. Merge neighboring units into calendar blocks.
5. Find original classes that were and were not assigned.
6. Print the unassigned count for developers.
7. Return status, assignments, assistant totals, summary numbers, and an empty
   diagnostics list as JSON-ready data.

`OPTIMAL` means the solver proved no better valid schedule exists. `FEASIBLE`
means it found a valid schedule within the time limit but did not prove that
it was the absolute best.

### CSS, configuration, SQL, and data files

Not every line in the repository is executable program logic:

- In `App.css` and `index.css`, a selector chooses visible elements and the
  lines inside `{}` set appearance. `display: flex` or `grid` controls layout;
  colors control meaning; media queries adjust smaller screens.
- TypeScript configuration files tell the compiler which language features,
  folders, and safety checks to use.
- `frontend/vite.config.ts` configures the web build and Electron development process.
- `package.json` names reusable commands and required packages.
- `package-lock.json` is automatically generated; normally, a person should
  not edit it line by line.
- SQL migration lines create database tables, columns, access policies, and
  real-time publication settings. They are run in numeric order.
- CSV rows are input data rather than code. Their headings tell the importer
  what each column means.
- PNG and XLSX files are binary assets or generated output; they do not contain
  source lines to explain.

## 11. Updating an Existing Clone

```powershell
git switch main
git pull origin main
npm install
npm run dev
```

Run `npm install` after pulling because dependencies such as OR-Tools may have
changed.


