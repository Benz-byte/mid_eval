"""Convert current spreadsheet rows into normalized calendar events."""

from __future__ import annotations

import re
from typing import Any

ALIASES = {
    "course": ["course", "coursecode", "courseno", "subjectcode", "codeanddescription"],
    "subject": ["subject", "description", "coursetitle", "title"],
    "start": ["start", "starttime", "timefrom", "from"], "end": ["end", "endtime", "timeto", "to"],
    "time": ["time", "schedule", "classhours", "hours"], "day": ["day", "days", "weekday"],
    "room": ["room", "venue", "classroom"], "instructor": ["teacher", "instructor", "faculty", "professor", "name"],
    "instructorFirst": ["firstname", "teacherfirstname", "instructorfirstname"],
    "stubCode": ["stub", "stubcode", "stubno", "stubnumber"],
    "section": ["section", "block", "classsection"], "classType": ["type", "classtype", "component", "lecturelab"],
    "students": ["students", "studentcount", "enrolled", "classsize"],
}


def clean(value: Any = "") -> str:
    return str(value if value is not None else "").replace("\u00a0", " ").strip()


def header_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]", "", clean(value).lower())


def parse_time(value: Any) -> int | None:
    text = clean(value).upper()
    match = re.fullmatch(r"(\d{1,2})(?::(\d{2}))?\s*(AM|PM)", text)
    if match:
        hour, minute = int(match.group(1)), int(match.group(2) or 0)
        if not 1 <= hour <= 12 or minute > 59:
            return None
        hour = 0 if hour == 12 else hour
        return (hour + (12 if match.group(3) == "PM" else 0)) * 60 + minute
    digits = re.sub(r"\D", "", text)
    if not digits:
        return None
    hour, minute = divmod(int(digits), 100)
    hour += minute // 60
    result = hour * 60 + minute % 60
    return result if 0 <= result <= 1440 else None


def looks_like_class_clock(value: Any) -> bool:
    """Return true for the HHMM-style values used by class schedules."""
    text = clean(value).upper()
    if re.fullmatch(r"\d{1,2}(?::\d{2})?\s*(AM|PM)", text):
        return parse_time(text) is not None
    if not re.fullmatch(r"\d{3,4}", text):
        return False
    numeric = int(text)
    hour, minute = divmod(numeric, 100)
    return 0 <= hour <= 24 and 0 <= minute < 60


def normalize_day(value: Any) -> str | None:
    text = re.sub(r"[\s,/-]+", "", clean(value)).lower()
    names = {"monday": "M", "mon": "M", "tuesday": "T", "tue": "T", "tues": "T", "wednesday": "W", "wed": "W", "thursday": "Th", "thu": "Th", "thurs": "Th", "friday": "F", "fri": "F", "saturday": "S", "sat": "S", "sunday": "Su", "sun": "Su"}
    if text in names:
        return names[text]
    tokens = re.findall(r"th|su|m|t|w|f|s", text)
    if tokens and "".join(tokens) == text:
        return "".join(token.title() if token in {"th", "su"} else token.upper() for token in tokens)
    return None


def field_for_header(value: Any) -> str | None:
    key = header_key(value)
    return next((field for field, aliases in ALIASES.items() if any(key == alias or (len(alias) >= 5 and alias in key) for alias in aliases)), None)


def detect_header(rows: list[list[str]]) -> tuple[int, dict[str, int]] | None:
    best = None
    for row_index, row in enumerate(rows[:50]):
        columns: dict[str, int] = {}
        for index, value in enumerate(row):
            field = field_for_header(value)
            if field and field not in columns:
                columns[field] = index
        has_time = "time" in columns or {"start", "end"} <= columns.keys()
        if len(columns) >= 3 and has_time and (best is None or len(columns) > len(best[1])):
            best = (row_index, columns)
    return best


def infer_columns(rows: list[list[str]]) -> dict[str, int]:
    width = max((len(row) for row in rows), default=0)
    data = [row for row in rows if sum(bool(clean(value)) for value in row) >= 3]

    def best(predicate, excluded: set[int] | None = None) -> int | None:
        winner, score = None, 0.0
        for column in range(width):
            if excluded and column in excluded:
                continue
            values = [clean(row[column]) for row in data if column < len(row) and clean(row[column])]
            ratio = sum(bool(predicate(value)) for value in values) / len(values) if values else 0
            if ratio > score:
                winner, score = column, ratio
        return winner if score >= 0.35 else None

    columns: dict[str, int] = {}
    candidates = {
        "time": best(lambda value: bool(re.match(r"^\s*\d{1,4}(?::\d{2})?\s*[-–—]\s*\d{1,4}", value))),
        "day": best(lambda value: normalize_day(value) is not None),
        "course": best(lambda value: bool(re.search(r"[A-Za-z]{2,}\s*\d{2,}", value))),
    }
    columns.update({key: value for key, value in candidates.items() if value is not None})
    course_column = columns.get("course")
    if course_column is not None and course_column > 0:
        possible_stub = course_column - 1
        stub_values = [clean(row[possible_stub]) for row in data if possible_stub < len(row) and clean(row[possible_stub])]
        if stub_values and sum(value.isdigit() for value in stub_values) / len(stub_values) >= 0.8:
            columns["stubCode"] = possible_stub
    if "time" not in columns:
        winner, score = None, 0.0
        for start in range(width):
            for end in range(width):
                if start == end:
                    continue
                comparable = [
                    row for row in data
                    if start < len(row) and end < len(row)
                    and looks_like_class_clock(row[start])
                    and looks_like_class_clock(row[end])
                ]
                valid = 0
                for row in comparable:
                    start_minutes = parse_time(row[start])
                    end_minutes = parse_time(row[end])
                    if (
                        start_minutes is not None
                        and end_minutes is not None
                        and 6 * 60 <= start_minutes < end_minutes <= 24 * 60
                        and end_minutes - start_minutes <= 12 * 60
                    ):
                        valid += 1
                ratio = valid / max(len(comparable), len(data) * 0.5) if comparable else 0
                if ratio > score:
                    winner, score = (start, end), ratio
        if winner and score >= 0.35:
            columns["start"], columns["end"] = winner
    excluded = set(columns.values())
    patterns = {"classType": r"^(LEC|LAB|LECTURE|LABORATORY|SEM|PRACTICUM)$", "instructor": r"^[^,]+,\s*[^,]+$", "room": r"^(?=.*[A-Z])(?=.*\d)[A-Z]{1,10}[A-Z0-9-]{1,12}$"}
    for field, pattern in patterns.items():
        column = best(lambda value, expression=pattern: bool(re.match(expression, value, re.IGNORECASE)), excluded)
        if column is not None:
            columns[field] = column
            excluded.add(column)
    if course_column is not None and "subject" not in columns and course_column + 1 < width:
        columns["subject"] = course_column + 1
    room_column = columns.get("room")
    if room_column is not None:
        if "students" not in columns and room_column + 1 < width:
            student_values = [clean(row[room_column + 1]) for row in data if room_column + 1 < len(row)]
            if student_values and sum(value.isdigit() for value in student_values) / len(student_values) >= 0.8:
                columns["students"] = room_column + 1
        if "instructor" not in columns and room_column + 2 < width:
            columns["instructor"] = room_column + 2
        if "instructorFirst" not in columns and room_column + 3 < width:
            columns["instructorFirst"] = room_column + 3
    return columns


def _parse_legacy_schedule_rows(raw_rows: Any) -> dict[str, list[Any]]:
    if not isinstance(raw_rows, list):
        raise ValueError("Schedule rows must be a list.")
    rows = [[clean(value) for value in row] for row in raw_rows if isinstance(row, list)]
    header = detect_header(rows)
    header_index = header[0] if header else -1
    columns = {**infer_columns(rows[header_index + 1:]), **(header[1] if header else {})}
    if not ("time" in columns or {"start", "end"} <= columns.keys()) or "day" not in columns or "room" not in columns or not ({"course", "subject"} & columns.keys()):
        return {"events": [], "tbaSubjects": []}

    def value(row: list[str], field: str) -> str:
        index = columns.get(field)
        return clean(row[index]) if index is not None and index < len(row) else ""

    events, tba = [], []
    grouped_section = ""
    for offset, row in enumerate(rows[header_index + 1:]):
        if any(header_key(item) == "section" for item in row):
            grouped_section = next((item for item in reversed(row) if item and header_key(item) != "section"), grouped_section)
            continue
        if "time" in columns:
            parts = re.split(r"[-–—]", value(row, "time"), maxsplit=1)
            start, end = parse_time(parts[0]), parse_time(parts[1] if len(parts) > 1 else "")
        else:
            start, end = parse_time(value(row, "start")), parse_time(value(row, "end"))
        raw_day, room, course = value(row, "day"), value(row, "room"), value(row, "course")
        day, class_type = normalize_day(raw_day), value(row, "classType")
        embedded = re.match(r"^(.*?)\s+-\s+(LEC|LAB|LECTURE|LABORATORY|SEM|PRACTICUM)$", course, re.IGNORECASE)
        if embedded:
            course, class_type = clean(embedded.group(1)), class_type or clean(embedded.group(2))
        if course and (raw_day.upper() == "TBA" or room.upper() == "TBA" or (start == 0 and end == 0)):
            subject = course
            if subject not in tba:
                tba.append(subject)
            continue
        if start is None or end is None or end <= start or not day or not room or room.upper() == "TBA":
            continue
        index = offset + header_index + 1
        instructor = value(row, "instructor")
        instructor_first = value(row, "instructorFirst")
        if instructor and instructor_first and "," not in instructor:
            instructor = f"{instructor}, {instructor_first[0].upper()}"
        events.append({"id": f"import-{index}-{course}-{day}-{start}", "source": "csv", "stubCode": value(row, "stubCode"), "courseCode": course, "subject": value(row, "subject"), "startMinutes": start, "endMinutes": end, "dayCode": day, "classType": class_type, "section": value(row, "section") or grouped_section, "room": room, "studentCount": value(row, "students"), "instructorLastName": instructor})
    return {"events": events, "tbaSubjects": tba}


OFFICIAL_HEADER_LABELS = {
    "StubCode": "stubCode",
    "Subject": "subject",
    "SubjectTitle": "subjectTitle",
    "StartTime": "startTime",
    "EndTime": "endTime",
    "Day": "day",
    "RoomType": "roomType",
    "Room": "room",
    "StudentAmount": "studentAmount",
    "LastName": "lastName",
    "FirstName": "firstName",
    "MiddleName": "middleName",
}
OFFICIAL_HEADERS = {header_key(label): field for label, field in OFFICIAL_HEADER_LABELS.items()}


def _parse_official_schedule_rows(raw_rows: Any) -> dict[str, list[Any]]:
    if not isinstance(raw_rows, list):
        raise ValueError("Schedule rows must be a list.")
    rows = [[clean(value) for value in row] for row in raw_rows if isinstance(row, list)]
    rows = [row for row in rows if any(row)]
    if not rows:
        raise ValueError("The schedule file is empty.")

    header_indexes: dict[str, int] = {}
    duplicates: list[str] = []
    for index, label in enumerate(rows[0]):
        key = header_key(label)
        field = OFFICIAL_HEADERS.get(key)
        if not field:
            continue
        if field in header_indexes:
            duplicates.append(label)
        else:
            header_indexes[field] = index

    if duplicates:
        raise ValueError(f"Duplicate schedule labels: {', '.join(duplicates)}.")
    missing = [label for label, field in OFFICIAL_HEADER_LABELS.items() if field not in header_indexes]
    if missing:
        raise ValueError(
            "Invalid schedule format. Missing required labels: "
            + ", ".join(missing)
            + "."
        )

    def value(row: list[str], field: str) -> str:
        index = header_indexes[field]
        return clean(row[index]) if index < len(row) else ""

    events: list[dict[str, Any]] = []
    tba: list[str] = []
    invalid_rows: list[int] = []
    for row_number, row in enumerate(rows[1:], start=2):
        subject = value(row, "subject")
        subject_title = value(row, "subjectTitle")
        raw_day = value(row, "day")
        room = value(row, "room")
        start = parse_time(value(row, "startTime"))
        end = parse_time(value(row, "endTime"))

        is_tba = raw_day.upper() == "TBA" or room.upper() == "TBA" or (start == 0 and end == 0)
        if is_tba:
            label = subject or subject_title
            if label and label not in tba:
                tba.append(label)
            continue

        day = normalize_day(raw_day)
        if not subject or start is None or end is None or end <= start or not day or not room:
            invalid_rows.append(row_number)
            continue

        last_name = value(row, "lastName")
        first_name = value(row, "firstName")
        middle_name = value(row, "middleName")
        events.append({
            "id": f"import-{row_number}-{subject}-{day}-{start}",
            "source": "csv",
            "stubCode": value(row, "stubCode"),
            "courseCode": subject,
            "subject": subject_title,
            "startMinutes": start,
            "endMinutes": end,
            "dayCode": day,
            "classType": value(row, "roomType"),
            "section": "",
            "room": room,
            "studentCount": value(row, "studentAmount"),
            "lastName": last_name,
            "firstName": first_name,
            "middleName": middle_name,
        })

    if invalid_rows:
        preview = ", ".join(str(row) for row in invalid_rows[:10])
        suffix = "…" if len(invalid_rows) > 10 else ""
        raise ValueError(f"Invalid schedule data in row(s): {preview}{suffix}.")
    if not events and not tba:
        raise ValueError("The schedule contains no valid class rows.")
    return {"events": events, "tbaSubjects": tba}


def parse_schedule_rows(raw_rows: Any, format_name: str = "legacy") -> dict[str, list[Any]]:
    if format_name == "official":
        return _parse_official_schedule_rows(raw_rows)
    if format_name == "legacy":
        return _parse_legacy_schedule_rows(raw_rows)
    raise ValueError("Unknown schedule format.")
