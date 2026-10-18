## 6A Understanding CP SAT before reading our solver

### What we are actually creating

Our app assigns student assistants to duties in an existing class schedule. It does not move the imported classes to new times, create the students' academic timetables, or choose their subjects. Their uploaded personal classes are fixed busy periods. The decisions are who covers which eligible duties.

CP means constraint programming. We describe possible decisions and rules instead of writing every possible schedule ourselves. SAT refers to Boolean satisfiability, the problem of finding true or false choices that satisfy logical conditions. OR-Tools CP-SAT combines integer constraint modeling with SAT-based reasoning and other optimization techniques. It is an optimization engine, not a trained AI model. [G1 and G2]

### Four building blocks

| Concept | Plain meaning | Scheduling example |
| --- | --- | --- |
| Decision variable | A choice the solver may make | x equals 1 if Anna covers class C1 and 0 otherwise |
| Domain | Allowed values for that choice | x may only be 0 or 1 |
| Hard constraint | A condition every accepted answer must satisfy | Anna cannot cover two overlapping duties |
| Objective | A numerical score used to compare allowed answers | Reward coverage and improve workload balance |

We first build a `CpModel` containing these choices, restrictions, and scores. A `CpSolver` then searches that model. The model describes our problem; the solver is the general engine that finds values for its variables. Integer modeling is why our code uses whole minutes such as 420 for 7 AM. [G1]

### Valid does not always mean best

A feasible schedule follows every hard constraint. An optimal schedule is feasible and has the best objective value the solver can prove for the supplied model. A schedule can be valid without being proven best. Even an optimal answer is optimal only for the rules and score we actually modeled, not for every real-world concern. [G1]

Our daily and weekly settings are upper bounds, not targets that every assistant must reach. A student can receive fewer hours, including zero. Giving a duty more preference points cannot override a personal-class conflict or another hard rule.

Sources: [G1] Google CP-SAT solver documentation; [G2] Google OR-Tools CP-SAT overview. Full links appear in section 6H. Application scope comes from runSolver and solve_student_assistant_schedule.

## 6B How the CP SAT engine searches

### Simplify before exploring

Presolve simplifies the supplied model and can eliminate choices already determined by its rules. During search, propagation derives consequences of current choices. For example, if Anna is selected for a class that permits at most one assistant, the other assistants' variables for that class must be zero. These are logical deductions, not separately scored recommendations. [G2]

### Try choices and learn from contradictions

When deductions do not finish the problem, the engine makes decisions and propagates again. If a branch contradicts a rule, it can backtrack and learn a clause that prevents the same conflicting combination from being explored again. The conceptual loop below explains this reasoning; it is not a literal trace of a run or a promise of a fixed search order. [G3]

```
Build and simplify the model
          |
Propagate consequences of current choices
          |
Unresolved choices remain ---- Make a decision ----+
          |                                      |
          +-------------- repeat propagation <---+
          |
Conflict ---- Learn a restriction and backtrack
          |
Complete valid candidate ---- Compare its objective score
          |
Continue improving or proving the best achievable score
```

### Keep the best candidate and stop with a status

Optimization tracks an incumbent, meaning the best valid candidate found so far, and uses bounds to reason about what remains achievable. Search need not enumerate every complete schedule. Our app requests eight search workers; OR-Tools can use a portfolio of cooperating search strategies rather than assigning one worker to each student. The exact internal strategies depend on the OR-Tools version and model. [G2 and G4]

The run can finish with a proof or stop at its limit. Our code sets a 60-second solver search limit. That is a ceiling on the search, not a mandatory wait and not a limit on all upload, model-building, response, and saving time combined.

This is why the animated Creating schedule button cannot honestly display an exact completion percentage. The app does not stream search progress, and finding a good candidate does not reveal how much proof work remains.

Sources: [G2] OR-Tools overview and presolve components; [G3] OR-Tools SAT solver implementation; [G4] OR-Tools troubleshooting and parallel search documentation. Links appear in 6H.

## 6C Our process from Proceed to model inputs

### Step 1 Capture the request in the interface

StudentAssistantPanel.proceedWithSchedule closes the settings dialog and calls runSolver. It checks whether generation is already running, captures the current roster, result, settings, and CSV context, and chooses full generation or incremental filling. With an existing result, unchecked full rescheduling, and no new assistants, it stops with a message instead of silently rebuilding.

solveStudentAssistantSchedule creates a random seed and sends mainSchedule, assistants, schedulingSettings, randomSeed, and optional incremental data as JSON to POST /api/student-assistant/solve. Each assistant contains an ID, label, and uploaded personal class meetings. The Flask route and service pass the validated request into solve_student_assistant_schedule.

```
Proceed
  -> runSolver captures context and generation mode
  -> solveStudentAssistantSchedule sends JSON to Flask
  -> route and service validate the request
  -> Python solver normalizes inputs and builds a CpModel
  -> CP-SAT searches the model
  -> response is checked saved locally and displayed
```

### Step 2 Validate settings and normalize meetings

The Python entry point checks for a main schedule and assistants. _duty_gap_minutes accepts gaps of 0, 30, 60, 90, or 120 minutes. _workload_limits accepts daily limits from 1 to 8 hours and weekly limits from 5 to 40 hours, in hourly steps, with weekly not lower than daily. The selected settings are sent explicitly; backend defaults are only fallbacks for missing values.

_parse_meetings validates time ranges and expands weekday codes. A source class C1 with dayCode TTh becomes a Tuesday Meeting and a Thursday Meeting. Both keep source_id C1, while occurrence_id distinguishes C1-T and C1-Th. The class identifier connects those weekly occurrences to one assignment choice.

### Step 3 Split meetings into coverage units

_coverage_units walks each meeting from its actual start to end in pieces of up to 30 minutes. A 7 AM to 9 AM meeting produces four units. An 8:10 AM to 9 AM meeting produces an 8:10 to 8:40 unit and an 8:40 to 9 AM unit. It does not round the meeting onto a whole-hour timetable.

For each assistant, the code also parses personal classes and any fixed duties supplied by incremental mode. Invalid personal schedules or overlapping fixed duties return INVALID before search. The units become the accounting and interval variables explained next; they are not permission to distribute a normal class arbitrarily among assistants.

Sources: StudentAssistantPanel.tsx lines 426 onward; studentAssistantApi.ts lines 99 onward; backend/routes/student_assistants.py; backend/services/student_assistant_service.py; student_assistant_solver.py lines 46 to 145 and 449 onward.

## 6D Our decision variables and candidate filtering

### Step 4 Reject impossible assistant and class pairs

The code groups coverage units by the original source class ID. For each assistant and class, it asks whether any unit overlaps any personal class or fixed duty on the same weekday. If even one unit conflicts, `continue` skips that entire assistant and class pair. The app does not offer the student just the conflict-free half of that normal source class.

Suppose C1 occurs Tuesday and Thursday from 7 AM to 9 AM. If Anna has a personal class on Thursday from 8 AM to 9 AM, Anna is excluded from C1 altogether, even if Tuesday is free. This is the consequence of linking all occurrences with the same source ID.

### Step 5 Create one class decision and its unit decisions

For every eligible pair, new_bool_var creates a class variable named uses_assistant_class. Its value starts as unknown within the allowed domain {0, 1}. Building the variable does not assign the duty yet. The value is determined when the solver searches the finished model.

Every unit of that source class also gets a Boolean assignment variable. The actual equality below links the unit's choice to the class's choice.

```
model.add(variable == class_variable)
```

If uses_Anna_C1 is 1, every linked unit is 1. If it is 0, every linked unit is 0. Thus the normal full model chooses one consistent assistant across all units and weekdays of C1. Distinct source IDs remain separate choices even if their subject names are identical.

### Step 6 Make selected duties visible to overlap constraints

Each unit gets an optional fixed-size interval. Its presence is controlled by its assignment Boolean; its start and duration come from the imported timetable. The weekly position is weekday index times 1440 plus startMinutes, so Monday and Tuesday do not occupy the same point in the model.

```
Class C1 decision for Anna
          |
          +-- Tuesday unit 1 decision equals the class decision
          +-- Tuesday unit 2 decision equals the class decision
          +-- Remaining Tuesday and Thursday units follow it
          |
Each selected unit activates its fixed time interval
```

Candidate filtering handles already known personal and fixed-duty conflicts. The next constraints handle combinations of new duties that would conflict with each other. These are separate checks because two duties can each be individually available but impossible to select together.

Source: backend/solver/student_assistant_solver.py, candidate and optional-interval construction inside solve_student_assistant_schedule.

## 6E Our hard constraints in order

### Step 7 Add the duty gap restrictions

_add_duty_break_constraints examines possible duty occurrences for an assistant on a day. It follows adjacent duties into a continuous chain. Once a chain reaches at least 180 minutes, another duty beginning before the required gap ends cannot be selected together with that chain. With a zero gap, the helper adds no such restrictions.

For a 30-minute gap, duty A from 7 AM to 8 AM and duty B from 8 AM to 10 AM form a three-hour chain. Duty C from 10 AM to 11 AM is too soon. The code adds a restriction equivalent to xA + xB + xC <= 2. At least one of those choices must be absent. A following duty beginning at 10:30 AM satisfies that particular gap.

This is a gap before a later duty, not an inserted break inside a class and not a universal three-hour maximum for a single class. The helper considers completed duty boundaries. A long individual duty can remain selectable if the other constraints allow it.

### Step 8 Prevent duplicate coverage of a class

At-most-one constraints apply to both unit candidates and class candidates. For a class with Anna and Ben eligible, the class rule is equivalent to xAnnaC1 + xBenC1 <= 1. They may not both cover it. Zero is still allowed, so an uncovered class does not automatically make the whole model impossible.

### Step 9 Enforce workloads and prevent simultaneous duties

For each assistant, total_minutes equals fixed weekly minutes plus the sum of selected unit durations. Its integer domain runs from zero to the weekly maximum, enforcing that cap. Per-day weighted sums separately enforce the daily maximum. For example, 120*xC1 + 180*xC2 <= 240 forbids selecting both a two-hour and a three-hour duty on a day limited to four hours.

`model.add_no_overlap(optional_intervals[assistant_id])` prevents that assistant's selected unit intervals from overlapping. Two new duties at the same time can therefore be excluded together even if neither overlaps a personal class. Fixed-duty clashes were already filtered before these optional intervals were created; fixed minutes still count toward the caps.

### What these rules do not guarantee

The full model does not move room bookings or repair imported room conflicts. It constrains each assistant's time, not the physical validity of every source room record. It also does not currently receive dated event assignments as busy periods. Event conflicts checked in manual UI flows are not automatically additional constraints in this full solve.

Source: _add_duty_break_constraints and the capacity, at-most-one, and no-overlap blocks in backend/solver/student_assistant_solver.py.

## 6F Our objective and the search call

### Step 10 Score only allowed combinations

After adding hard constraints, the code creates helper variables for workload extremes, active duty days, repeated start times, and adjacent duties. The objective combines the following terms into one score. Positive terms reward a choice; negative terms penalize it. A hard constraint still overrides every reward.

| Objective term | Weight | Effect when maximizing |
| --- | --- | --- |
| Selected assistant and class pairs | +1000000000 each | Strongly rewards covering more source class IDs |
| Lowest assistant weekly minutes | +100000 per minute | Favors improving the least loaded assistant |
| Highest assistant weekly minutes | -10000 per minute | Discourages concentrating work on one assistant |
| Total assigned minutes | +100 per minute | Rewards more covered duty time |
| Assistant days with duty | +4000 each | Rewards spreading duty participation across days |
| Assistants with an adjacent duty pair | +700 each | Gives a small preference for an adjacent pair |
| Selected 7 AM occurrences | -2000 each | Discourages some early starts |
| Repeated start times beyond the first | -1000 each | Discourages repeated identical start times |
| Random value for each selected class pair | +0 to 99 | Helps choose among similarly scored alternatives |

Coverage is counted by source class ID here, not only by hours. A two-hour class and a four-hour class each contribute one large class reward. Their minutes also affect the separate workload and time terms. This is a weighted objective, not a sequence of separate optimization passes. Its large coefficients express priority but do not constitute a formal size-independent lexicographic guarantee.

### Step 11 Run CP SAT with the complete model

```
solver = cp_model.CpSolver()
solver.parameters.max_time_in_seconds = 60
solver.parameters.num_search_workers = 8
solver.parameters.random_seed = random_seed
solver.parameters.randomize_search = True
status = solver.solve(model)
```

This is the point where OR-Tools searches. Everything before it described choices, rules, or scoring. The frontend supplies a fresh seed, and the model adds random tie-break points, so valid assignments can differ between full generations. The app does not train from previous schedules. Parallel search also means identical inputs should not be treated as a promise of identical output.

Sources: objective and solver configuration in student_assistant_solver.py; seed generation in studentAssistantApi.ts. General search configuration background is [G4] in 6H.

## 6G A small example from inputs to assignments

### A simplified input that uses the same logic

Consider three assistants with a four-hour daily maximum, a twenty-hour weekly maximum, and a thirty-minute duty gap. The meetings below are duty opportunities already present in the main schedule. Personal classes are separate busy periods.

| Class ID | Days | Time | Weekly duty duration |
| --- | --- | --- | --- |
| C1 | Monday | 7 AM to 9 AM | 2 hours |
| C2 | Monday | 8 AM to 10 AM | 2 hours |
| C3 | Monday | 10:30 AM to 12:30 PM | 2 hours |
| C4 | Tuesday and Thursday | 7 AM to 9 AM | 4 hours |

Anna has a personal class Monday from 8 AM to 9 AM. Ben has one Monday from 10 AM to 11 AM. Carla has one Tuesday from 7 AM to 8 AM. Their candidate matrix becomes the following before any workload balancing.

| Assistant | C1 | C2 | C3 | C4 |
| --- | --- | --- | --- | --- |
| Anna | Excluded | Excluded | Eligible | Eligible |
| Ben | Eligible | Eligible | Excluded | Eligible |
| Carla | Eligible | Eligible | Eligible | Excluded |

Anna is excluded from C1 and C2 because of Monday's overlap. Ben is excluded from all of C3, even though only its first half hour conflicts. Carla is excluded from C4 on both weekdays because Tuesday conflicts with one occurrence of that source class.

### Reason about combinations rather than one student at a time

Ben cannot cover both C1 and C2 because those duties overlap. The class rules also prevent Ben and Carla from both covering C1. One valid candidate assigns C1 to Ben, C2 and C3 to Carla, and C4 to Anna. This covers all four source classes. Anna receives four weekly hours, Ben two, and Carla four. Carla's two Monday duties total four hours and have a thirty-minute gap.

Another valid candidate assigns C3 and C4 to Anna, C1 to Ben, and C2 to Carla. Its totals are 6, 2, and 2. Coverage, total minutes, and minimum workload are unchanged, but its maximum workload is two hours higher. That costs 120 times 10000 points, outweighing its extra active day's 4000-point reward. The objective favors the more balanced candidate. Similar alternatives can still swap C1 and C2 between Ben and Carla.

This is a teaching comparison, not a captured execution trace or a guarantee that a particular named student is chosen. The engine searches the joint model. It does not simply finish Anna's schedule, freeze it, and then give Ben whatever is left.

## 6H Reading the result and completing the process

### Step 12 Read the status and selected values

OR-Tools can return OPTIMAL, FEASIBLE, INFEASIBLE, MODEL_INVALID, or UNKNOWN. For this optimization model, OPTIMAL establishes the best score; FEASIBLE supplies a valid candidate without a proof of best score. INFEASIBLE proves no allowed combination exists. MODEL_INVALID identifies a malformed model; UNKNOWN can mean a limit was reached before a conclusion. [G1]

Our wrapper accepts OPTIMAL and FEASIBLE. It currently labels all other solver outcomes INFEASIBLE, losing that distinction. Its own input checks can return INVALID before search. Also, unassigned classes are permitted: an otherwise valid full model can return a successful result with zero assignments. An uncovered class alone is not evidence of solver failure.

### Step 13 Convert the chosen units into duty records

For each assignment Boolean, solver.value(variable) reads the chosen 0 or 1. Selected units are grouped by assistant and meeting occurrence. _merge_assignments joins adjoining units into a readable duty, so four chosen half-hour units become one 7 AM to 9 AM card. Tuesday and Thursday remain separate occurrence records even when one class decision selected both.

The response contains assignments, assistantTotals, optimizedAssistantIds, summary counts, diagnostics, appliedSettings, and status. runSolver checks that the CSV and saved input snapshot have not changed during search. It discards an outdated response; otherwise it updates React state, saves locally, queues cloud synchronization, and lets the calendar filter records for the chosen assistant and week.

### The alternate incremental path

An incremental request first enters _solve_incremental_schedule. It validates existing assignments against current source meetings, subtracts covered intervals, and creates temporary IDs for remaining open segments. Only the newly added assistants enter a fresh CP-SAT solve. Their already assigned manual duties become fixed work. Returned temporary IDs are mapped back to original class IDs and the new records are combined with the preserved assignments.

This is a newly built smaller model, not a suspended CP-SAT search being resumed. Full regeneration may replace regular assignments; incremental generation preserves the validated old ones and fills available gaps for new assistants. The detailed mode behavior continues in Chapter 7.

### Sources for the general CP SAT explanation

[G1] Google CP-SAT solver documentation for integer modeling and statuses. https://developers.google.com/optimization/cp/cp_solver

[G2] Google OR-Tools CP-SAT overview and component reference. https://github.com/google/or-tools/blob/stable/ortools/sat/README.md

[G3] Google OR-Tools SAT solver source for propagation, search, and conflict learning. https://github.com/google/or-tools/blob/stable/ortools/sat/sat_solver.h

[G4] Google OR-Tools troubleshooting documentation for worker portfolios and search limits. https://github.com/google/or-tools/blob/stable/ortools/sat/docs/troubleshooting.md

## 6I Lexicographic ranking and weighted optimization

### Two different decision methods in our app

Our assistant recommendations use lexicographic multi-criteria sorting. Our CP-SAT schedule generation uses a weighted multi-criteria objective. These methods serve different purposes and should not be described as the same algorithm.

Lexicographic sorting compares candidates by the first criterion. Only a tie allows the next criterion to decide. A better later criterion cannot compensate for a worse earlier one. The reliever and manual-duty candidate lists use the following order after excluding unavailable assistants.

| Priority | Comparison with lower values first |
| --- | --- |
| 1 | Projected weekly workload in minutes |
| 2 | Projected daily workload in minutes |
| 3 | Longest continuous duty block after assignment |
| 4 | Number of duties that day after assignment |
| 5 | Student ID in string order or assistant ID if missing |

For example, Anna with 22 projected weekly hours ranks before Ben with 23, even if Ben has fewer hours that day. If both have 22 weekly hours, daily workload decides. If that is also equal, the comparison continues down the list. These are ranking examples, not a claim that a manual regular-duty assignment can exceed its workload caps; availability filtering happens first, and reliever work is overtime.

### How the comparator implements this order

The sort callback subtracts the right candidate's value from the left candidate's value. A negative result places the left candidate first. The `||` operators return the first nonzero comparison; zero means tied, so evaluation continues down the table. Student identifiers use localeCompare instead of numeric subtraction.

This ordering recommends a candidate for one requested duty. It does not search all possible future schedules or prove that this individual choice produces the best complete schedule. Find Reliever automatically takes the first eligible candidate; the manual-duty flow lets the user choose from the ordered list.

### Why our CP SAT objective is different

The solver combines coverage, workload balance, and the other terms in section 6F into one score. Weighted terms can trade off against each other. The code does not run separate optimization stages that prove the best first objective, fix it, and then optimize the next. Therefore we should not claim strict lexicographic optimization for schedule generation.

An accurate system description is: The system uses CP-SAT with a weighted multi-criteria objective for schedule generation, and lexicographic multi-criteria sorting for assistant recommendations.

Sources: frontend/src/ui/schedule/ScheduleCalendar.tsx, rankRelievers comparator at line 714 and availableRegularDutyCandidates comparator at line 779; backend/solver/student_assistant_solver.py, model.maximize at line 677.

