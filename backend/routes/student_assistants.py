from flask import Blueprint, jsonify, request

from services.student_assistant_service import (
    create_student_assistant_schedule,
    get_student_assistant_data,
    save_student_assistant_data,
)

blueprint = Blueprint("student_assistants", __name__)


@blueprint.get("/api/student-assistants/shared")
def get_shared_data():
    return jsonify(get_student_assistant_data())


@blueprint.put("/api/student-assistants/shared")
def put_shared_data():
    payload = request.get_json(silent=True)
    try:
        save_student_assistant_data(payload)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    return jsonify({'rosterStorageVersion': 1, 'resultStorageVersion': 1})


@blueprint.post("/api/student-assistant/solve")
def solve_student_assistants():
    try:
        result = create_student_assistant_schedule(request.get_json(silent=True))
    except ValueError as error:
        return jsonify({"status": "INVALID", "diagnostics": [str(error)]}), 400
    return jsonify(result), 200 if result["status"] != "INVALID" else 400
