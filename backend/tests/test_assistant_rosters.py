import unittest
import sys
from pathlib import Path
from unittest.mock import patch
from backend.database.supabase.student_assistant_repository import load_data, save_data

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import create_app


class AssistantRosterTests(unittest.TestCase):
    def test_rosters_round_trip_in_existing_storage(self):
        value = {'assistants': [{'id': 'A-student'}], 'activeScheduleKey': 'A',
                 'rostersBySchedule': {'A': [{'id': 'A-student'}], 'B': []},
                 'unlinkedAssistants': [{'id': 'legacy'}], 'solverResultsBySchedule': {}}
        with patch('backend.database.supabase.student_assistant_repository.request', return_value=[]) as request:
            save_data(value)
            payload = request.call_args.kwargs['payload']
            self.assertEqual(payload['solver_result']['rostersBySchedule'], value['rostersBySchedule'])
            request.return_value = [payload]
            loaded = load_data()
            self.assertEqual(loaded['rostersBySchedule'], value['rostersBySchedule'])
            self.assertEqual(loaded['unlinkedAssistants'], value['unlinkedAssistants'])

    def test_legacy_profiles_are_returned_without_inventing_scope(self):
        with patch('backend.database.supabase.student_assistant_repository.request',
                   return_value=[{'assistants': [{'id': 'legacy'}], 'solver_result': None}]):
            loaded = load_data()
            self.assertIsNone(loaded['rostersBySchedule'])
            self.assertEqual(loaded['assistants'], [{'id': 'legacy'}])

    def test_empty_snapshot_preserves_legacy_cloud_assistant(self):
        existing = {'assistants': [{'id': 'legacy'}], 'activeScheduleKey': 'A',
                    'rostersBySchedule': None, 'unlinkedAssistants': []}
        with patch('backend.database.supabase.student_assistant_repository.load_data', return_value=existing), \
             patch('backend.database.supabase.student_assistant_repository.request') as request:
            save_data({'assistants': [], 'activeScheduleKey': 'B', 'rostersBySchedule': {}})
            envelope = request.call_args.kwargs['payload']['solver_result']
            self.assertEqual(envelope['unlinkedAssistants'], [{'id': 'legacy'}])
            self.assertEqual(envelope['rostersBySchedule'], {})

    def test_older_roster_cannot_erase_newer_roster(self):
        existing = {'rostersBySchedule': {'A': [{'id': 'new'}], 'B': [{'id': 'other'}]},
                    'rosterRevisions': {'A': '2026-10-17T10:00:00.000Z:new'}}
        with patch('backend.database.supabase.student_assistant_repository.load_data', return_value=existing), \
             patch('backend.database.supabase.student_assistant_repository.request') as request:
            save_data({'activeScheduleKey': 'A', 'rostersBySchedule': {'A': []},
                       'rosterRevisions': {'A': '2026-10-17T09:00:00.000Z:old'}})
            payload = request.call_args.kwargs['payload']
            self.assertEqual(payload['assistants'], [{'id': 'new'}])
            self.assertEqual(payload['solver_result']['rostersBySchedule']['B'], [{'id': 'other'}])

    def test_route_acknowledges_scoped_storage_support(self):
        with patch('routes.student_assistants.save_student_assistant_data') as save:
            response = create_app().test_client().put('/api/student-assistants/shared', json={
                'assistants': [], 'activeScheduleKey': 'A', 'rostersBySchedule': {'A': []},
            })
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.get_json(), {'rosterStorageVersion': 1})
            save.assert_called_once()
