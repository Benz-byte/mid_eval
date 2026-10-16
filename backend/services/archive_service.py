from typing import Any
from uuid import UUID

from database.supabase.archive_repository import create_archive, delete_archive, load_archives
from models.archive import validate_archive


def get_archives() -> list[dict[str, Any]]:
    return load_archives()


def save_archive(value: Any, archive_id: str) -> None:
    create_archive(validate_archive(value, archive_id))


def remove_archive(archive_id: str) -> None:
    try:
        UUID(archive_id)
    except ValueError:
        raise ValueError('Invalid archive ID.') from None
    delete_archive(archive_id)
