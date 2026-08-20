from typing import Any

from database.supabase.schedule_repository import load_schedule, save_schedule
from models.schedule import validate_shared_schedule


def get_shared_schedule() -> dict[str, Any] | None:
    return load_schedule()


def update_shared_schedule(value: Any) -> None:
    save_schedule(validate_shared_schedule(value))
