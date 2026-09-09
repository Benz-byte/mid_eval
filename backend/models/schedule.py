from typing import Any


def validate_shared_schedule(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("Expected a schedule object.")
    events = value.get("csvEvents")
    name = value.get("csvName")
    rooms = value.get("rooms", [])
    times = value.get("times", [])
    fingerprint = value.get("fingerprint", "")
    if not isinstance(events, list) or not isinstance(name, str) or not isinstance(rooms, list) or not isinstance(times, list) or not isinstance(fingerprint, str):
        raise ValueError("Schedule data must include csvName, csvEvents, and valid room and time lists.")
    allowed_fields = {
        "id", "source", "stubCode", "courseCode", "subject", "startMinutes",
        "endMinutes", "dayCode", "classType", "room", "studentCount",
        "instructorLastName", "lastName", "firstName", "middleName",
    }
    cleaned_events = [
        {field: event[field] for field in allowed_fields if field in event}
        for event in events
        if isinstance(event, dict)
    ]
    cleaned_rooms: list[str] = []
    seen_rooms: set[str] = set()
    for room in rooms:
        if not isinstance(room, str) or not room.strip():
            continue
        display_name = room.strip()
        key = display_name.casefold()
        if key not in seen_rooms:
            seen_rooms.add(key)
            cleaned_rooms.append(display_name)
    cleaned_times = sorted({time for time in times if isinstance(time, int) and not isinstance(time, bool) and 0 <= time <= 1440})
    return {"csvName": name, "csvEvents": cleaned_events, "rooms": cleaned_rooms, "times": cleaned_times, "fingerprint": fingerprint}
