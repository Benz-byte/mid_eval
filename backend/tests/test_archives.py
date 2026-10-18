import copy
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import create_app
from database.supabase.archive_repository import ArchiveNameConflictError as ApiArchiveNameConflictError
from backend.models.archive import validate_archive
from backend.database.supabase.archive_repository import create_archive, delete_archive, load_archives


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.archive = {
            'schemaVersion': 1, 'id': str(uuid4()), 'name': 'Final',
            'schoolYear': '2026–2027', 'semester': 'First', 'createdAt': '2026-10-16T04:00:00Z',
            'schedule': {'name': 'Schedule.csv', 'events': [], 'rooms': ['MT102'], 'times': [], 'tbaSubjects': []},
            'adminEvents': [], 'assistantData': {'assistants': [], 'settings': {}, 'result': None},
            'view': {'scheduleDate': '2026-10-16', 'assistantWeekStart': '2026-10-12'},
        }

    def test_validate_snapshot(self):
        self.assertEqual(validate_archive(self.archive, self.archive['id']), self.archive)
        for field in ('name', 'schoolYear', 'semester', 'schedule', 'assistantData', 'view'):
            broken = copy.deepcopy(self.archive)
            broken.pop(field)
            with self.assertRaises(ValueError):
                validate_archive(broken, self.archive['id'])

    def test_reject_mismatched_id_and_version(self):
        with self.assertRaises(ValueError):
            validate_archive(self.archive, str(uuid4()))
        with self.assertRaises(ValueError):
            validate_archive({**self.archive, 'schemaVersion': 2}, self.archive['id'])

    def test_repository_keeps_full_snapshot_and_ignores_duplicate_id(self):
        with patch('backend.database.supabase.archive_repository.request') as request:
            create_archive(self.archive)
            self.assertEqual(request.call_args.kwargs['payload']['snapshot'], self.archive)
            self.assertIn('resolution=ignore-duplicates', request.call_args.kwargs['prefer'])

    def test_delete_is_scoped_tombstone_not_active_schedule_write(self):
        with patch('backend.database.supabase.archive_repository.request') as request:
            delete_archive(self.archive['id'])
            self.assertEqual(request.call_args.args, ('PATCH', 'schedule_archives'))
            self.assertEqual(request.call_args.kwargs['query'], {'id': 'eq.' + self.archive['id']})
            self.assertEqual(set(request.call_args.kwargs['payload']), {'deleted_at'})

    def test_duplicate_names_ignore_case_and_extra_spaces(self):
        existing = {'id': str(uuid4()), 'archive': {**self.archive, 'name': '  FINAL  '}, 'deletedAt': None}
        with patch('backend.database.supabase.archive_repository.load_archives', return_value=[existing]), \
             patch('backend.database.supabase.archive_repository.request') as request:
            with self.assertRaisesRegex(ValueError, 'already exists'):
                create_archive(self.archive)
            request.assert_not_called()

    def test_deleted_name_can_be_reused(self):
        existing = {'id': str(uuid4()), 'archive': self.archive, 'deletedAt': '2026-10-17T00:00:00Z'}
        with patch('backend.database.supabase.archive_repository.load_archives', return_value=[existing]), \
             patch('backend.database.supabase.archive_repository.request') as request:
            create_archive(self.archive)
            self.assertEqual(request.call_args.kwargs['query'], {'on_conflict': 'id'})

    def test_same_id_retry_is_allowed_without_overwriting(self):
        existing = {'id': self.archive['id'], 'archive': self.archive, 'deletedAt': None}
        with patch('backend.database.supabase.archive_repository.load_archives', return_value=[existing]), \
             patch('backend.database.supabase.archive_repository.request') as request:
            create_archive(self.archive)
            request.assert_not_called()

    def test_list_includes_deletions_for_offline_devices(self):
        with patch('backend.database.supabase.archive_repository.request', return_value=[{
            'id': self.archive['id'], 'snapshot': self.archive, 'deleted_at': '2026-10-16T05:00:00Z',
        }]):
            self.assertIsNotNone(load_archives()[0]['deletedAt'])

    def test_routes_validate_and_use_separate_service(self):
        client = create_app().test_client()
        response = client.put('/api/archives/bad-id', json=self.archive)
        self.assertEqual(response.status_code, 400)
        with patch('routes.archives.save_archive') as save:
            response = client.put('/api/archives/' + self.archive['id'], json=self.archive)
            self.assertEqual(response.status_code, 204)
            self.assertEqual(save.call_args.args[0]['name'], 'Final')
        with patch('routes.archives.get_archives', return_value=[]):
            self.assertEqual(client.get('/api/archives').get_json(), [])
        with patch('routes.archives.remove_archive') as remove:
            self.assertEqual(client.delete('/api/archives/' + self.archive['id']).status_code, 204)
            remove.assert_called_once_with(self.archive['id'])

    def test_name_conflict_has_distinct_status_for_offline_resolution(self):
        with patch('routes.archives.save_archive', side_effect=ApiArchiveNameConflictError('Name already used')):
            response = create_app().test_client().put('/api/archives/' + self.archive['id'], json=self.archive)
            self.assertEqual(response.status_code, 409)
            self.assertEqual(response.get_json()['error'], 'Name already used')


if __name__ == '__main__':
    unittest.main()
