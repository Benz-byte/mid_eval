# System Explanation

This document explains every file in the project and every part of the solver code in plain English. No coding experience is needed to understand this.

---

## Purpose of Each File

### Python (Backend)

| File | What it does |
|---|---|
| `python/app.py` | The starting point of the backend. It turns on the server, connects all the routes, and waits for requests from the frontend. |
| `python/database.py` | Handles everything related to the database. Creating tables, saving data, reading data, and deleting data all happen here. |
| `python/routes/subjects.py` | Handles requests related to subjects — adding, viewing, and deleting them. |
| `python/routes/rooms.py` | Handles requests related to rooms and room types — adding, viewing, and deleting them. |
| `python/routes/instructors.py` | Handles requests related to instructors — adding, deleting, assigning subjects, and managing availability windows. |
| `python/routes/schedules.py` | Handles requests to view the generated schedule and to clear it. |
| `python/routes/solver.py` | Handles the request to run the solver. It collects all data from the database and passes it to the CP-SAT solver. |
| `python/solver/cpsat_solver.py` | The brain of the system. This is where the actual scheduling logic lives. It figures out which instructor goes in which room at which time. |

### TypeScript / React (Frontend)

| File | What it does |
|---|---|
| `src/api/types.ts` | Defines the shape of all data objects used in the frontend, like what a Subject or Room looks like. |
| `src/api/client.ts` | Contains all the functions that the frontend uses to talk to the backend — fetching, saving, and deleting data. |
| `src/ui/App.tsx` | The main screen of the application. Contains all four tabs: Subjects, Rooms, Instructors, and Schedule. |

### Electron

| File | What it does |
|---|---|
| `src/electron/main.ts` | Launches the desktop window and starts the Flask backend server in the background when the app opens. |
| `src/electron/preload.ts` | Acts as a bridge between the desktop window and the backend, passing the server address to the frontend. |

### Config Files

| File | What it does |
|---|---|
| `package.json` | Lists all the JavaScript packages the project needs and the commands to run or build the app. |
| `python/requirements.txt` | Lists all the Python packages the project needs, including Flask and OR-Tools. |
| `electron-builder.json` | Tells electron-builder how to package the app for Windows, macOS, and Linux. |
| `vite.config.ts` | Configuration for the frontend build tool. |

---

## CP-SAT Solver Explanation (cpsat_solver.py)

The solver is the most important and most complex file in the project. Here is what every part does, explained simply.

---

### The Constants at the Top

```python
WINDOW_START_MINUTES = 7 * 60
WINDOW_END_MINUTES = 21 * 60
ALIGNMENT_MINUTES = 30
```

These are fixed numbers used throughout the file.
- The system only schedules between 7:00 AM and 9:00 PM. Converting to minutes makes the math easier — 7 hours times 60 minutes = 420 minutes from midnight.
- All time slots must start and end on exact 30-minute marks like 7:00, 7:30, 8:00. No odd times like 7:15 are allowed.

---

### `_time_to_minutes`

```python
def _time_to_minutes(time_str):
```

Converts a time like "09:30" into a single number — in this case 570 (9 times 60 plus 30). This makes it easy to compare and calculate time differences using simple math instead of juggling hours and minutes separately.

---

### `_is_aligned`

```python
def _is_aligned(minutes):
```

Checks if a time lands exactly on a 30-minute mark starting from 7:00 AM. For example, 7:00 is aligned, 7:30 is aligned, but 7:15 is not. This prevents the system from creating odd time slots.

---

### `_slot_duration`

```python
def _slot_duration(timeslots):
```

Looks at all the time slots in the database and finds the shortest one. In this system it will always return 30 because all slots are 30 minutes long. This is just a safety check.

---

### `_allowed_timeslots`

```python
def _allowed_timeslots(timeslots, slot_duration_minutes):
```

Goes through every time slot in the database and keeps only the ones that are valid. A valid slot must be exactly 30 minutes long, must fall between 7:00 AM and 9:00 PM, and must start and end on a 30-minute boundary. Any slot that does not meet these rules is removed before scheduling starts.

---

### `_get_session_patterns`

```python
def _get_session_patterns(hours_per_week, slot_duration_minutes):
```

Figures out how a subject's weekly hours can be split into sessions. For example:
- A 3-hour subject needs 6 slots of 30 minutes. It can be scheduled as one 3-hour block on a single day, or split into two 1.5-hour blocks on two different days.
- A 5-hour subject needs 10 slots. It can be one long block, or split as 2+3 hours, or 2.5+2.5 hours.

This gives the solver options to work with instead of forcing everything into one rigid pattern.

---

### `_find_consecutive_blocks`

```python
def _find_consecutive_blocks(timeslots, slots_needed):
```

Finds all the possible consecutive sequences of time slots within each day. Consecutive means one slot ends exactly when the next one starts — no gaps. For example, 8:00-8:30 followed by 8:30-9:00 is consecutive. 8:00-8:30 followed by 9:00-9:30 is not, because there is a gap at 8:30-9:00.

This function returns a list of all valid unbroken sequences of the required length for each day of the week.

---

### `_candidate_blocks`

```python
def _candidate_blocks(timeslots, patterns, permitted_timeslot_ids):
```

Builds the final list of all possible time blocks for a subject. It uses the consecutive sequences found above and combines them based on the session patterns. For split patterns like 1.5+1.5 hours, it pairs blocks from two different days.

If an instructor has availability windows set, only blocks where every slot falls within those windows are kept. This is the hard filter — if a block has even one slot outside the instructor's available hours, that block is completely removed from consideration. The solver never even sees it.

---

### `_parse_instructor_availability`

```python
def _parse_instructor_availability(instructor_availability, timeslot_map, allowed_timeslot_ids):
```

Reads the instructor's availability settings from the database and converts them into a list of allowed time slot IDs per instructor.

Two types of availability are supported:
- **Whole-week** — the instructor is available at those hours every day. Stored with no specific day.
- **Day-specific** — the instructor is only available at those hours on a particular day.

The override rule: if day-specific windows exist for a day, they completely replace the whole-week windows for that day. This allows something like "available 7AM to 5PM every day, but on Wednesday only 10AM to 12PM."

---

### `_availability_satisfaction_score`

```python
def _availability_satisfaction_score(block, instructor_id, timeslot_map, availability_windows):
```

Scores how well a time block fits within the instructor's availability window. It adds up how much time is left in the window after each slot ends. A block placed early in the window gets a higher score because more time is left after it. This was originally used for soft optimization but is now mainly kept for reference.

---

### `_preferred_time_deviation`

```python
def _preferred_time_deviation(block, instructor_id, subject_id, timeslot_map, preferred_start_map):
```

Calculates how far a block is from the instructor's preferred start time for a specific subject. If the block starts at exactly the preferred time, the deviation is 0. If it starts at any other time, the deviation is 8. This score is used in Stage 2 of the solver to pick the block that best matches the instructor's preference.

---

### `_status_name`

```python
def _status_name(solver, status):
```

Converts a solver status code into a readable word like "FEASIBLE" or "INFEASIBLE" so the frontend can display a meaningful message instead of a number.

---

### `_diagnostics`

```python
def _diagnostics(pairs, pair_data, subject_map, instructor_map, rooms, allowed_timeslot_ids, allowed_timeslots_per_instructor):
```

When the solver cannot find a valid schedule, this function figures out why and writes a human-readable explanation. It checks for:
- Subjects that have no matching room type
- Instructor-subject pairs that have no valid time blocks within availability
- Instructors who need more time slots than they have available
- Room types where there are not enough rooms to fit all subjects

Instead of just saying "no solution found," the system tells the admin exactly what the problem is.

---

### `run_cpsat_solver` — The Main Function

```python
def run_cpsat_solver(subjects, rooms, instructors, instructor_subjects, timeslots, instructor_availability, preferred_time_slots):
```

This is the function that gets called when the admin clicks Run Solver. Everything else in the file is a helper for this function. Here is what it does step by step:

**Step 1 — Check if data exists**
Before doing anything, it checks if there are subjects assigned to instructors, if there are rooms, and if there are time slots. If any of these are missing, it returns an error immediately without running the solver.

**Step 2 — Filter valid timeslots**
Keeps only the 30-minute aligned slots between 7:00 AM and 9:00 PM.

**Step 3 — Build lookup maps**
Creates dictionaries to quickly find any timeslot, instructor, or subject by their ID number. This avoids searching through the full list every time something is needed.

**Step 4 — Parse availability**
Converts the instructor availability records from the database into a set of allowed time slot IDs per instructor.

**Step 5 — Build preferred time map**
Creates a lookup of preferred start times per instructor-subject pair for use in Stage 2.

**Step 6 — Group rooms by type**
Organizes rooms into groups based on their type so the solver can quickly find matching rooms for each subject.

**Step 7 — Build pair data**
For each instructor-subject assignment, the solver:
- Finds all rooms that match the subject type and have enough capacity
- Applies floor restrictions if the instructor has one set
- Generates all valid candidate time blocks filtered by availability
- Stores everything together as one scheduling unit

If any pair has no valid rooms or no valid blocks, the solver stops here and reports the problem.

**Step 8 — Build the CP-SAT model**
This is where the actual constraint programming happens. For each instructor-subject pair, the solver creates decision variables:
- One variable to choose which room to use
- One variable to choose which time block to use
- Boolean flags to track exactly which room and which time slots are being used

**Step 9 — Add hard constraints**
Two rules are enforced that can never be broken:
- An instructor cannot be in two places at the same time
- A room cannot have two classes at the same time

These are enforced using a constraint called "at most one" — for any given time slot, at most one class can be using a specific instructor or room.

**Step 10 — Stage 1: Find a feasible solution**
The solver runs for the first time with no optimization goal. It just tries to find any schedule that satisfies all the hard constraints. If it cannot find one within 30 seconds, it returns infeasible and runs the diagnostics function to explain why.

**Step 11 — Stage 2: Minimize preferred time deviation**
If preferred times are set, the solver runs again with a new goal: minimize the total deviation from all instructors' preferred start times. This means the solver will try to rearrange blocks so that as many instructors as possible get scheduled at their preferred time. Blocks that match the preferred time score 0, everything else scores 8. The solver picks the arrangement with the lowest total score.

**Step 12 — Return the result**
The solver reads the chosen room and block for each pair and builds the final list of assignments. Each assignment says: this subject, with this instructor, in this room, at this time slot. The list is returned to the Flask API, which saves it to the database.
