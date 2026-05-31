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

## Is the Solver Code Well Sectioned and What Activates First

Yes, the solver code is deliberately structured in a specific order. Every function and every step inside the main function exists for a reason, and the order matters. If you ran them out of order, the solver would either crash or produce wrong results. Here is the exact sequence of what activates and why it has to happen in that order.

---

### Layer 1 — Helper Functions (Defined First, Called Later)

The file starts with small helper functions. These are not called immediately when the file loads. They just sit there ready to be used. They have to be defined before the main function because Python reads files top to bottom — you cannot call a function that has not been defined yet.

```
_time_to_minutes        → converts time text to a number
_is_aligned             → checks if a time is on a 30-minute boundary
_slot_duration          → finds the shortest slot in the database
_allowed_timeslots      → filters out invalid timeslots
_get_session_patterns   → figures out how to split weekly hours into sessions
_find_consecutive_blocks → finds all unbroken sequences of slots per day
_candidate_blocks       → builds the full list of valid time block options
_parse_instructor_availability → converts availability records to allowed slot sets
_availability_satisfaction_score → scores how well a block fits a window
_preferred_time_deviation → measures deviation from preferred time
_status_name            → converts a solver status code to readable text
_diagnostics            → explains why the solver failed
```

None of these run until `run_cpsat_solver` calls them.

---

### Layer 2 — The Main Function: What Activates and When

When the admin clicks Run Solver, the Flask API calls `run_cpsat_solver`. Here is the exact order of what happens inside it and why each step must come before the next.

**Step 1 — Data validation (must be first)**
Before doing any work, the function checks if there is any data to work with. No instructor assignments, no rooms, no timeslots — all of these cause an immediate return with an error message. There is no point running the rest if the basic inputs are missing.

**Step 2 — Filter valid timeslots (must come before availability parsing)**
`_slot_duration` and `_allowed_timeslots` run here. This produces the set of valid timeslot IDs that the entire rest of the function relies on. Availability parsing and block generation both need this set, so it has to be ready first.

**Step 3 — Build lookup maps (must come before anything that needs fast ID lookup)**
Three dictionaries are built here — one for timeslots, one for instructors, one for subjects. These are used constantly throughout the rest of the function to find data by ID quickly. They need to exist before any function that searches by ID.

**Step 4 — Parse availability (must come before block generation)**
`_parse_instructor_availability` runs here. It converts availability records into a set of allowed timeslot IDs per instructor. This set is passed directly to `_candidate_blocks` in the next step. If availability is parsed after blocks are generated, the blocks would not be filtered correctly.

**Step 5 — Build preferred time map (must come before model building)**
Preferred times are converted from text to integers here. This map is used when computing deviation scores for each block. It needs to exist before the model loop runs.

**Step 6 — Group rooms by type (must come before pair building)**
Rooms are organized into groups by their type. This is used in the next step to quickly find matching rooms for each subject. If this grouping happened inside the pair loop, it would be rebuilt hundreds of times unnecessarily.

**Step 7 — Build pair data (must come before model building)**
For each instructor-subject assignment, this step finds matching rooms, applies floor restrictions, generates candidate blocks, and stores everything as one unit. If any pair has no valid rooms or no valid blocks, the function stops here and reports the problem before the model is even built. There is no point building a model if we already know it has no solution.

**Step 8 — Build the CP-SAT model (must come after all pair data is ready)**
Only now does the actual CP-SAT model get created. Variables and constraints are added for each pair using the data prepared in the previous steps. The model cannot be built before pair data exists because it depends on knowing how many rooms and blocks each pair has.

**Step 9 — Add overlap constraints (must come after all variables are created)**
The instructor and room overlap constraints are added after the full model loop. They work by grouping variables across pairs — you cannot group them until all pairs have been processed and all their variables exist.

**Step 10 — Stage 1: Find feasible solution (must come before Stage 2)**
The solver runs for the first time here with no optimization goal. If this fails, the function returns immediately with a diagnostic message. Stage 2 cannot run if Stage 1 found nothing.

**Step 11 — Stage 2: Minimize preferred time deviation (runs only if preferred times exist)**
The solver runs again with a new objective. This step is skipped entirely if no preferred times were set. There is no wasted computation.

**Step 12 — Build and return assignments (last step)**
The chosen rooms and blocks are read from the solver and converted back into a list of assignments. This is the output that gets saved to the database.

---

### Why This Order Cannot Be Changed

Each step produces output that the next step depends on. Timeslot filtering must happen before availability parsing because availability parsing needs the valid timeslot IDs. Availability parsing must happen before block generation because block generation uses the allowed slot sets. Pair data must be complete before the model is built. The model must be built before the solver can run. If any of these steps ran in the wrong order, the function would either crash with a missing variable error or produce incorrect results silently.

The structure is a pipeline — data flows in one direction, each step transforming it into a form the next step can use.

---

## How CP-SAT Works and Why We Had to Prepare the Data First

CP-SAT is a constraint solver. It does not understand text, names, or real-world concepts like "instructor" or "room." It only works with two types of values: **integers** (whole numbers) and **booleans** (true or false, represented as 1 and 0). Everything has to be converted into one of those two forms before CP-SAT can do anything with it.

This is the reason why there are so many helper functions before the main solver runs. Each one is a preparation step that converts our real-world data into the numeric form CP-SAT can accept.

---

### Problem 1 — CP-SAT does not understand time strings

Times in our database are stored as text like "09:30" or "14:00". CP-SAT cannot compare or calculate with text. So before anything else, we convert every time string into a single integer representing minutes from midnight. "09:30" becomes 570. "14:00" becomes 840. Now CP-SAT can compare them, subtract them, and check if one falls within a range.

---

### Problem 2 — CP-SAT does not understand "availability windows"

An availability window is a concept — it means an instructor is free between two times on a certain day. CP-SAT does not know what that means. So we convert availability windows into a plain set of integers — specifically, the IDs of the timeslots that fall within those windows. CP-SAT does understand integers. So instead of telling it "this instructor is free from 7AM to 10AM on Monday," we give it a set like {1, 2, 3, 4, 5, 6} representing the six 30-minute slots in that window. Any block that contains a slot ID not in that set is removed before the model is built.

---

### Problem 3 — CP-SAT does not understand "instructor" or "room" as concepts

In our database, instructors and rooms have names and IDs. CP-SAT only sees numbers. So we build lookup dictionaries that map each ID to its data, and we represent every scheduling decision as an integer index. For example, if an instructor has three valid rooms, we create an integer variable that can be 0, 1, or 2. Value 0 means the first room, value 1 means the second room, and so on. After the solver finishes, we read that integer and look up which actual room it refers to.

---

### Problem 4 — CP-SAT cannot directly enforce "no two classes in the same room at the same time"

This rule sounds simple in English but CP-SAT does not have a built-in concept of "same room same time." To express this, we create boolean variables — one for each combination of pair, room, and timeslot. A boolean value of 1 means that pair is using that room at that time. A boolean value of 0 means it is not. We then use the `add_at_most_one` constraint on all boolean variables that share the same room and timeslot. This tells CP-SAT that at most one of those can be 1 at the same time, which is exactly what "no double booking" means in numeric terms.

---

### Problem 5 — CP-SAT cannot directly minimize "deviation from preferred time"

Preferred time is a text string like "07:00" in our database. We cannot put that directly into an optimization objective. So we convert it to minutes (420), compute a deviation score for every possible block (0 if it matches, 8 if it does not), store those scores in a plain list of integers, and use the `add_element` constraint to link the block choice variable to its corresponding score. CP-SAT then minimizes the sum of all score variables, which in practice means it picks blocks that match preferred times.

---

### The overall translation process

Every step between reading the database and calling `solver.solve()` is a translation step. We take human-readable scheduling data and convert it piece by piece into integers, booleans, index variables, and constraint rules. CP-SAT then searches through all possible combinations of those values and finds the one that satisfies all the rules. We take that result and translate it back into a readable schedule. CP-SAT handles the search. We handle the translation.

---

## What is Ours vs What Comes from CP-SAT

This section clearly separates what we wrote ourselves from what CP-SAT provides out of the box. This is important to understand because CP-SAT is just a tool. It does not know anything about laboratory scheduling. Everything that makes this system work for our specific problem was designed and written by us.

---

### What CP-SAT Provides (Built-in Functions We Used)

These are functions that come from the Google OR-Tools library. We did not write them. We just called them with the right inputs.

| CP-SAT Function | What it does |
|---|---|
| `CpModel()` | Creates a blank model container where we place all our variables and rules |
| `new_bool_var(name)` | Creates a yes or no decision variable. The solver decides if it becomes true or false |
| `new_int_var(min, max, name)` | Creates a number variable within a range. The solver picks the exact value |
| `model.add(expression)` | Adds a rule that must always be satisfied. The solver cannot break this |
| `model.add_allowed_assignments(vars, tuples)` | Restricts a combination of variables to only the values we list. We used this to link block choice to slot usage |
| `model.add_bool_and(list)` | Enforces that all listed yes/no variables must be true at the same time |
| `model.add_bool_or(list)` | Enforces that at least one of the listed yes/no variables must be true |
| `model.add_at_most_one(list)` | Enforces that at most one of the listed variables can be true. This is what prevents overlaps |
| `model.add_element(index, values, target)` | Sets target equal to values at the given index. We used this to link block choice to its deviation score |
| `.only_enforce_if(var)` | Makes a rule conditional. It only applies when the given variable is true |
| `.Not()` | Flips a yes/no variable. True becomes false and false becomes true |
| `model.minimize(expression)` | Tells the solver to find the solution with the lowest possible value for this expression |
| `CpSolver()` | Creates the solving engine that actually runs the search |
| `solver.solve(model)` | Starts the solver and returns a status when it finishes |
| `solver.value(variable)` | Reads what value the solver assigned to a variable after solving |
| `cp_model.FEASIBLE` | A status code meaning the solver found a valid solution |
| `cp_model.OPTIMAL` | A status code meaning the solver found the best possible solution |

---

### What We Wrote Ourselves

These are the functions and logic that we designed specifically for this scheduling problem. None of this comes from CP-SAT or any other library.

| Our Function | What we built |
|---|---|
| `_time_to_minutes` | Converts time strings into numbers so we can do math with them |
| `_is_aligned` | Checks if a time falls on a valid 30-minute boundary |
| `_slot_duration` | Finds the shortest slot duration in the database |
| `_allowed_timeslots` | Filters out any timeslot that falls outside the 07:00-21:00 window |
| `_get_session_patterns` | Determines all the valid ways a subject's weekly hours can be split into sessions |
| `_find_consecutive_blocks` | Finds all unbroken sequences of timeslots within each day |
| `_candidate_blocks` | Combines consecutive blocks into full session options and filters them by instructor availability |
| `_parse_instructor_availability` | Converts availability records from the database into allowed timeslot sets per instructor, with whole-week and day-specific override logic |
| `_availability_satisfaction_score` | Scores how well a block fits within an availability window |
| `_preferred_time_deviation` | Measures how far a block is from the instructor's preferred start time |
| `_diagnostics` | Figures out why the solver failed and writes a human-readable explanation |
| `run_cpsat_solver` | The main function that connects everything — collects data, filters it, builds the model using CP-SAT tools, runs two stages, and returns the final schedule |

---

### How They Work Together

CP-SAT is the engine. It knows how to search through possibilities and find solutions that satisfy rules. But it does not know what a laboratory schedule is, what an instructor is, or what an availability window means.

Everything we wrote translates our real-world scheduling problem into the language CP-SAT understands. We take instructor data and availability from the database, convert it into timeslot sets, generate candidate blocks, and express the scheduling rules as CP-SAT constraints. CP-SAT then finds a valid assignment. We take that assignment and convert it back into a readable schedule.

In short: we designed the problem. CP-SAT solved it.

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

---

## How We Built It — Panel Defense Answers

This section answers the question "how did you make this?" for each part of the solver. These are the thought process and design decisions behind each block of code.

---

### How we handled time — `_time_to_minutes`

We noticed early on that comparing times like "09:30" and "10:00" as text strings would not work for math. You cannot subtract strings. So we decided to convert every time into a single number representing minutes from midnight. Nine thirty becomes 570 minutes, ten o'clock becomes 600. Now we can subtract, compare, and check ranges using simple arithmetic. This is a standard approach in scheduling systems and we applied it consistently everywhere time appears in the code.

---

### Why we restricted to 07:00-21:00 — `_allowed_timeslots`

We defined the scheduling window based on the actual operating hours of the College of Computer Studies. Classes do not happen before 7 in the morning or after 9 at night. Rather than letting the solver consider all possible times and waste computation on invalid options, we filter out anything outside that range before the solver even starts. This reduces the number of variables the solver needs to handle and makes the model faster and cleaner.

---

### Why we used 30-minute slots

The smallest class unit in the college schedule is 30 minutes. A 3-hour subject is made up of six 30-minute consecutive slots. Using 30 minutes as the base unit gives the solver flexibility to find blocks at any valid start time while still keeping the schedule aligned to realistic class periods. We seeded 28 slots per day automatically so the admin does not have to enter them manually.

---

### How we figured out session patterns — `_get_session_patterns`

We observed that a 3-hour subject does not always have to be taught in one sitting. It can be split into two 1.5-hour sessions on different days, which is a common practice in many universities. So we wrote this function to take the weekly hours and compute all the valid ways to split them. For 3 hours we allow a single block or a two-day split. For 5 hours we allow three different split options. This gives the solver more combinations to try, increasing the chance of finding a valid schedule even when constraints are tight.

---

### How we built candidate blocks — `_find_consecutive_blocks` and `_candidate_blocks`

We needed a way to find all the possible time windows where a class could be held. The approach was to group all time slots by day, sort them by start time within each day, and then slide a window of the required size across them while checking that each slot ends exactly when the next one starts. Any sequence that has a gap is rejected. Once we had all single-day blocks, we combined pairs of blocks from different days for the split patterns. We also added a deduplication check using a set so the same combination is never added twice.

---

### How we enforced availability as a hard constraint

The key design decision here was to filter out invalid blocks before the model is built, not inside the model. This is more efficient because the solver never has to consider blocks outside the instructor's available hours at all. When an instructor has availability windows set, we compute the set of allowed timeslot IDs first. Then when building candidate blocks, any block that contains even one slot outside that set is removed. This is called pre-processing and it significantly reduces the model size.

---

### How we handled whole-week vs day-specific availability — `_parse_instructor_availability`

We wanted the system to support three scenarios. First, an instructor available the same hours every day. Second, an instructor with different hours on different days. Third, a combination like available all week but with a restricted window on one specific day. To handle this cleanly we split availability records into two groups — whole-week and day-specific. The override rule we designed says that if any day-specific windows exist for a particular day, those windows completely replace the whole-week windows for that day. This way the third scenario works naturally without needing a special exception in the code.

---

### How we built the CP-SAT model variables

We designed the model around one scheduling unit per instructor-subject pair. Each unit has two main decisions to make: which room to use and which time block to use. We represented these as integer variables in the CP-SAT model where the value is an index into the list of valid options. We then created boolean variables to track which specific room and which specific timeslots are being used. These boolean variables are what the overlap constraints are built on. The reason we used this approach instead of creating one variable per combination of room and block is that the number of combinations can grow very large. Our approach keeps the model size proportional to the number of pairs rather than the number of possible combinations.

---

### How we prevented overlap — the hard constraints

For instructor overlap, we grouped all the slot variables by instructor and timeslot. If two pairs share the same instructor and the same timeslot, at most one of them can be assigned to that slot. We used the CP-SAT built-in `add_at_most_one` constraint which directly enforces this rule. The same approach was used for room overlap — group by room and timeslot, at most one class per room per slot. This is one of the most important parts of the system because without it the solver could produce a schedule where an instructor teaches two classes at the same time.

---

### Why we used two stages instead of one

We initially tried to build everything into a single solve call, but the problem with mixing feasibility and optimization in one step is that the solver might spend most of its time optimizing when it has not even found a valid schedule yet. Splitting it into two stages was cleaner. Stage 1 just finds any valid schedule as fast as possible. Once we know a schedule exists, Stage 2 focuses on making it better by minimizing how far each instructor is from their preferred time. If preferred times are not set, Stage 2 simply does not run.

---

### How we designed the preferred time optimization — `_preferred_time_deviation`

We wanted to reward blocks that start at the instructor's preferred time and penalize blocks that do not, but we did not want a gradual penalty because that would make the optimization harder to tune. Instead we used a binary score: 0 if the block starts at the preferred time, 8 if it does not. The number 8 is arbitrary but large enough to differentiate clearly. Stage 2 minimizes the total score across all pairs, which means the solver will rearrange blocks to match as many preferred times as possible.

---

### How we handled the error reporting — `_diagnostics`

When the solver fails, just saying "no solution found" is not helpful. We wanted the admin to know exactly what is wrong so they can fix it without guessing. So we wrote the diagnostics function to check the most common causes of failure one by one: missing room types, no valid blocks for a pair, not enough available slots for an instructor, and overloaded room types. The function collects all the problems it finds and returns them as a readable list. This was designed based on the actual errors we encountered during testing.

---

### How the whole thing fits together — the overall process

The overall design follows a pipeline. Data comes in, gets filtered and pre-processed, gets modeled as a constraint problem, gets solved in two stages, and the result goes back out. Each function in the file handles one step of that pipeline. We kept them separate so that if one step needs to change, it does not break the others. The main function `run_cpsat_solver` is essentially just calling each step in order and passing the results from one to the next. This separation also made testing easier because we could verify each step independently before connecting them all together.
