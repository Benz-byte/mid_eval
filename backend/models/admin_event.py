from typing import Any


def validate_admin_event(value: Any, event_id: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("Expected an event object.")
    required = ("courseCode", "date", "room", "startMinutes", "endMinutes")
    if any(field not in value for field in required):
        raise ValueError("Event data is incomplete.")
    if not value["courseCode"].strip() or not value["room"].strip():
        raise ValueError("Event name and room are required.")
    if value["endMinutes"] <= value["startMinutes"]:
        raise ValueError("Event end time must be later than its start time.")
    return {**value, "id": event_id}
