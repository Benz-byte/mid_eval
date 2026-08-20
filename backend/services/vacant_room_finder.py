from typing import Any

from .conflict_detector import events_overlap


def find_vacant_rooms(
    rooms: list[str], requested_event: dict[str, Any], existing_events: list[dict[str, Any]]
) -> list[str]:
    return [
        room for room in rooms
        if not any(events_overlap({**requested_event, "room": room}, event) for event in existing_events)
    ]
