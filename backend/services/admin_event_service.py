from typing import Any

from database.supabase.admin_event_repository import delete_event, load_events, save_event
from models.admin_event import validate_admin_event


def get_admin_events() -> list[dict[str, Any]]:
    return load_events()


def update_admin_event(value: Any, event_id: str) -> None:
    save_event(validate_admin_event(value, event_id))


def remove_admin_event(event_id: str) -> None:
    delete_event(event_id)
