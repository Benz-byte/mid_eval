import unittest
from unittest.mock import patch

from backend.database.supabase.admin_event_repository import load_events, save_event
from backend.models.admin_event import validate_admin_event


class EventScheduleTests(unittest.TestCase):
    def setUp(self):
        self.event = dict(id='a', courseCode='Event', room='MT102', date='2026-10-16',
                          startMinutes=420, endMinutes=480, scheduleKey='hash-A', assistantId='student-1')

    def test_scope_and_assistant_round_trip(self):
        with patch('backend.database.supabase.admin_event_repository.request', side_effect=[[], None]) as request:
            save_event(self.event)
            payload = request.call_args.kwargs['payload']
            self.assertEqual(payload['schedule_key'], 'hash-A')
            request.side_effect = None
            request.return_value = [payload]
            event = load_events()[0]
            self.assertEqual(event['scheduleKey'], 'hash-A')
            self.assertEqual(event['assistantId'], 'student-1')
            self.assertIn('schedule_key', request.call_args.kwargs['query']['select'])

    def test_missing_migration_must_not_report_unscoped_save_as_success(self):
        with patch('backend.database.supabase.admin_event_repository.request',
                   side_effect=RuntimeError('missing schedule_key')) as request:
            with self.assertRaises(RuntimeError):
                save_event(self.event)
            self.assertEqual(request.call_count, 1)

    def test_scope_validation(self):
        self.assertEqual(validate_admin_event(self.event, 'a')['scheduleKey'], 'hash-A')
        for invalid in ('', '   ', None, 42):
            with self.assertRaises(ValueError):
                validate_admin_event({**self.event, 'scheduleKey': invalid}, 'a')
