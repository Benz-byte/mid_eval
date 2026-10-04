import unittest
from unittest.mock import patch

from backend.database.supabase.admin_event_repository import load_events, save_event


class EventDescriptionTests(unittest.TestCase):
    def setUp(self):
        self.event = dict(id='booking_test', courseCode='Exam', date='2026-10-05',
                          room='MT102', startMinutes=420, endMinutes=480,
                          description='Bring your ID.\nArrive early.')

    def test_description_round_trip(self):
        with patch('backend.database.supabase.admin_event_repository.request') as request:
            save_event(self.event)
            payload = request.call_args.kwargs['payload']
            self.assertEqual(payload['description'], self.event['description'])
            request.return_value = [payload]
            self.assertEqual(load_events()[0]['description'], self.event['description'])

    def test_legacy_schema_without_description(self):
        row = dict(id='old', title='Event', event_date='2026-10-05', room='MT102',
                   start_minutes=420, end_minutes=480)
        with patch('backend.database.supabase.admin_event_repository.request',
                   side_effect=[RuntimeError('missing column'), [row]]):
            self.assertEqual(load_events()[0]['description'], '')

    def test_missing_column_does_not_silently_drop_description(self):
        with patch('backend.database.supabase.admin_event_repository.request',
                   side_effect=RuntimeError('missing column')) as request:
            with self.assertRaises(RuntimeError):
                save_event(self.event)
            self.assertEqual(request.call_count, 1)

    def test_blank_description_supports_legacy_schema(self):
        with patch('backend.database.supabase.admin_event_repository.request',
                   side_effect=[RuntimeError('missing column'), None]) as request:
            save_event({**self.event, 'description': ''})
            self.assertNotIn('description', request.call_args.kwargs['payload'])


if __name__ == '__main__':
    unittest.main()
