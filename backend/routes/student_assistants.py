from flask import Blueprint, jsonify, request

from database.supabase.student_assistant_repository import load_data, save_data
from models.student_assistant import validate_solver_request
from solver.student_assistant_solver import solve_student_assistant_schedule

blueprint = Blueprint("student_assistants", __name__)


@blueprint.get("/api/student-assistants/shared")
def get_shared_data():
    return jsonify(load_data())


@blueprint.put("/api/student-assistants/shared")
def put_shared_data():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "Expected a JSON object."}), 400
    save_data(payload)
    return "", 204


@blueprint.post("/api/student-assistant/solve")
def solve_student_assistants():
    try:
        payload = validate_solver_request(request.get_json(silent=True))
    except ValueError as error:
        return jsonify({"status": "INVALID", "diagnostics": [str(error)]}), 400
    result = solve_student_assistant_schedule(payload)
    return jsonify(result), 200 if result["status"] != "INVALID" else 400
