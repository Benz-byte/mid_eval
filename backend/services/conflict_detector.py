from typing import Any


def events_overlap(first: dict[str, Any], second: dict[str, Any]) -> bool:
    return (
        first.get("room") == second.get("room")
        and first.get("startMinutes", 0) < second.get("endMinutes", 0)
        and first.get("endMinutes", 0) > second.get("startMinutes", 0)
    )
