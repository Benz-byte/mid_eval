import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.database.supabase.admin_event_repository import (
    EventDeletedError, delete_event, load_deleted_event_ids, save_event,
)

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import create_app
from database.supabase.admin_event_repository import EventDeletedError as ApiEventDeletedError


class EventDeletionTests(unittest.TestCase):
    event = dict(id='event-A', courseCode='Event', date='2026-10-16', room='MT102',
                 startMinutes=420, endMinutes=480, scheduleKey='csv-A')

    def test_deleted_event_put_is_rejected_without_writing(self):
        with patch('backend.database.supabase.admin_event_repository.request', return_value=[{'event_id': 'event-A'}]) as request:
            with self.assertRaises(EventDeletedError):
                save_event(self.event)
            self.assertEqual(request.call_count, 1)
            self.assertEqual(request.call_args.args, ('GET', 'admin_event_deletions'))

    def test_database_guard_handles_delete_between_check_and_upsert(self):
        with patch('backend.database.supabase.admin_event_repository.request',
                   side_effect=[[], RuntimeError('ADMIN_EVENT_DELETED')]):
            with self.assertRaises(EventDeletedError):
                save_event(self.event)

    def test_missing_migration_does_not_acknowledge_an_unsafe_save(self):
        with patch('backend.database.supabase.admin_event_repository.request', side_effect=RuntimeError('missing table')) as request:
            with self.assertRaises(RuntimeError):
                save_event(self.event)
            self.assertEqual(request.call_count, 1)

    def test_delete_records_id_even_before_first_upload(self):
        with patch('backend.database.supabase.admin_event_repository.request') as request:
            delete_event('not-uploaded-yet')
            self.assertEqual(request.call_args.args, ('POST', 'rpc/delete_admin_event'))
            self.assertEqual(request.call_args.kwargs['payload'], {'event_id_value': 'not-uploaded-yet'})

    def test_all_deleted_ids_are_paginated(self):
        with patch('backend.database.supabase.admin_event_repository.PAGE_SIZE', 2), \
             patch('backend.database.supabase.admin_event_repository.request',
                   side_effect=[[{'event_id': 'A'}, {'event_id': 'B'}], [{'event_id': 'C'}]]) as request:
            self.assertEqual(load_deleted_event_ids(), ['A', 'B', 'C'])
            self.assertEqual(request.call_args.kwargs['query']['offset'], '2')

    def test_routes_keep_legacy_reads_and_expose_sync_metadata_and_gone(self):
        client = create_app().test_client()
        with patch('routes.admin_events.load_admin_events', return_value=[self.event]):
            self.assertEqual(client.get('/api/admin-events').get_json(), [self.event])
        with patch('routes.admin_events.get_admin_event_sync', return_value={'events': [], 'deletedIds': ['event-A'], 'eventStorageVersion': 1}):
            self.assertEqual(client.get('/api/admin-events?include_deleted=true').get_json()['deletedIds'], ['event-A'])
        with patch('routes.admin_events.save_admin_event', side_effect=ApiEventDeletedError('Deleted')):
            self.assertEqual(client.put('/api/admin-events/event-A', json=self.event).status_code, 410)
        with patch('routes.admin_events.delete_admin_event'):
            self.assertEqual(client.delete('/api/admin-events/event-A').get_json(), {'eventStorageVersion': 1})

    def test_migration_guards_direct_writes_and_uses_atomic_delete(self):
        sql = (Path(__file__).resolve().parents[2] / 'database/supabase/migrations/010_admin_event_deletions.sql').read_text()
        for fragment in ('before insert or update or delete', 'pg_advisory_xact_lock',
                         'ADMIN_EVENT_DELETED', 'on conflict (event_id) do nothing',
                         'revoke all on public.admin_event_deletions from anon, authenticated', 'begin;', 'commit;'):
            self.assertIn(fragment, sql)
