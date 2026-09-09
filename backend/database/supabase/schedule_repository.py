from typing import Any

from .client import request

SCHEDULE_ID = "ccs-main"


def load_schedule() -> dict[str, Any] | None:
    rows = request("GET", "shared_schedules", query={
        "id": f"eq.{SCHEDULE_ID}",
        "select": "id,csv_name,csv_events,updated_at",
    })
    if not rows:
        return None
    row = rows[0]
    stored_schedule = row.get("csv_events") or []
    if isinstance(stored_schedule, dict):
        events = stored_schedule.get("events") or []
        rooms = stored_schedule.get("rooms") or []
        times = stored_schedule.get("times") or []
        fingerprint = stored_schedule.get("fingerprint") or ""
    else:
        events = stored_schedule
        rooms = []
        times = []
        fingerprint = ""
    return {
        "csvName": row.get("csv_name", ""),
        "csvEvents": events,
        "rooms": rooms,
        "times": times,
        "fingerprint": fingerprint,
        "updatedAt": row.get("updated_at"),
    }


def save_schedule(value: dict[str, Any]) -> None:
    request("POST", "shared_schedules", payload={
        "id": SCHEDULE_ID,
        "csv_name": value.get("csvName", ""),
        "csv_events": {
            "events": value.get("csvEvents") or [],
            "rooms": value.get("rooms") or [],
            "times": value.get("times") or [],
            "fingerprint": value.get("fingerprint") or "",
        },
    }, prefer="resolution=merge-duplicates,return=minimal")
