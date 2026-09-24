"""CP-SAT model for recurring weekly student-assistant duty assignments."""

from collections import defaultdict
from dataclasses import dataclass
import random
import re
from typing import Any

from ortools.sat.python import cp_model


DAY_ORDER = {"M": 0, "T": 1, "W": 2, "Th": 3, "F": 4, "S": 5, "Su": 6}
DEFAULT_MAXIMUM_WEEKLY_DUTY_MINUTES = 20 * 60
DEFAULT_MAXIMUM_DAILY_DUTY_MINUTES = 4 * 60
SLOT_MINUTES = 30
THREE_HOUR_DUTY_MINUTES = 3 * 60
DEFAULT_DUTY_GAP_MINUTES = 30
ALLOWED_DUTY_GAP_MINUTES = {0, 30, 60, 90, 120}


@dataclass(frozen=True)
class Meeting:
    occurrence_id: str
    source_id: str
    day: str
    start: int
    end: int
    course_code: str
    subject: str
    room: str
    section: str


@dataclass(frozen=True)
class CoverageUnit:
    unit_id: str
    meeting: Meeting
    start: int
    end: int

    @property
    def duration(self) -> int:
        return self.end - self.start


def _expand_days(day_code: str) -> tuple[str, ...]:
    normalized = day_code.strip()
    days = tuple(re.findall(r"Th|Su|M|T|W|F|S", normalized))
    if days and "".join(days) == normalized and all(day in DAY_ORDER for day in days):
        return days
    raise ValueError(f"Unsupported weekday code: {day_code!r}")


def _parse_meetings(events: list[dict[str, Any]], prefix: str) -> list[Meeting]:
    meetings: list[Meeting] = []
    for index, event in enumerate(events):
        start = int(event.get("startMinutes", -1))
        end = int(event.get("endMinutes", -1))
        if start < 0 or end <= start or end > 24 * 60:
            raise ValueError(f"Invalid time range in {prefix} row {index + 1}.")

        source_id = str(event.get("id") or f"{prefix}-{index}")
        for day in _expand_days(str(event.get("dayCode", ""))):
            meetings.append(
                Meeting(
                    occurrence_id=f"{source_id}-{day}",
                    source_id=source_id,
                    day=day,
                    start=start,
                    end=end,
                    course_code=str(event.get("courseCode", "")).strip(),
                    subject=str(event.get("subject", "")).strip(),
                    room=str(event.get("room", "")).strip(),
                    section=str(event.get("section", "")).strip(),
                )
            )
    return meetings


def _coverage_units(meetings: list[Meeting]) -> list[CoverageUnit]:
    units: list[CoverageUnit] = []
    for meeting in meetings:
        cursor = meeting.start
        unit_index = 0
        while cursor < meeting.end:
            unit_end = min(cursor + SLOT_MINUTES, meeting.end)
            units.append(
                CoverageUnit(
                    unit_id=f"{meeting.occurrence_id}-slot-{unit_index}",
                    meeting=meeting,
                    start=cursor,
                    end=unit_end,
                )
            )
            cursor = unit_end
            unit_index += 1
    return units


def _overlaps(unit: CoverageUnit, busy: Meeting) -> bool:
    return (
        unit.meeting.day == busy.day
        and unit.start < busy.end
        and unit.end > busy.start
    )


def _duty_gap_minutes(payload: dict[str, Any]) -> int:
    settings = payload.get("schedulingSettings") or {}
    if not isinstance(settings, dict):
        raise ValueError("Scheduling settings must be a JSON object.")
    try:
        minutes = int(settings.get(
            "minimumGapAfterThreeHourDutyMinutes",
            DEFAULT_DUTY_GAP_MINUTES,
        ))
    except (TypeError, ValueError) as error:
        raise ValueError("The duty-break gap must be a number of minutes.") from error
    if minutes not in ALLOWED_DUTY_GAP_MINUTES:
        raise ValueError("The duty-break gap must be 0, 30, 60, 90, or 120 minutes.")
    return minutes


def _workload_limits(payload: dict[str, Any]) -> tuple[int, int]:
    settings = payload.get("schedulingSettings") or {}
    if not isinstance(settings, dict):
        raise ValueError("Scheduling settings must be a JSON object.")
    try:
        daily = int(settings.get(
            "maximumDailyDutyMinutes",
            DEFAULT_MAXIMUM_DAILY_DUTY_MINUTES,
        ))
        weekly = int(settings.get(
            "maximumWeeklyDutyMinutes",
            DEFAULT_MAXIMUM_WEEKLY_DUTY_MINUTES,
        ))
    except (TypeError, ValueError) as error:
        raise ValueError("Duty workload limits must be numbers of minutes.") from error
    if daily not in range(60, 8 * 60 + 1, 60):
        raise ValueError("The daily duty limit must be between 1 and 8 hours.")
    if weekly not in range(5 * 60, 40 * 60 + 1, 60):
        raise ValueError("The weekly duty limit must be between 5 and 40 hours.")
    if weekly < daily:
        raise ValueError("The weekly duty limit cannot be lower than the daily duty limit.")
    return daily, weekly


def _add_duty_break_constraints(
    model: cp_model.CpModel,
    assistant_occurrences: dict[
        tuple[str, str], list[tuple[str, cp_model.IntVar, int, int]]
    ],
    minimum_gap: int,
) -> int:
    """Forbid another regular duty too soon after three continuous duty hours."""
    if minimum_gap <= 0:
        return 0

    constraint_keys: set[tuple[str, str, tuple[str, ...]]] = set()
    constraint_count = 0

    for (assistant_id, day), raw_occurrences in assistant_occurrences.items():
        unique_occurrences = {
            (class_id, start, end): (class_id, variable, start, end)
            for class_id, variable, start, end in raw_occurrences
        }
        occurrences = sorted(
            unique_occurrences.values(),
            key=lambda item: (item[2], item[3], item[0]),
        )
        by_start: dict[int, list[tuple[str, cp_model.IntVar, int, int]]] = defaultdict(list)
        for occurrence in occurrences:
            by_start[occurrence[2]].append(occurrence)

        def extend_chain(
            path: list[tuple[str, cp_model.IntVar, int, int]],
            continuous_minutes: int,
        ) -> None:
            nonlocal constraint_count
            current_end = path[-1][3]
            path_keys = {(class_id, start, end) for class_id, _, start, end in path}
            if continuous_minutes >= THREE_HOUR_DUTY_MINUTES:
                for following in occurrences:
                    following_key = (following[0], following[2], following[3])
                    if following_key in path_keys or not (
                        current_end <= following[2] < current_end + minimum_gap
                    ):
                        continue
                    variables_by_class = {
                        class_id: variable
                        for class_id, variable, _, _ in [*path, following]
                    }
                    class_ids = tuple(sorted(variables_by_class))
                    key = (assistant_id, day, class_ids)
                    if key in constraint_keys:
                        continue
                    constraint_keys.add(key)
                    variables = list(variables_by_class.values())
                    model.add(sum(variables) <= len(variables) - 1)
                    constraint_count += 1
                return

            for following in by_start.get(current_end, []):
                following_key = (following[0], following[2], following[3])
                if following_key in path_keys:
                    continue
                extend_chain(
                    [*path, following],
                    continuous_minutes + following[3] - following[2],
                )

        for occurrence in occurrences:
            extend_chain([occurrence], occurrence[3] - occurrence[2])

    return constraint_count


def _merge_assignments(
    selected: list[tuple[str, CoverageUnit]],
    assistant_labels: dict[str, str],
) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str], list[CoverageUnit]] = defaultdict(list)
    for assistant_id, unit in selected:
        grouped[(assistant_id, unit.meeting.occurrence_id)].append(unit)

    assignments: list[dict[str, Any]] = []
    for (assistant_id, _), units in grouped.items():
        units.sort(key=lambda unit: unit.start)
        current_start = units[0].start
        current_end = units[0].end

        for unit in units[1:]:
            if unit.start == current_end:
                current_end = unit.end
                continue

            meeting = units[0].meeting
            assignments.append(
                _assignment_payload(
                    assistant_id,
                    assistant_labels[assistant_id],
                    meeting,
                    current_start,
                    current_end,
                )
            )
            current_start = unit.start
            current_end = unit.end

        meeting = units[0].meeting
        assignments.append(
            _assignment_payload(
                assistant_id,
                assistant_labels[assistant_id],
                meeting,
                current_start,
                current_end,
            )
        )

    return sorted(
        assignments,
        key=lambda item: (
            DAY_ORDER[item["day"]],
            item["startMinutes"],
            item["room"],
            item["assistantLabel"],
        ),
    )


def _assignment_payload(
    assistant_id: str,
    assistant_label: str,
    meeting: Meeting,
    start: int,
    end: int,
) -> dict[str, Any]:
    return {
        "assistantId": assistant_id,
        "assistantLabel": assistant_label,
        "classId": meeting.source_id,
        "day": meeting.day,
        "startMinutes": start,
        "endMinutes": end,
        "courseCode": meeting.course_code,
        "subject": meeting.subject,
        "room": meeting.room,
        "section": meeting.section,
    }


def _solve_incremental_schedule(payload: dict[str, Any]) -> dict[str, Any]:
    incremental = payload["incremental"]
    if not isinstance(incremental, dict):
        return {"status": "INVALID", "diagnostics": ["Incremental schedule data is invalid."]}
    existing = incremental.get("existingResult")
    new_ids = incremental.get("newAssistantIds")
    main_events = payload.get("mainSchedule")
    assistants = payload.get("assistants")
    if not isinstance(existing, dict) or not isinstance(new_ids, list) or not new_ids:
        return {"status": "INVALID", "diagnostics": ["No new student assistants were provided."]}
    if not isinstance(main_events, list) or not isinstance(assistants, list):
        return {"status": "INVALID", "diagnostics": ["Schedule data is missing."]}

    try:
        minimum_gap = _duty_gap_minutes(payload)
        maximum_daily, maximum_weekly = _workload_limits(payload)
        applied = existing.get("appliedSettings") or {}
        if any((
            applied.get("minimumGapAfterThreeHourDutyMinutes") != minimum_gap,
            applied.get("maximumDailyDutyMinutes") != maximum_daily,
            applied.get("maximumWeeklyDutyMinutes") != maximum_weekly,
        )):
            raise ValueError(
                "The scheduling settings differ from the existing schedule. "
                "Its assignments were kept; use the original settings to add assistants."
            )

        meetings = _parse_meetings(main_events, "main schedule")
        existing_assignments = existing.get("assignments") or []
        existing_totals = existing.get("assistantTotals") or []
        if not isinstance(existing_assignments, list) or not isinstance(existing_totals, list):
            raise ValueError("The existing schedule cannot be read.")

        assistant_by_id = {str(assistant.get("id")): assistant for assistant in assistants}
        optimized_ids = existing.get("optimizedAssistantIds")
        roster_ids = (
            {str(assistant_id) for assistant_id in optimized_ids}
            if isinstance(optimized_ids, list)
            else {str(total.get("assistantId")) for total in existing_totals}
        )
        added_ids = {str(assistant_id) for assistant_id in new_ids}
        if not added_ids.issubset(assistant_by_id) or added_ids & roster_ids:
            raise ValueError("The new student assistant list does not match the saved schedule.")
        if not roster_ids.issubset(assistant_by_id):
            raise ValueError("An assistant from the saved schedule is missing.")

        occupied: dict[tuple[str, str, int, int], list[tuple[int, int]]] = defaultdict(list)
        for assignment in existing_assignments:
            class_id = str(assignment["classId"])
            day = str(assignment["day"])
            start = int(assignment["startMinutes"])
            end = int(assignment["endMinutes"])
            assistant_id = str(assignment["assistantId"])
            match = next((meeting for meeting in meetings
                          if meeting.source_id == class_id and meeting.day == day
                          and meeting.start <= start < end <= meeting.end), None)
            if match is None or assistant_id not in assistant_by_id:
                raise ValueError("The saved assignments do not match the current schedule.")
            occupied[(match.source_id, match.day, match.start, match.end)].append((start, end))

        fixed_by_assistant: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for assignment in existing_assignments:
            assistant_id = str(assignment["assistantId"])
            if assistant_id in added_ids:
                fixed_by_assistant[assistant_id].append({
                    "id": f"fixed-{assignment['classId']}-{assignment['day']}-{assignment['startMinutes']}",
                    "dayCode": assignment["day"],
                    "startMinutes": assignment["startMinutes"],
                    "endMinutes": assignment["endMinutes"],
                })

        open_events: list[dict[str, Any]] = []
        original_ids: dict[str, str] = {}
        for meeting in meetings:
            intervals = sorted(occupied[(meeting.source_id, meeting.day, meeting.start, meeting.end)])
            cursor = meeting.start
            for start, end in intervals + [(meeting.end, meeting.end)]:
                if start < cursor:
                    raise ValueError("The saved schedule contains overlapping assignments.")
                if cursor < start:
                    event_id = f"{meeting.source_id}::incremental::{meeting.day}::{cursor}"
                    original_ids[event_id] = meeting.source_id
                    open_events.append({
                        "id": event_id,
                        "dayCode": meeting.day,
                        "startMinutes": cursor,
                        "endMinutes": start,
                        "courseCode": meeting.course_code,
                        "subject": meeting.subject,
                        "room": meeting.room,
                        "section": meeting.section,
                    })
                cursor = end
    except (KeyError, TypeError, ValueError) as error:
        return {"status": "INVALID", "diagnostics": [str(error)]}

    new_assignments: list[dict[str, Any]] = []
    if open_events:
        partial = solve_student_assistant_schedule({
            **payload,
            "mainSchedule": open_events,
            "assistants": [
                {**assistant, "fixedDuties": fixed_by_assistant[str(assistant.get("id"))]}
                for assistant in assistants if str(assistant.get("id")) in added_ids
            ],
            "incremental": None,
        })
        if partial["status"] not in ("OPTIMAL", "FEASIBLE"):
            return partial
        new_assignments = [
            {**assignment, "classId": original_ids[assignment["classId"]]}
            for assignment in partial.get("assignments", [])
        ]

    assignments = [*existing_assignments, *new_assignments]
    totals: dict[str, int] = defaultdict(int)
    for assignment in assignments:
        totals[str(assignment["assistantId"])] += (
            int(assignment["endMinutes"]) - int(assignment["startMinutes"])
        )
    assigned_class_ids = {str(assignment["classId"]) for assignment in assignments}
    class_ids = {meeting.source_id for meeting in meetings}
    return {
        "status": "FEASIBLE",
        "assignments": sorted(assignments, key=lambda assignment: (
            DAY_ORDER.get(str(assignment["day"]), 99),
            int(assignment["startMinutes"]),
            str(assignment["room"]),
            str(assignment["assistantLabel"]),
        )),
        "assistantTotals": [
            {
                "assistantId": assistant_id,
                "assistantLabel": str(assistant.get("label") or assistant_id),
                "hours": totals[assistant_id] / 60,
                "remainingHours": (maximum_weekly - totals[assistant_id]) / 60,
            }
            for assistant_id, assistant in assistant_by_id.items()
        ],
        "relieverAssignments": existing.get("relieverAssignments", []),
        "optimizedAssistantIds": list(assistant_by_id),
        "summary": {
            "assistantCount": len(assistants),
            "capacityHours": len(assistants) * maximum_weekly / 60,
            "coverageHours": sum(meeting.end - meeting.start for meeting in meetings) / 60,
            "assignmentCount": len(assignments),
            "assignedClassCount": len(assigned_class_ids),
            "unassignedClassCount": len(class_ids - assigned_class_ids),
        },
        "diagnostics": [] if new_assignments else [
            "No eligible unassigned duties were available for the new assistant."
        ],
        "appliedSettings": applied,
    }


def solve_student_assistant_schedule(payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("incremental"):
        return _solve_incremental_schedule(payload)
    main_events = payload.get("mainSchedule")
    assistants = payload.get("assistants")
    if not isinstance(main_events, list) or not main_events:
        return {"status": "INVALID", "diagnostics": ["Upload a main class schedule first."]}
    if not isinstance(assistants, list) or not assistants:
        return {"status": "INVALID", "diagnostics": ["Upload at least one assistant schedule."]}

    try:
        random_seed = int(payload.get("randomSeed", 0)) & 0x7FFFFFFF
    except (TypeError, ValueError):
        random_seed = 0
    randomizer = random.Random(random_seed)

    try:
        minimum_duty_gap = _duty_gap_minutes(payload)
        maximum_daily_duty, maximum_weekly_duty = _workload_limits(payload)
        main_meetings = _parse_meetings(main_events, "main schedule")
        coverage_units = _coverage_units(main_meetings)
        assistant_busy: dict[str, list[Meeting]] = {}
        assistant_fixed: dict[str, list[Meeting]] = {}
        assistant_labels: dict[str, str] = {}
        for index, assistant in enumerate(assistants):
            assistant_id = str(assistant.get("id") or f"assistant-{index}")
            label = str(assistant.get("label") or assistant_id).strip()
            schedule = assistant.get("schedule")
            if not isinstance(schedule, list) or not schedule:
                raise ValueError(f"{label} has no valid class meetings.")
            personal_meetings = _parse_meetings(schedule, label)
            fixed_duties = assistant.get("fixedDuties") or []
            if not isinstance(fixed_duties, list):
                raise ValueError(f"{label} has invalid fixed duties.")
            fixed_meetings = _parse_meetings(fixed_duties, f"{label} fixed duty")
            for index, fixed in enumerate(fixed_meetings):
                if any(
                    fixed.day == other.day and fixed.start < other.end and other.start < fixed.end
                    for other in [*personal_meetings, *fixed_meetings[:index]]
                ):
                    raise ValueError(f"{label} has overlapping saved duties or classes.")
            assistant_labels[assistant_id] = label
            assistant_fixed[assistant_id] = fixed_meetings
            assistant_busy[assistant_id] = [*personal_meetings, *fixed_meetings]
    except (TypeError, ValueError) as error:
        return {"status": "INVALID", "diagnostics": [str(error)]}

    coverage_minutes = sum(unit.duration for unit in coverage_units)

    model = cp_model.CpModel()
    assignment_vars: dict[tuple[str, str], cp_model.IntVar] = {}
    optional_intervals: dict[str, list[cp_model.IntervalVar]] = defaultdict(list)
    assistant_unit_vars: dict[str, list[tuple[cp_model.IntVar, CoverageUnit]]] = defaultdict(list)
    daily_vars: dict[tuple[str, str], list[tuple[cp_model.IntVar, int]]] = defaultdict(list)
    class_assistant_vars: dict[tuple[str, str], cp_model.IntVar] = {}
    unit_candidates: dict[str, list[cp_model.IntVar]] = defaultdict(list)
    assistant_total_vars: dict[str, cp_model.IntVar] = {}

    units_by_class: dict[str, list[CoverageUnit]] = defaultdict(list)
    for unit in coverage_units:
        units_by_class[unit.meeting.source_id].append(unit)

    class_candidates: dict[str, list[cp_model.IntVar]] = defaultdict(list)
    assistant_start_vars: dict[tuple[str, int], list[cp_model.IntVar]] = defaultdict(list)
    assistant_day_vars: dict[tuple[str, str], list[cp_model.IntVar]] = defaultdict(list)
    assistant_occurrences: dict[
        tuple[str, str], list[tuple[str, cp_model.IntVar, int, int]]
    ] = defaultdict(list)
    early_start_vars: list[cp_model.IntVar] = []
    for assistant_id, busy_meetings in assistant_busy.items():
        for class_id, class_units in units_by_class.items():
            if any(
                _overlaps(unit, busy)
                for unit in class_units
                for busy in busy_meetings
            ):
                continue

            class_key = (assistant_id, class_id)
            class_variable = model.new_bool_var(
                f"uses_{assistant_id}_{class_id}"
            )
            class_assistant_vars[class_key] = class_variable
            class_candidates[class_id].append(class_variable)

            meeting_occurrences = {
                (
                    unit.meeting.day,
                    unit.meeting.start,
                    unit.meeting.end,
                )
                for unit in class_units
            }
            for day, start, end in meeting_occurrences:
                assistant_start_vars[(assistant_id, start)].append(class_variable)
                assistant_day_vars[(assistant_id, day)].append(class_variable)
                assistant_occurrences[(assistant_id, day)].append(
                    (class_id, class_variable, start, end)
                )
                if start == 7 * 60:
                    early_start_vars.append(class_variable)

            for unit in class_units:
                variable = model.new_bool_var(f"assign_{assistant_id}_{unit.unit_id}")
                assignment_vars[(assistant_id, unit.unit_id)] = variable
                unit_candidates[unit.unit_id].append(variable)
                assistant_unit_vars[assistant_id].append((variable, unit))
                daily_vars[(assistant_id, unit.meeting.day)].append(
                    (variable, unit.duration)
                )
                model.add(variable == class_variable)

                week_start = DAY_ORDER[unit.meeting.day] * 24 * 60 + unit.start
                optional_intervals[assistant_id].append(
                    model.new_optional_fixed_size_interval_var(
                        week_start,
                        unit.duration,
                        variable,
                        f"interval_{assistant_id}_{unit.unit_id}",
                    )
                )

    fixed_weekly_minutes: dict[str, int] = defaultdict(int)
    fixed_daily_minutes: dict[tuple[str, str], int] = defaultdict(int)
    for assistant_id, fixed_meetings in assistant_fixed.items():
        for index, meeting in enumerate(fixed_meetings):
            fixed = model.new_bool_var(f"fixed_{assistant_id}_{index}")
            model.add(fixed == 1)
            assistant_start_vars[(assistant_id, meeting.start)].append(fixed)
            assistant_day_vars[(assistant_id, meeting.day)].append(fixed)
            assistant_occurrences[(assistant_id, meeting.day)].append(
                (meeting.source_id, fixed, meeting.start, meeting.end)
            )
            fixed_weekly_minutes[assistant_id] += meeting.end - meeting.start
            fixed_daily_minutes[(assistant_id, meeting.day)] += meeting.end - meeting.start

    duty_break_constraint_count = _add_duty_break_constraints(
        model,
        assistant_occurrences,
        minimum_duty_gap,
    )

    for unit in coverage_units:
        candidates = unit_candidates.get(unit.unit_id, [])
        if candidates:
            model.add_at_most_one(candidates)

    for class_id in units_by_class:
        candidates = class_candidates.get(class_id, [])
        if candidates:
            model.add_at_most_one(candidates)

    for assistant_id in assistant_busy:
        variables = assistant_unit_vars[assistant_id]
        total_minutes = model.new_int_var(
            0,
            maximum_weekly_duty,
            f"total_minutes_{assistant_id}",
        )
        model.add(total_minutes == fixed_weekly_minutes[assistant_id] + sum(
            variable * unit.duration for variable, unit in variables
        ))
        assistant_total_vars[assistant_id] = total_minutes
        model.add_no_overlap(optional_intervals[assistant_id])

        for day in DAY_ORDER:
            entries = daily_vars.get((assistant_id, day), [])
            if entries or fixed_daily_minutes[(assistant_id, day)]:
                model.add(
                    fixed_daily_minutes[(assistant_id, day)]
                    + sum(variable * duration for variable, duration in entries)
                    <= maximum_daily_duty
                )

    repeated_start_vars: list[cp_model.IntVar] = []
    for (assistant_id, start), variables in assistant_start_vars.items():
        if len(variables) < 2:
            continue
        repeated = model.new_int_var(
            0,
            len(variables) - 1,
            f"repeated_start_{assistant_id}_{start}",
        )
        model.add(repeated >= sum(variables) - 1)
        repeated_start_vars.append(repeated)

    active_day_vars: list[cp_model.IntVar] = []
    for (assistant_id, day), variables in assistant_day_vars.items():
        active = model.new_bool_var(f"active_day_{assistant_id}_{day}")
        for variable in variables:
            model.add(active >= variable)
        model.add(active <= sum(variables))
        active_day_vars.append(active)

    back_to_back_vars: dict[str, list[cp_model.IntVar]] = defaultdict(list)
    for (assistant_id, day), occurrences in assistant_occurrences.items():
        for left_index, (left_id, left_var, left_start, left_end) in enumerate(occurrences):
            for right_id, right_var, right_start, right_end in occurrences[left_index + 1:]:
                if left_id == right_id or not (
                    left_end == right_start or right_end == left_start
                ):
                    continue
                adjacent = model.new_bool_var(
                    f"back_to_back_{assistant_id}_{day}_{left_index}_{len(back_to_back_vars[assistant_id])}"
                )
                model.add(adjacent <= left_var)
                model.add(adjacent <= right_var)
                model.add(adjacent >= left_var + right_var - 1)
                back_to_back_vars[assistant_id].append(adjacent)

    has_back_to_back_vars: list[cp_model.IntVar] = []
    for assistant_id, variables in back_to_back_vars.items():
        has_adjacent = model.new_bool_var(f"has_back_to_back_{assistant_id}")
        for variable in variables:
            model.add(has_adjacent >= variable)
        model.add(has_adjacent <= sum(variables))
        has_back_to_back_vars.append(has_adjacent)

    class_variables = list(class_assistant_vars.values())
    total_variables = list(assistant_total_vars.values())
    minimum_assigned = model.new_int_var(0, maximum_weekly_duty, "minimum_assigned")
    maximum_assigned = model.new_int_var(0, maximum_weekly_duty, "maximum_assigned")
    for total_minutes in total_variables:
        model.add(minimum_assigned <= total_minutes)
        model.add(maximum_assigned >= total_minutes)
    random_tie_breaker = sum(
        variable * randomizer.randint(0, 99) for variable in class_variables
    )
    model.maximize(
        sum(class_variables) * 1_000_000_000
        + minimum_assigned * 100_000
        - maximum_assigned * 10_000
        + sum(total_variables) * 100
        + sum(active_day_vars) * 4_000
        + sum(has_back_to_back_vars) * 700
        - sum(early_start_vars) * 2_000
        - sum(repeated_start_vars) * 1_000
        + random_tie_breaker
    )

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 60
    solver.parameters.num_search_workers = 8
    solver.parameters.random_seed = random_seed
    solver.parameters.randomize_search = True
    status = solver.solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {
            "status": "INFEASIBLE",
            "diagnostics": [
                "No assignment satisfies all class conflicts, available duty periods, "
                f"the duty-break rule, the {maximum_daily_duty / 60:g}-hour daily limit, "
                f"and the {maximum_weekly_duty / 60:g}-hour weekly maximum."
            ],
        }

    units_by_id = {unit.unit_id: unit for unit in coverage_units}
    selected: list[tuple[str, CoverageUnit]] = []
    totals: dict[str, int] = defaultdict(int)
    for (assistant_id, unit_id), variable in assignment_vars.items():
        if solver.value(variable):
            unit = units_by_id[unit_id]
            selected.append((assistant_id, unit))
            totals[assistant_id] += unit.duration

    assignments = _merge_assignments(selected, assistant_labels)
    assigned_class_ids = {
        class_id
        for (assistant_id, class_id), variable in class_assistant_vars.items()
        if solver.value(variable)
    }
    unassigned_class_ids = [
        class_id for class_id in units_by_class
        if class_id not in assigned_class_ids
    ]
    print(
        f"\n[CP-SAT] Unassigned classes: {len(unassigned_class_ids)}",
        flush=True,
    )
    unassigned_count = len(units_by_class) - len(assigned_class_ids)
    return {
        "status": "OPTIMAL" if status == cp_model.OPTIMAL else "FEASIBLE",
        "assignments": assignments,
        "optimizedAssistantIds": list(assistant_labels),
        "assistantTotals": [
            {
                "assistantId": assistant_id,
                "assistantLabel": assistant_labels[assistant_id],
                "hours": totals[assistant_id] / 60,
                "remainingHours": (maximum_weekly_duty - totals[assistant_id]) / 60,
            }
            for assistant_id in assistant_labels
        ],
        "summary": {
            "assistantCount": len(assistants),
            "capacityHours": len(assistants) * maximum_weekly_duty / 60,
            "coverageHours": coverage_minutes / 60,
            "assignmentCount": len(assignments),
            "assignedClassCount": len(assigned_class_ids),
            "unassignedClassCount": unassigned_count,
        },
        "diagnostics": [],
        "appliedSettings": {
            "minimumGapAfterThreeHourDutyMinutes": minimum_duty_gap,
            "maximumDailyDutyMinutes": maximum_daily_duty,
            "maximumWeeklyDutyMinutes": maximum_weekly_duty,
            "dutyBreakConstraintCount": duty_break_constraint_count,
        },
    }
