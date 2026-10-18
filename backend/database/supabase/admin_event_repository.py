from typing import Any

from .client import request

PAGE_SIZE = 1000


class EventDeletedError(ValueError):
    pass


def load_deleted_event_ids() -> list[str]:
    ids: list[str] = []
    while True:
        page = request('GET', 'admin_event_deletions', query={
            'select': 'event_id', 'order': 'event_id.asc',
            'limit': str(PAGE_SIZE), 'offset': str(len(ids)),
        }) or []
        ids.extend(row['event_id'] for row in page)
        if len(page) < PAGE_SIZE:
            return ids


def _load_event_rows(select: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        page = request("GET", "admin_events", query={
            "select": select,
            "order": "updated_at.asc",
            "limit": str(PAGE_SIZE),
            "offset": str(offset),
        }) or []
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows
        offset += PAGE_SIZE


def load_events() -> list[dict[str, Any]]:
    try:
        rows = _load_event_rows(
            "id,title,description,schedule_key,event_date,room,start_minutes,end_minutes,assistant_id,assistant_label,updated_at",
        )
    except RuntimeError:
        try:
            rows = _load_event_rows(
                "id,title,description,event_date,room,start_minutes,end_minutes,assistant_id,assistant_label,updated_at",
            )
        except RuntimeError:
            rows = _load_event_rows(
                "id,title,event_date,room,start_minutes,end_minutes,updated_at",
            )
    return [{
        "id": row["id"],
        "scheduleKey": row.get("schedule_key") or None,
        "source": "admin",
        "courseCode": row["title"],
        "description": row.get("description") or "",
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
    deleted = request('GET', 'admin_event_deletions', query={
        'select': 'event_id', 'event_id': f"eq.{event['id']}", 'limit': '1',
    })
    if deleted:
        raise EventDeletedError('This event was deleted on another device.')
    payload = {
        "id": event["id"],
        "title": event["courseCode"],
        "description": event.get("description") or "",
        "event_date": event["date"],
        "room": event["room"],
        "start_minutes": event["startMinutes"],
        "end_minutes": event["endMinutes"],
        "assistant_id": event.get("assistantId") or None,
        "assistant_label": event.get("assistantLabel") or None,
    }
    if event.get('scheduleKey'):
        payload['schedule_key'] = event['scheduleKey']
    try:
        request("POST", "admin_events", payload=payload, prefer="resolution=merge-duplicates,return=minimal")
    except RuntimeError as error:
        if 'ADMIN_EVENT_DELETED' in str(error):
            raise EventDeletedError('This event was deleted on another device.') from error
        raise


def delete_event(event_id: str) -> None:
    request('POST', 'rpc/delete_admin_event', payload={'event_id_value': event_id})
