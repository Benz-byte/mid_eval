"""CP-SAT model for recurring weekly student-assistant duty assignments."""

from collections import defaultdict
from dataclasses import dataclass
from typing import Any

from ortools.sat.python import cp_model


DAY_ORDER = {"M": 0, "T": 1, "W": 2, "Th": 3, "F": 4, "S": 5, "Su": 6}
DAY_EXPANSIONS = {
    "MW": ("M", "W"),
    "TTh": ("T", "Th"),
}
MINUTES_PER_WEEK = 20 * 60
MAX_MINUTES_PER_DAY = 6 * 60
SLOT_MINUTES = 30


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
    if normalized in DAY_EXPANSIONS:
        return DAY_EXPANSIONS[normalized]
    if normalized in DAY_ORDER:
        return (normalized,)
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


def solve_student_assistant_schedule(payload: dict[str, Any]) -> dict[str, Any]:
    main_events = payload.get("mainSchedule")
    assistants = payload.get("assistants")
    if not isinstance(main_events, list) or not main_events:
        return {"status": "INVALID", "diagnostics": ["Upload a main class schedule first."]}
    if not isinstance(assistants, list) or not assistants:
        return {"status": "INVALID", "diagnostics": ["Upload at least one assistant schedule."]}

    try:
        main_meetings = _parse_meetings(main_events, "main schedule")
        coverage_units = _coverage_units(main_meetings)
        assistant_busy: dict[str, list[Meeting]] = {}
        assistant_labels: dict[str, str] = {}
        for index, assistant in enumerate(assistants):
            assistant_id = str(assistant.get("id") or f"assistant-{index}")
            label = str(assistant.get("label") or assistant_id).strip()
            schedule = assistant.get("schedule")
            if not isinstance(schedule, list) or not schedule:
                raise ValueError(f"{label} has no valid class meetings.")
            assistant_labels[assistant_id] = label
            assistant_busy[assistant_id] = _parse_meetings(schedule, label)
    except (TypeError, ValueError) as error:
        return {"status": "INVALID", "diagnostics": [str(error)]}

    required_minutes = len(assistants) * MINUTES_PER_WEEK
    coverage_minutes = sum(unit.duration for unit in coverage_units)
    if coverage_minutes < required_minutes:
        difference = required_minutes - coverage_minutes
        message = (
            f"The main schedule provides only {coverage_minutes / 60:g} coverage hours, "
            f"but {len(assistants)} assistants require {required_minutes / 60:g} hours. "
            f"Add {difference / 60:g} hours of duty opportunities or use fewer assistants."
        )
        return {
            "status": "INFEASIBLE",
            "diagnostics": [message],
            "summary": {
                "assistantCount": len(assistants),
                "requiredHours": required_minutes / 60,
                "coverageHours": coverage_minutes / 60,
            },
        }

    model = cp_model.CpModel()
    assignment_vars: dict[tuple[str, str], cp_model.IntVar] = {}
    optional_intervals: dict[str, list[cp_model.IntervalVar]] = defaultdict(list)
    assistant_unit_vars: dict[str, list[tuple[cp_model.IntVar, CoverageUnit]]] = defaultdict(list)
    daily_vars: dict[tuple[str, str], list[tuple[cp_model.IntVar, int]]] = defaultdict(list)
    class_assistant_vars: dict[tuple[str, str], cp_model.IntVar] = {}
    unit_candidates: dict[str, list[cp_model.IntVar]] = defaultdict(list)

    units_by_class: dict[str, list[CoverageUnit]] = defaultdict(list)
    for unit in coverage_units:
        units_by_class[unit.meeting.source_id].append(unit)

    class_candidates: dict[str, list[cp_model.IntVar]] = defaultdict(list)
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
        model.add(
            sum(variable * unit.duration for variable, unit in variables)
            == MINUTES_PER_WEEK
        )
        model.add_no_overlap(optional_intervals[assistant_id])

        for day in DAY_ORDER:
            entries = daily_vars.get((assistant_id, day), [])
            if entries:
                model.add(
                    sum(variable * duration for variable, duration in entries)
                    <= MAX_MINUTES_PER_DAY
                )

    model.maximize(sum(class_assistant_vars.values()))

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 60
    solver.parameters.num_search_workers = 8
    status = solver.solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return {
            "status": "INFEASIBLE",
            "diagnostics": [
                "No assignment satisfies all class conflicts, available duty periods, "
                "the six-hour daily limit, and exactly 20 hours per assistant."
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
    unassigned_count = len(units_by_class) - len(assigned_class_ids)
    return {
        "status": "OPTIMAL" if status == cp_model.OPTIMAL else "FEASIBLE",
        "assignments": assignments,
        "assistantTotals": [
            {
                "assistantId": assistant_id,
                "assistantLabel": assistant_labels[assistant_id],
                "hours": totals[assistant_id] / 60,
            }
            for assistant_id in assistant_labels
        ],
        "summary": {
            "assistantCount": len(assistants),
            "requiredHours": required_minutes / 60,
            "coverageHours": coverage_minutes / 60,
            "assignmentCount": len(assignments),
            "assignedClassCount": len(assigned_class_ids),
            "unassignedClassCount": unassigned_count,
        },
        "diagnostics": [],
    }
