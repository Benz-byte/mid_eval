from typing import Any

from database.supabase.admin_event_repository import delete_event, load_deleted_event_ids, load_events, save_event
from models.admin_event import validate_admin_event


def get_admin_events() -> list[dict[str, Any]]:
    return load_events()


def get_admin_event_sync() -> dict[str, Any]:
    events = load_events()
    deleted_ids = load_deleted_event_ids()
    deleted = set(deleted_ids)
    return {'events': [event for event in events if event['id'] not in deleted],
            'deletedIds': deleted_ids, 'eventStorageVersion': 1}


def update_admin_event(value: Any, event_id: str) -> None:
    save_event(validate_admin_event(value, event_id))


def remove_admin_event(event_id: str) -> None:
    delete_event(event_id)
