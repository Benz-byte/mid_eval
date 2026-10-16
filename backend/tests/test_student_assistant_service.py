import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import create_app
from services.student_assistant_service import (
    create_student_assistant_schedule, get_student_assistant_data, save_student_assistant_data,
)


class StudentAssistantServiceTests(unittest.TestCase):
    def test_shared_data_is_passed_through_without_changing_fields(self):
        data = {'assistants': [{'id': 'sa'}], 'rostersBySchedule': {'A': [{'id': 'sa'}]},
                'rosterRevisions': {'A': 'revision'}, 'activeScheduleKey': 'A'}
        with patch('services.student_assistant_service.load_data', return_value=data):
            self.assertEqual(get_student_assistant_data(), data)
        with patch('services.student_assistant_service.save_data') as save:
            save_student_assistant_data(data)
            save.assert_called_once_with(data)

    def test_invalid_shared_data_never_reaches_database(self):
        with patch('services.student_assistant_service.save_data') as save:
            with self.assertRaisesRegex(ValueError, 'Expected a JSON object'):
                save_student_assistant_data(None)
            save.assert_not_called()
        response = create_app().test_client().put('/api/student-assistants/shared', json=[])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json(), {'error': 'Expected a JSON object.'})

    def test_solver_input_and_output_remain_unchanged(self):
        payload = {'mainSchedule': [], 'assistants': [], 'schedulingSettings': {}, 'randomSeed': 42}
        result = {'status': 'FEASIBLE', 'diagnostics': [], 'assignments': []}
        with patch('services.student_assistant_service.solve_student_assistant_schedule', return_value=result) as solve:
            self.assertEqual(create_student_assistant_schedule(payload), result)
            solve.assert_called_once_with(payload)
            response = create_app().test_client().post('/api/student-assistant/solve', json=payload)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.get_json(), result)

    def test_invalid_solver_request_keeps_original_response_contract(self):
        response = create_app().test_client().post('/api/student-assistant/solve', json=[])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json(), {'status': 'INVALID', 'diagnostics': ['Expected a JSON object.']})
