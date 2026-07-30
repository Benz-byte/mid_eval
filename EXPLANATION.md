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

#### `vite.config.ts`

This configures Vite and the React plugin used during development and building.

#### `eslint.config.js`

This configures ESLint, which reports suspicious or inconsistent TypeScript and
React code.

#### `electron-builder.json`

This tells Electron Builder how to package the desktop application, which icon
to use, and which application files to include.

#### `desktopIcon.png`

This is the image used as the packaged desktop application icon.

#### `tsconfig.json`

This is the main TypeScript configuration. It points TypeScript toward the
separate application and Node configuration files.

#### `tsconfig.app.json`

This configures TypeScript checks for browser-facing React code in `src`.

#### `tsconfig.node.json`

This configures TypeScript checks for Node-based configuration code such as
Vite's config file.

#### `README.md`

This is the short description normally displayed on the repository's GitHub
home page.

#### `EXPLANATION.md`

This is the detailed setup and code guide you are reading.

### React interface files

#### `src/ui/main.tsx`

This is the React starting point. It finds the HTML element named `root` and
renders the main `App` component inside it.

#### `src/ui/index.css`

This contains global page styles and basic browser resets applied before the
more specific application styles.

#### `src/ui/App.tsx`

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

#### `src/ui/App.css`

This controls layout, colors, spacing, calendars, event blocks, forms, the
event drawer, responsive widths, and scrollbars. CSS changes appearance; it
does not decide scheduling rules.

#### `src/electron.d.ts`

This tells TypeScript that the browser window contains
`window.electron.flaskUrl`. The actual value is provided by the preload script.

### Frontend API files

#### `src/api/scheduleRepository.ts`

This reads and writes the singleton `ccs-main` row in `shared_schedules`.
It also subscribes to real-time changes so another device's upload can refresh
the current device.

#### `src/api/adminEventRepository.ts`

This converts between frontend event objects and `admin_events` database rows.
It contains functions to load, save, delete, and subscribe to events.

#### `src/api/studentAssistantRepository.ts`

This reads and writes the singleton `ccs-main` row in
`student_assistant_schedules`. The row contains the uploaded assistants and the
latest solver result as JSON. Its real-time subscription refreshes other
running devices.

#### `src/api/studentAssistantSolver.ts`

This defines the TypeScript shapes of solver inputs and outputs. Its
`solveStudentAssistantSchedule` function sends an HTTP POST request to:

```text
http://127.0.0.1:5000/api/student-assistant/solve
```

It converts the Flask response back into data the React calendar can use.

### Electron files

#### `src/electron/main.ts`

This is the desktop-process entry point.

- It creates a 1280×800 Electron window.
- During development it loads the Vite address.
- In a packaged application it loads the built HTML file.
- In production it starts Flask automatically.
- It stops Flask when the application closes.
- `contextIsolation: true` and `nodeIntegration: false` prevent ordinary
  webpage code from having unrestricted computer access.

#### `src/electron/preload.ts`

This safely exposes only the Flask URL to React:

```ts
window.electron.flaskUrl
```

#### `src/electron/util.ts`

This contains the small `isDev` helper used to decide whether the program is
running from source or as a packaged application.

#### `src/electron/tsconfig.json`

This tells TypeScript how to compile Electron's main process.

#### `src/electron/tsconfig.preload.json`

This separately configures compilation of the secure preload script.

### Python files

#### `python/app.py`

This creates the Flask service.

- `CORS(app)` allows the local React address to call Flask.
- `GET /api/health` returns `{"status":"ok"}` for a simple health check.
- `POST /api/student-assistant/solve` accepts JSON, validates that it is an
  object, calls the solver, and returns JSON.
- Invalid requests receive HTTP status 400.

#### `python/requirements.txt`

This lists the Python packages installed by `npm install`:

- Flask: local HTTP service
- Flask-CORS: permission for the React development address to call Flask
- OR-Tools: CP-SAT scheduling engine

#### `python/solver/__init__.py`

This marks `python/solver` as a Python package so `app.py` can import the solver.

#### `python/solver/student_assistant_solver.py`

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

#### `database/supa/supabase.ts`

This reads the Supabase URL and publishable key from Vite environment values.
If both are valid, it creates the shared Supabase client. Otherwise, it exports
`null`, allowing the local interface to continue without cloud access.

#### `database/supa/migrations/001_shared_schedule.sql`

This creates `shared_schedules`, its prototype read/write security policies,
and its real-time publication entry.

#### `database/supa/migrations/002_admin_events.sql`

This creates `admin_events`, migrates older event JSON into individual rows,
adds read/create/update/delete policies, and enables real-time updates.

#### `database/supa/migrations/003_student_assistant_schedules.sql`

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
   python -m pip install -r python/requirements.txt
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

Run `database/supa/migrations/003_student_assistant_schedules.sql` in the
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

## 10. Updating an Existing Clone

```powershell
git switch main
git pull origin main
npm install
npm run dev
```

Run `npm install` after pulling because dependencies such as OR-Tools may have
changed.
