"""Flask service entry point for the upcoming schedule solver."""

from flask import Flask, jsonify
from flask import request
from flask_cors import CORS
from solver.student_assistant_solver import solve_student_assistant_schedule


def create_app() -> Flask:
    app = Flask(__name__)
    CORS(app)

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok"})

    @app.post("/api/student-assistant/solve")
    def solve_student_assistants():
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict):
            return jsonify({"status": "INVALID", "diagnostics": ["Expected a JSON object."]}), 400

        result = solve_student_assistant_schedule(payload)
        status_code = 200 if result["status"] not in {"INVALID"} else 400
        return jsonify(result), status_code

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False, use_reloader=False)
