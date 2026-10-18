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
            self.assertEqual(response.get_json(), {'rosterStorageVersion': 1, 'resultStorageVersion': 1})
            save.assert_called_once()

    def save_results(self, existing, incoming):
        with patch('backend.database.supabase.student_assistant_repository.load_data', return_value=existing), \
             patch('backend.database.supabase.student_assistant_repository.request') as request:
            save_data(incoming)
            return request.call_args.kwargs['payload']['solver_result']

    def test_editing_b_cannot_overwrite_newer_duties_in_a_with_same_roster(self):
        existing = {'rostersBySchedule': {'A': [], 'B': []}, 'rosterRevisions': {'A': 'same', 'B': 'same'},
                    'solverResultsBySchedule': {'A': {'assignments': ['new-duty']}, 'B': {'assignments': []}},
                    'resultRevisions': {'A': '002', 'B': '001'}}
        incoming = {**existing, 'activeScheduleKey': 'B', 'solverResult': {'assignments': ['b-edit']},
                    'solverResultsBySchedule': {'A': {'assignments': ['old-duty']}},
                    'resultRevisions': {'A': '001', 'B': '003'}}
        envelope = self.save_results(existing, incoming)
        self.assertEqual(envelope['resultsBySchedule']['A'], {'assignments': ['new-duty']})
        self.assertEqual(envelope['resultsBySchedule']['B'], {'assignments': ['b-edit']})
        self.assertEqual(envelope['resultRevisions'], {'A': '002', 'B': '003'})

    def test_two_offline_csv_edits_are_both_saved_from_one_pending_snapshot(self):
        incoming = {'activeScheduleKey': 'B', 'rostersBySchedule': {'A': [], 'B': []},
                    'solverResultsBySchedule': {'A': {'assignments': ['a-edit']}},
                    'solverResult': {'assignments': ['b-edit']}, 'resultRevisions': {'A': '002', 'B': '003'}}
        envelope = self.save_results({}, incoming)
        self.assertEqual(envelope['resultsBySchedule'], {'A': {'assignments': ['a-edit']}, 'B': {'assignments': ['b-edit']}})

    def test_cleared_result_revision_prevents_old_cache_restoring_it(self):
        existing = {'rostersBySchedule': {'A': []}, 'solverResultsBySchedule': {'A': {'assignments': ['old']}},
                    'resultRevisions': {'A': '001'}}
        cleared = self.save_results(existing, {'activeScheduleKey': 'A', 'rostersBySchedule': {'A': []},
                                              'solverResult': None, 'resultRevisions': {'A': '003'}})
        existing.update(solverResultsBySchedule=cleared['resultsBySchedule'], resultRevisions=cleared['resultRevisions'])
        retried = self.save_results(existing, {'activeScheduleKey': 'A', 'rostersBySchedule': {'A': []},
                                              'solverResult': {'assignments': ['old']}, 'resultRevisions': {'A': '002'}})
        self.assertNotIn('A', retried['resultsBySchedule'])
        self.assertEqual(retried['resultRevisions']['A'], '003')

    def test_unversioned_inactive_cache_is_not_a_write(self):
        existing = {'solverResultsBySchedule': {'A': {'assignments': ['new']}}}
        envelope = self.save_results(existing, {'activeScheduleKey': 'B', 'rostersBySchedule': {'A': [], 'B': []},
                                               'solverResultsBySchedule': {'A': {'assignments': ['old']}}, 'solverResult': None})
        self.assertEqual(envelope['resultsBySchedule']['A'], {'assignments': ['new']})

    def test_old_client_cannot_overwrite_versioned_active_result(self):
        existing = {'solverResultsBySchedule': {'A': {'assignments': ['new']}}, 'resultRevisions': {'A': '002'}}
        incoming = {'activeScheduleKey': 'A', 'rostersBySchedule': {'A': []}, 'solverResult': None}
        self.assertEqual(self.save_results(existing, incoming)['resultsBySchedule']['A'], {'assignments': ['new']})

    def test_rejected_older_roster_cannot_replace_its_result(self):
        existing = {'rostersBySchedule': {'A': []}, 'rosterRevisions': {'A': '003'},
                    'solverResultsBySchedule': {}, 'resultRevisions': {'A': '003'}}
        incoming = {'activeScheduleKey': 'A', 'rostersBySchedule': {'A': [{'id': 'deleted-student'}]},
                    'rosterRevisions': {'A': '001'}, 'solverResult': {'assignments': ['stale']}, 'resultRevisions': {'A': '004'}}
        envelope = self.save_results(existing, incoming)
        self.assertNotIn('A', envelope['resultsBySchedule'])
        self.assertEqual(envelope['resultRevisions']['A'], '003')

    def test_result_revisions_round_trip_and_equal_revision_is_idempotent(self):
        existing = {'rostersBySchedule': {'A': []}, 'solverResultsBySchedule': {'A': {'assignments': ['new']}},
                    'resultRevisions': {'A': '002'}}
        envelope = self.save_results(existing, {**existing, 'activeScheduleKey': 'A', 'solverResult': None})
        self.assertEqual(envelope['resultsBySchedule']['A'], {'assignments': ['new']})
        with patch('backend.database.supabase.student_assistant_repository.request', return_value=[{'solver_result': envelope}]):
            self.assertEqual(load_data()['resultRevisions'], {'A': '002'})
