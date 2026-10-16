from datetime import datetime, timezone
from typing import Any

from .client import request


def load_archives() -> list[dict[str, Any]]:
    rows = []
    while True:
        page = request('GET', 'schedule_archives', query={
            'select': 'id,snapshot,deleted_at', 'order': 'created_at.desc,id.asc',
            'limit': '100', 'offset': str(len(rows)),
        }) or []
        rows.extend(page)
        if len(page) < 100:
            return [{'id': row['id'], 'archive': row['snapshot'], 'deletedAt': row['deleted_at']} for row in rows]


def create_archive(archive: dict[str, Any]) -> None:
    normalized = ' '.join(archive['name'].split()).lower()
    records = load_archives()
    if any(record['id'] == archive['id'] for record in records):
        return  # Retrying the same immutable snapshot is idempotent.
    for record in records:
        if not record['deletedAt'] and ' '.join(record['archive']['name'].split()).lower() == normalized:
            raise ValueError('An archive with this name already exists. Choose a different name.')
    try:
        request('POST', 'schedule_archives', query={'on_conflict': 'id'}, payload={
            'id': archive['id'], 'name': archive['name'], 'school_year': archive['schoolYear'],
            'semester': archive['semester'], 'created_at': archive['createdAt'], 'snapshot': archive,
        }, prefer='resolution=ignore-duplicates,return=minimal')
    except RuntimeError as error:
        if 'schedule_archives_unique_name' in str(error):
            raise ValueError('An archive with this name already exists. Choose a different name.') from error
        raise


def delete_archive(archive_id: str) -> None:
    # Keep a tombstone so offline devices cannot bring a deleted archive back.
    request('PATCH', 'schedule_archives', query={'id': f'eq.{archive_id}'},
            payload={'deleted_at': datetime.now(timezone.utc).isoformat()}, prefer='return=minimal')
