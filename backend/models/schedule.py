from typing import Any


def validate_shared_schedule(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("Expected a schedule object.")
    events = value.get("csvEvents")
    name = value.get("csvName")
    if not isinstance(events, list) or not isinstance(name, str):
        raise ValueError("Schedule data must include csvName and csvEvents.")
    allowed_fields = {
        "id", "source", "stubCode", "courseCode", "subject", "startMinutes",
        "endMinutes", "dayCode", "classType", "room", "studentCount",
        "instructorLastName",
    }
    cleaned_events = [
        {field: event[field] for field in allowed_fields if field in event}
        for event in events
        if isinstance(event, dict)
    ]
    return {"csvName": name, "csvEvents": cleaned_events}
