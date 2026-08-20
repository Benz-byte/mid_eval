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
    return {
        "csvName": row.get("csv_name", ""),
        "csvEvents": row.get("csv_events") or [],
        "updatedAt": row.get("updated_at"),
    }


def save_schedule(value: dict[str, Any]) -> None:
    request("POST", "shared_schedules", payload={
        "id": SCHEDULE_ID,
        "csv_name": value.get("csvName", ""),
        "csv_events": value.get("csvEvents") or [],
    }, prefer="resolution=merge-duplicates,return=minimal")
