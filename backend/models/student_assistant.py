from typing import Any


def validate_solver_request(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("Expected a JSON object.")
    return value


def validate_shared_assistant_data(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("Expected a JSON object.")
    return value
