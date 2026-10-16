from typing import Any

from database.supabase.student_assistant_repository import load_data, save_data
from models.student_assistant import validate_shared_assistant_data, validate_solver_request
from solver.student_assistant_solver import solve_student_assistant_schedule


def get_student_assistant_data() -> dict[str, Any] | None:
    return load_data()


def save_student_assistant_data(value: Any) -> None:
    save_data(validate_shared_assistant_data(value))


def create_student_assistant_schedule(value: Any) -> dict[str, Any]:
    return solve_student_assistant_schedule(validate_solver_request(value))
