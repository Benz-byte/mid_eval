from typing import Any

from .client import request


def load_events() -> list[dict[str, Any]]:
    try:
        rows = request("GET", "admin_events", query={
            "select": "id,title,event_date,room,start_minutes,end_minutes,assistant_id,assistant_label,updated_at",
            "order": "updated_at.asc",
        }) or []
    except RuntimeError:
        rows = request("GET", "admin_events", query={
            "select": "id,title,event_date,room,start_minutes,end_minutes,updated_at",
            "order": "updated_at.asc",
        }) or []
    return [{
        "id": row["id"],
        "source": "admin",
        "courseCode": row["title"],
        "subject": "",
        "date": row["event_date"],
        "startMinutes": row["start_minutes"],
        "endMinutes": row["end_minutes"],
        "classType": "EVENT",
        "section": "",
        "room": row["room"],
        "studentCount": "",
        "instructorLastName": "",
        "assistantId": row.get("assistant_id") or None,
        "assistantLabel": row.get("assistant_label") or None,
    } for row in rows]


def save_event(event: dict[str, Any]) -> None:
    payload = {
        "id": event["id"],
        "title": event["courseCode"],
        "event_date": event["date"],
        "room": event["room"],
        "start_minutes": event["startMinutes"],
        "end_minutes": event["endMinutes"],
        "assistant_id": event.get("assistantId") or None,
        "assistant_label": event.get("assistantLabel") or None,
    }
    try:
        request("POST", "admin_events", payload=payload, prefer="resolution=merge-duplicates,return=minimal")
    except RuntimeError:
        payload.pop("assistant_id", None)
        payload.pop("assistant_label", None)
        request("POST", "admin_events", payload=payload, prefer="resolution=merge-duplicates,return=minimal")


def delete_event(event_id: str) -> None:
    request("DELETE", "admin_events", query={"id": f"eq.{event_id}"})
