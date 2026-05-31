"""
CP-SAT Solver for the Automated Laboratory Scheduling System.

This module handles all scheduling logic using Google OR-Tools CP-SAT,
a constraint satisfaction and optimization solver.

The model creates one scheduling unit per (instructor, subject) pair.
Each unit selects a matching room and one valid timeslot block.
Overlap constraints are enforced after block selection rather than
pre-expanding all possible room-block-pattern combinations, which
keeps the model size manageable.

Scheduling pipeline:
    1. Filter valid timeslots (07:00-21:00, 30-minute aligned)
    2. Parse instructor availability windows
    3. Generate candidate time blocks per instructor-subject pair
    4. Apply floor restrictions to filter matching rooms
    5. Build CP-SAT model with hard constraints
    6. Stage 1: Find any feasible solution
    7. Stage 2: Minimize preferred time deviation (if set)
"""

from ortools.sat.python import cp_model
from typing import Any, Optional

# Scheduling window boundaries in minutes from midnight
WINDOW_START_MINUTES = 7 * 60   # 07:00
WINDOW_END_MINUTES = 21 * 60    # 21:00

# Default preferred start time if none is specified
DEFAULT_PREFERRED_START_MINUTES = 9 * 60  # 09:00

# All timeslots must align to 30-minute boundaries
ALIGNMENT_MINUTES = 30


def _time_to_minutes(time_str: str) -> int:
    """Convert a time string like '09:30' to total minutes from midnight."""
    hours, minutes = map(int, time_str.split(":"))
    return hours * 60 + minutes


def _is_aligned(minutes: int) -> bool:
    """Check if a time in minutes falls on a 30-minute boundary from 07:00."""
    return (minutes - WINDOW_START_MINUTES) % ALIGNMENT_MINUTES == 0


def _slot_duration(timeslots: list[dict]) -> int:
    """Return the shortest slot duration found in the timeslot list."""
    durations = {int(t["duration"]) for t in timeslots}
    return min(durations) if durations else ALIGNMENT_MINUTES


def _allowed_timeslots(timeslots: list[dict], slot_duration_minutes: int) -> list[dict]:
    """
    Filter timeslots to only those that are valid for scheduling.

    A valid timeslot must:
    - Match the expected slot duration
    - Fall entirely within 07:00-21:00
    - Have a duration that exactly matches start to end
    - Start and end on 30-minute aligned boundaries
    """
    allowed = []
    for slot in timeslots:
        start = _time_to_minutes(slot["start_time"])
        end = _time_to_minutes(slot["end_time"])
        if (
            int(slot["duration"]) == slot_duration_minutes
            and start >= WINDOW_START_MINUTES
            and end <= WINDOW_END_MINUTES
            and end - start == slot_duration_minutes
            and _is_aligned(start)
            and _is_aligned(end)
        ):
            allowed.append(slot)
    return allowed


def _get_session_patterns(hours_per_week: int, slot_duration_minutes: int) -> list[tuple[int, ...]]:
    """
    Return the valid block patterns for a subject based on its weekly hours.

    A pattern is a tuple of slot counts representing how a subject's weekly
    hours can be split across sessions. For example:
    - 3 hours/week = 6 slots -> can be (6,) single block or (3,3) two-day split
    - 5 hours/week = 10 slots -> can be (10,), (4,6), or (5,5)

    Returns an empty list if the hours do not align with the slot duration.
    """
    total_slots = int(hours_per_week * (60 / slot_duration_minutes))
    if total_slots <= 0 or total_slots != hours_per_week * (60 / slot_duration_minutes):
        return []
    if total_slots == 6:
        return [(6,), (3, 3)]
    if total_slots == 10:
        return [(10,), (4, 6), (5, 5)]
    return [(total_slots,)]


def _find_consecutive_blocks(timeslots: list[dict], slots_needed: int) -> list[list[int]]:
    """
    Find all consecutive sequences of timeslots of a given size within each day.

    Consecutive means each slot's end time must equal the next slot's start time.
    Returns a list of blocks where each block is a list of timeslot IDs.
    """
    # Group timeslots by day
    by_day: dict[str, list[dict]] = {}
    for slot in timeslots:
        by_day.setdefault(slot["day"], []).append(slot)

    blocks = []
    for day_slots in by_day.values():
        # Sort slots by start time within each day
        sorted_slots = sorted(day_slots, key=lambda s: _time_to_minutes(s["start_time"]))
        for start_index in range(len(sorted_slots) - slots_needed + 1):
            block = sorted_slots[start_index : start_index + slots_needed]
            # Validate that all slots in the sequence are truly consecutive
            if all(
                _time_to_minutes(block[i]["start_time"]) == _time_to_minutes(block[i - 1]["end_time"])
                for i in range(1, len(block))
            ):
                blocks.append([slot["id"] for slot in block])
    return blocks


def _candidate_blocks(
    timeslots: list[dict],
    patterns: list[tuple[int, ...]],
    permitted_timeslot_ids: Optional[set[int]] = None,
) -> list[list[int]]:
    """
    Generate all valid candidate time blocks for a given set of session patterns.

    For single-day patterns (e.g. (6,)), returns all consecutive blocks of that size.
    For split patterns (e.g. (3,3)), combines two blocks from different days.

    If permitted_timeslot_ids is provided, only blocks where every slot is in
    that set are kept. This enforces instructor availability as a hard filter
    before the CP-SAT model is built.

    Symmetry deduplication is applied to split patterns so that (Monday block +
    Tuesday block) and (Tuesday block + Monday block) are not both included.

    If a split pattern would produce more than 1000 combinations, only blocks
    with matching start times are kept to limit the model size.
    """
    # Pre-compute blocks of each required size
    by_size: dict[int, list[list[int]]] = {}
    for pattern in patterns:
        for size in pattern:
            if size not in by_size:
                blocks = _find_consecutive_blocks(timeslots, size)
                # Apply availability filter if provided
                if permitted_timeslot_ids is not None:
                    blocks = [block for block in blocks if all(ts_id in permitted_timeslot_ids for ts_id in block)]
                by_size[size] = blocks

    candidates: list[list[int]] = []
    seen: set[tuple[int, ...]] = set()
    timeslot_map = {slot["id"]: slot for slot in timeslots}

    for pattern in patterns:
        if len(pattern) == 1:
            # Single-block pattern: add each block directly
            for block in by_size.get(pattern[0], []):
                key = tuple(block)
                if key not in seen:
                    seen.add(key)
                    candidates.append(block)
            continue

        # Split pattern: combine two blocks from different days
        first_size, second_size = pattern
        first_blocks = by_size.get(first_size, [])
        second_blocks = by_size.get(second_size, [])
        symmetric = first_size == second_size

        # Limit combinations if there are too many to keep model size small
        use_aligned_split_starts = len(first_blocks) * len(second_blocks) > 1000
        for first in first_blocks:
            for second in second_blocks:
                # Both halves must be on different days
                if timeslot_map[first[0]]["day"] == timeslot_map[second[0]]["day"]:
                    continue
                # For symmetric patterns, skip reverse duplicates using ID comparison
                if symmetric and first[0] >= second[0]:
                    continue
                # For large pattern spaces, only keep aligned start times
                if use_aligned_split_starts and (
                    timeslot_map[first[0]]["start_time"] != timeslot_map[second[0]]["start_time"]
                ):
                    continue
                block = first + second
                key = tuple(block)
                if key not in seen:
                    seen.add(key)
                    candidates.append(block)
    return candidates


def _parse_instructor_availability(
    instructor_availability: list[dict],
    timeslot_map: dict[int, dict],
    allowed_timeslot_ids: set[int],
) -> tuple[dict[int, list[tuple]], dict[int, set[int]]]:
    """
    Parse instructor availability records into allowed timeslot sets.

    Supports two types of availability windows:
    - Whole-week (day=None or empty): applies to every day of the week
    - Day-specific: applies only to the named day

    Override semantics: if day-specific windows exist for a given day,
    they completely replace whole-week windows for that day. This allows
    expressions like 'whole week 07:00-17:00 except Wednesday 10:00-12:00'
    by adding a whole-week window plus an explicit Wednesday window.

    Returns:
        windows: flat list of (day_or_None, start_min, end_min) per instructor
        allowed_by_instructor: set of allowed timeslot IDs per instructor
    """
    # Separate whole-week windows from day-specific windows
    whole_week_windows: dict[int, list[tuple[int, int]]] = {}
    day_specific_windows: dict[int, dict[str, list[tuple[int, int]]]] = {}

    for row in instructor_availability:
        iid = row["instructor_id"]
        start_min = _time_to_minutes(row["start_time"])
        end_min = _time_to_minutes(row["end_time"])
        day = row.get("day") or None  # treat empty string the same as NULL

        if day is None:
            whole_week_windows.setdefault(iid, []).append((start_min, end_min))
        else:
            day_specific_windows.setdefault(iid, {}).setdefault(day, []).append((start_min, end_min))

    # Build a flat (day_or_None, start_min, end_min) list per instructor
    windows: dict[int, list[tuple]] = {}
    all_instructor_ids = set(whole_week_windows) | set(day_specific_windows)
    for iid in all_instructor_ids:
        combined: list[tuple] = []
        for s, e in whole_week_windows.get(iid, []):
            combined.append((None, s, e))
        for d, ranges in day_specific_windows.get(iid, {}).items():
            for s, e in ranges:
                combined.append((d, s, e))
        windows[iid] = combined

    # Determine which timeslots each instructor is allowed to use.
    # Day-specific windows override whole-week windows for that particular day.
    allowed_by_instructor: dict[int, set[int]] = {}
    for iid in all_instructor_ids:
        allowed: set[int] = set()
        ww = whole_week_windows.get(iid, [])
        ds = day_specific_windows.get(iid, {})
        for ts_id in allowed_timeslot_ids:
            slot = timeslot_map[ts_id]
            ts_day = slot["day"]
            start = _time_to_minutes(slot["start_time"])
            end = _time_to_minutes(slot["end_time"])
            # Use day-specific windows if they exist for this day, otherwise use whole-week
            applicable = ds[ts_day] if ts_day in ds else ww
            if any(start >= win_start and end <= win_end for win_start, win_end in applicable):
                allowed.add(ts_id)
        allowed_by_instructor[iid] = allowed

    return windows, allowed_by_instructor


def _availability_satisfaction_score(
    block: list[int],
    instructor_id: int,
    timeslot_map: dict[int, dict],
    availability_windows: dict[int, list[tuple]],
) -> int:
    """
    Score a block based on how well it fits within the instructor's availability.

    For each slot in the block, adds the remaining window time after the slot ends.
    A higher score means the block is placed earlier in the availability window,
    leaving more room after it. Returns 0 if no availability windows are set.
    """
    windows = availability_windows.get(instructor_id)
    if not windows:
        return 0

    score = 0
    for ts_id in block:
        slot = timeslot_map[ts_id]
        start = _time_to_minutes(slot["start_time"])
        end = _time_to_minutes(slot["end_time"])
        for day, win_start, win_end in windows:
            if (day is None or slot["day"] == day) and start >= win_start and end <= win_end:
                score += win_end - end
                break
    return score


def _preferred_time_deviation(
    block: list[int],
    instructor_id: int,
    subject_id: int,
    timeslot_map: dict[int, dict],
    preferred_start_map: dict[tuple[int, int], int],
) -> int:
    """
    Calculate how far a block deviates from the instructor's preferred start time.

    For each day in the block, checks if the earliest slot starts at the preferred
    time. Adds 8 for each day where the start time does not match. Returns 0 if
    no preferred time is set for this instructor-subject pair.
    """
    preferred_start = preferred_start_map.get((instructor_id, subject_id))
    if preferred_start is None:
        return 0
    # Find the earliest start time per day in this block
    first_by_day: dict[str, int] = {}
    for ts_id in block:
        slot = timeslot_map[ts_id]
        start = _time_to_minutes(slot["start_time"])
        day = slot["day"]
        first_by_day[day] = min(first_by_day.get(day, start), start)
    return sum(0 if start == preferred_start else 8 for start in first_by_day.values())


def _status_name(solver: cp_model.CpSolver, status: int) -> str:
    """Return the human-readable name of a CP-SAT solver status code."""
    return solver.status_name(status)


def _diagnostics(
    pairs: list[dict],
    pair_data: dict[int, dict],
    subject_map: dict[int, dict],
    instructor_map: dict[int, dict],
    rooms: list[dict],
    allowed_timeslot_ids: set[int],
    allowed_timeslots_per_instructor: dict[int, set[int]],
) -> str:
    """
    Generate a human-readable diagnostic message when the solver fails.

    Checks for:
    - Subjects with no matching room type
    - Instructor-subject pairs with no valid candidate blocks
    - Instructors whose required slots exceed their available slots
    - Room types where total demand exceeds available room-slot capacity
    """
    problems: list[str] = []

    rooms_by_type: dict[str, list[dict]] = {}
    for room in rooms:
        rooms_by_type.setdefault(room["type"], []).append(room)

    for index, row in enumerate(pairs):
        instructor = instructor_map.get(row["instructor_id"], {"name": f"Instructor {row['instructor_id']}"})
        subject = subject_map.get(row["subject_id"], {"code": f"Subject {row['subject_id']}", "type": "unknown"})
        data = pair_data.get(index)
        if not rooms_by_type.get(subject["type"]):
            problems.append(f"Missing rooms: {subject['code']} needs a {subject['type']} room.")
        if data is not None and not data["blocks"]:
            problems.append(
                f"Missing valid blocks: {instructor['name']} / {subject['code']} has no block inside 07:00-21:00"
                " that also satisfies availability."
            )

    # Check if any instructor needs more slots than they have available
    required_by_instructor: dict[int, int] = {}
    for data in pair_data.values():
        required_by_instructor[data["instructor_id"]] = (
            required_by_instructor.get(data["instructor_id"], 0) + data["required_slots"]
        )
    for instructor_id, required in required_by_instructor.items():
        available = len(allowed_timeslots_per_instructor.get(instructor_id, allowed_timeslot_ids))
        if required > available:
            name = instructor_map.get(instructor_id, {}).get("name", f"Instructor {instructor_id}")
            problems.append(
                f"Instructor conflicts: {name} needs {required} slots but only {available} allowed slots exist."
            )

    # Check if any room type is overloaded
    required_by_type: dict[str, int] = {}
    for data in pair_data.values():
        required_by_type[data["room_type"]] = required_by_type.get(data["room_type"], 0) + data["required_slots"]
    for room_type, required in required_by_type.items():
        capacity = len(rooms_by_type.get(room_type, [])) * len(allowed_timeslot_ids)
        if required > capacity:
            problems.append(
                f"Missing rooms: {room_type} subjects need {required} room-slots but only {capacity} are available."
            )

    if not problems:
        problems.append(
            "Instructor conflicts: the remaining constraints leave no non-overlapping combination. "
            "Check shared rooms, tight availability windows, and long subject blocks."
        )
    return "\n- " + "\n- ".join(dict.fromkeys(problems))


def run_cpsat_solver(
    subjects: list[dict],
    rooms: list[dict],
    instructors: list[dict],
    instructor_subjects: list[dict],
    timeslots: list[dict],
    instructor_availability: Optional[list[dict]] = None,
    preferred_time_slots: Optional[list[dict]] = None,
) -> dict[str, Any]:
    """
    Main solver entry point. Generates a conflict-free schedule using CP-SAT.

    Accepts all scheduling data from the database and returns a schedule
    as a list of assignments, each linking an instructor, subject, room,
    and timeslot.

    Solving process:
        Stage 1: Find any feasible solution satisfying all hard constraints.
                 Hard constraints: no instructor overlap, no room overlap,
                 room type match, room capacity, floor restriction, availability.
        Stage 2: If preferred times are set, minimize total deviation from
                 preferred start times across all instructor-subject pairs.

    Returns a dict with keys: status, solution_status, message, assignments.
    """
    # Early exit if required data is missing
    if not instructor_subjects:
        return {
            "status": "error",
            "solution_status": "NO_INPUT",
            "message": (
                "No subjects are assigned to any instructor. Go to the Instructors tab, select an instructor "
                "and a subject, then click Assign."
            ),
            "assignments": [],
        }
    if not rooms:
        return {
            "status": "error",
            "solution_status": "NO_ROOMS",
            "message": "No rooms found. Add at least one room before running the solver.",
            "assignments": [],
        }
    if not timeslots:
        return {
            "status": "error",
            "solution_status": "NO_TIMESLOTS",
            "message": "No timeslots found in the database. Restart the server so the database can seed them.",
            "assignments": [],
        }

    # Filter to only valid 30-minute aligned timeslots within 07:00-21:00
    slot_duration_minutes = _slot_duration(timeslots)
    allowed_timeslots = _allowed_timeslots(timeslots, slot_duration_minutes)
    allowed_timeslot_ids = {slot["id"] for slot in allowed_timeslots}
    if not allowed_timeslots:
        return {
            "status": "error",
            "solution_status": "NO_ALLOWED_TIMESLOTS",
            "message": "No valid 30-minute aligned timeslots exist inside the strict 07:00-21:00 window.",
            "assignments": [],
        }

    # Build lookup maps for fast access by ID
    timeslot_map = {slot["id"]: slot for slot in timeslots}
    instructor_map = {instructor["id"]: instructor for instructor in instructors}
    subject_map = {subject["id"]: subject for subject in subjects}

    # Parse instructor availability windows into allowed timeslot sets
    availability_windows: dict[int, list[tuple]] = {}
    allowed_timeslots_per_instructor: dict[int, set[int]] = {}
    if instructor_availability:
        availability_windows, allowed_timeslots_per_instructor = _parse_instructor_availability(
            instructor_availability,
            timeslot_map,
            allowed_timeslot_ids,
        )

    # Build preferred start time map keyed by (instructor_id, subject_id)
    preferred_start_map: dict[tuple[int, int], int] = {}
    if preferred_time_slots:
        for row in preferred_time_slots:
            preferred_start_map[(row["instructor_id"], row["subject_id"])] = _time_to_minutes(
                row["preferred_start_time"]
            )

    # Group rooms by type for fast matching
    rooms_by_type: dict[str, list[dict]] = {}
    for room in rooms:
        rooms_by_type.setdefault(room["type"], []).append(room)

    # Build pair data: one entry per instructor-subject assignment
    problems: list[str] = []
    pairs: list[dict] = []
    pair_data: dict[int, dict] = {}

    for row in instructor_subjects:
        instructor_id = row["instructor_id"]
        subject_id = row["subject_id"]
        subject = subject_map.get(subject_id)
        instructor = instructor_map.get(instructor_id)

        if not instructor:
            problems.append(f"Instructor id={instructor_id} no longer exists; remove and re-add the assignment.")
            continue
        if not subject:
            problems.append(f"Subject id={subject_id} no longer exists; remove and re-add the assignment.")
            continue

        # Filter rooms by type and capacity requirements
        matching_rooms = [
            r for r in rooms_by_type.get(subject["type"], [])
            if r["capacity"] >= subject.get("students", 0)
        ]

        # Apply floor restriction if the instructor has one set
        floor_restriction = instructor.get("floor_restriction")
        if floor_restriction:
            matching_rooms = [r for r in matching_rooms if r.get("floor") == floor_restriction]

        if not matching_rooms:
            floor_note = f" on floor '{floor_restriction}'" if floor_restriction else ""
            problems.append(
                f"Missing rooms: {subject['code']} needs a {subject['type']} room with capacity "
                f">= {subject.get('students', 0)}{floor_note}."
            )
            continue

        patterns = _get_session_patterns(int(subject["hours_per_week"]), slot_duration_minutes)
        if not patterns:
            problems.append(
                f"Missing valid blocks: {subject['code']} has hours_per_week that does not align with "
                f"{slot_duration_minutes}-minute slots."
            )
            continue

        # Get the instructor's allowed timeslots (None means no restriction)
        instructor_allowed = allowed_timeslots_per_instructor.get(instructor_id)

        # Generate all valid candidate blocks for this pair
        blocks = _candidate_blocks(allowed_timeslots, patterns, instructor_allowed)

        pair_index = len(pairs)
        pairs.append(row)
        pair_data[pair_index] = {
            "instructor_id": instructor_id,
            "subject_id": subject_id,
            "room_type": subject["type"],
            "room_ids": [room["id"] for room in matching_rooms],
            "blocks": blocks,
            "required_slots": sum(patterns[0]),
        }
        if not blocks:
            problems.append(
                f"Missing valid blocks: {instructor['name']} / {subject['code']} has no block inside 07:00-21:00"
                " that also satisfies availability."
            )

    # Stop early if any pair has unresolvable problems
    if problems:
        return {
            "status": "infeasible",
            "solution_status": "INVALID_INPUT",
            "message": "Cannot build a feasible schedule:\n- " + "\n- ".join(dict.fromkeys(problems)),
            "assignments": [],
        }

    # ── Build the CP-SAT model ────────────────────────────────────────────────

    model = cp_model.CpModel()

    # Decision variable containers
    assigned: dict[int, cp_model.IntVar] = {}       # Whether a pair is scheduled (always 1)
    room_choice: dict[int, cp_model.IntVar] = {}     # Which room index is chosen
    block_choice: dict[int, cp_model.IntVar] = {}    # Which block index is chosen
    uses_slot: dict[tuple[int, int], cp_model.IntVar] = {}              # Is this slot used by this pair
    uses_room: dict[tuple[int, int], cp_model.IntVar] = {}              # Is this room used by this pair
    uses_room_slot: dict[tuple[int, int, int], cp_model.IntVar] = {}    # Is this room+slot combo used
    deviation_terms = []  # Collected deviation variables for Stage 2 objective

    for pair_index, data in pair_data.items():
        # Build a readable label for variable names in solver logs
        instr_name    = instructor_map[data["instructor_id"]]["name"].replace(" ", "_")
        subject_code  = subject_map[data["subject_id"]]["code"]
        label         = f"{instr_name}/{subject_code}"

        # Every pair must be assigned (no optional scheduling)
        assigned[pair_index] = model.new_bool_var(f"assign[{label}]")
        model.add(assigned[pair_index] == 1)

        room_ids = data["room_ids"]
        blocks = data["blocks"]

        # Integer variables for room and block selection
        room_choice[pair_index]  = model.new_int_var(0, len(room_ids) - 1, f"room_choice[{label}]")
        block_choice[pair_index] = model.new_int_var(0, len(blocks) - 1,   f"block_choice[{label}]")

        # Boolean flags to track which room is selected
        for room_idx, room_id in enumerate(room_ids):
            room_name = rooms[next(i for i, r in enumerate(rooms) if r["id"] == room_id)]["name"]
            room_var  = model.new_bool_var(f"uses_room[{label}/{room_name}]")
            model.add(room_choice[pair_index] == room_idx).only_enforce_if(room_var)
            model.add(room_choice[pair_index] != room_idx).only_enforce_if(room_var.Not())
            uses_room[(pair_index, room_id)] = room_var

        # Boolean flags to track which timeslots are used, linked to block choice
        relevant_slots = sorted({ts_id for block in blocks for ts_id in block})
        for ts_id in relevant_slots:
            # Find which blocks contain this timeslot
            containing_blocks = [block_idx for block_idx, block in enumerate(blocks) if ts_id in block]
            ts    = timeslot_map[ts_id]
            slot_var = model.new_bool_var(f"uses_slot[{label}/{ts['day']}_{ts['start_time']}]")
            # Table constraint: slot_var is 1 only when block_choice selects a block containing this slot
            model.add_allowed_assignments(
                [block_choice[pair_index], slot_var],
                [(block_idx, 1 if block_idx in containing_blocks else 0) for block_idx in range(len(blocks))],
            )
            uses_slot[(pair_index, ts_id)] = slot_var

        # Boolean flags for room+slot combinations (used for room overlap constraints)
        for room_id in room_ids:
            room_name = rooms[next(i for i, r in enumerate(rooms) if r["id"] == room_id)]["name"]
            for ts_id in relevant_slots:
                ts           = timeslot_map[ts_id]
                room_slot_var = model.new_bool_var(f"uses_room_slot[{label}/{room_name}/{ts['day']}_{ts['start_time']}]")
                # room_slot_var is true only when both room and slot are used by this pair
                model.add_bool_and([uses_room[(pair_index, room_id)], uses_slot[(pair_index, ts_id)]]).only_enforce_if(
                    room_slot_var
                )
                model.add_bool_or(
                    [uses_room[(pair_index, room_id)].Not(), uses_slot[(pair_index, ts_id)].Not()]
                ).only_enforce_if(room_slot_var.Not())
                uses_room_slot[(pair_index, room_id, ts_id)] = room_slot_var

        # Preferred time deviation variable for Stage 2 optimization
        if preferred_start_map:
            deviations = [
                _preferred_time_deviation(
                    block,
                    data["instructor_id"],
                    data["subject_id"],
                    timeslot_map,
                    preferred_start_map,
                )
                for block in blocks
            ]
            max_deviation = max(deviations) if deviations else 0
            deviation_var = model.new_int_var(0, max_deviation, f"pref_deviation[{label}]")
            # Link deviation_var to the chosen block using element constraint
            model.add_element(block_choice[pair_index], deviations, deviation_var)
            deviation_terms.append(deviation_var)

    # ── Hard Constraint: No instructor overlap ────────────────────────────────
    # An instructor cannot teach two subjects at the same timeslot.
    instructor_slot_groups: dict[tuple[int, int], list[cp_model.IntVar]] = {}
    for (pair_index, ts_id), slot_var in uses_slot.items():
        instructor_slot_groups.setdefault((pair_data[pair_index]["instructor_id"], ts_id), []).append(slot_var)
    for group in instructor_slot_groups.values():
        if len(group) > 1:
            model.add_at_most_one(group)

    # ── Hard Constraint: No room overlap ─────────────────────────────────────
    # A room cannot be used by two classes at the same timeslot.
    room_slot_groups: dict[tuple[int, int], list[cp_model.IntVar]] = {}
    for (pair_index, room_id, ts_id), room_slot_var in uses_room_slot.items():
        room_slot_groups.setdefault((room_id, ts_id), []).append(room_slot_var)
    for group in room_slot_groups.values():
        if len(group) > 1:
            model.add_at_most_one(group)

    # ── Configure and run the solver ─────────────────────────────────────────
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 30.0   # Time limit per solve call
    solver.parameters.num_search_workers = 8        # Parallel search workers

    best_rooms: dict[int, int] = {}
    best_blocks: dict[int, int] = {}

    def remember_solution() -> None:
        """Store the current solution's room and block choices."""
        best_rooms.clear()
        best_blocks.clear()
        for pair_index, data in pair_data.items():
            best_rooms[pair_index] = data["room_ids"][solver.value(room_choice[pair_index])]
            best_blocks[pair_index] = solver.value(block_choice[pair_index])

    # Stage 1: Find any feasible solution
    stage1_status = solver.solve(model)
    final_status = stage1_status
    if stage1_status not in (cp_model.FEASIBLE, cp_model.OPTIMAL):
        detail = _diagnostics(
            pairs,
            pair_data,
            subject_map,
            instructor_map,
            rooms,
            allowed_timeslot_ids,
            allowed_timeslots_per_instructor,
        )
        return {
            "status": "infeasible",
            "solution_status": _status_name(solver, stage1_status),
            "message": f"No feasible schedule found. Diagnostics:{detail}",
            "assignments": [],
        }
    remember_solution()

    # Stage 2: Minimize total preferred time deviation across all pairs
    deviation_expr = sum(deviation_terms) if deviation_terms else None
    if deviation_expr is not None:
        model.minimize(deviation_expr)
        stage2_status = solver.solve(model)
        if stage2_status in (cp_model.FEASIBLE, cp_model.OPTIMAL):
            final_status = stage2_status
            remember_solution()

    # ── Build and return the final assignment list ────────────────────────────
    assignments = []
    for pair_index, data in pair_data.items():
        block = data["blocks"][best_blocks[pair_index]]
        for ts_id in block:
            assignments.append(
                {
                    "instructor_id": data["instructor_id"],
                    "subject_id": data["subject_id"],
                    "room_id": best_rooms[pair_index],
                    "timeslot_id": ts_id,
                }
            )

    return {
        "status": "success",
        "solution_status": _status_name(solver, final_status),
        "message": f"Schedule generated with {len(assignments)} session slots assigned.",
        "assignments": assignments,
    }
