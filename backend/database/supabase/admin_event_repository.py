from typing import Any

from .client import request


def load_events() -> list[dict[str, Any]]:
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
    } for row in rows]


def save_event(event: dict[str, Any]) -> None:
    request("POST", "admin_events", payload={
        "id": event["id"],
        "title": event["courseCode"],
        "event_date": event["date"],
        "room": event["room"],
        "start_minutes": event["startMinutes"],
        "end_minutes": event["endMinutes"],
    }, prefer="resolution=merge-duplicates,return=minimal")


def delete_event(event_id: str) -> None:
    request("DELETE", "admin_events", query={"id": f"eq.{event_id}"})
