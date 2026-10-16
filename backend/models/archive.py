from datetime import datetime
from typing import Any
from uuid import UUID


def validate_archive(value: Any, archive_id: str) -> dict[str, Any]:
    try:
        UUID(archive_id)
    except (ValueError, TypeError):
        raise ValueError('Invalid archive ID.') from None
    if not isinstance(value, dict) or value.get('id') != archive_id or value.get('schemaVersion') != 1:
        raise ValueError('Unsupported or incomplete archive.')
    for field in ('name', 'schoolYear', 'semester'):
        if not isinstance(value.get(field), str) or not value[field].strip():
            raise ValueError('Archive name, school year, and semester are required.')
    try:
        created = datetime.fromisoformat(value['createdAt'].replace('Z', '+00:00'))
        if created.tzinfo is None:
            raise ValueError()
    except (KeyError, TypeError, ValueError, AttributeError):
        raise ValueError('Invalid archive creation date.') from None
    schedule = value.get('schedule')
    data = value.get('assistantData')
    view = value.get('view')
    if not isinstance(schedule, dict) or not schedule.get('name') or not isinstance(data, dict) or not isinstance(view, dict):
        raise ValueError('Archive snapshot is incomplete.')
    for field in ('events', 'rooms', 'times', 'tbaSubjects'):
        if not isinstance(schedule.get(field), list):
            raise ValueError('Archive schedule data is incomplete.')
    if not isinstance(value.get('adminEvents'), list) or not isinstance(data.get('assistants'), list) or not isinstance(data.get('settings'), dict):
        raise ValueError('Archive assistant or event data is incomplete.')
    for field in ('scheduleDate', 'assistantWeekStart'):
        try:
            datetime.strptime(view[field], '%Y-%m-%d')
        except (KeyError, TypeError, ValueError):
            raise ValueError('Invalid archive viewing date.') from None
    return value
