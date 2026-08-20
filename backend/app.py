"""Flask service entry point for the upcoming schedule solver."""

from flask import Flask, jsonify
from flask_cors import CORS

from routes.admin_events import blueprint as admin_events_blueprint
from routes.health import blueprint as health_blueprint
from routes.schedules import blueprint as schedules_blueprint
from routes.student_assistants import blueprint as student_assistants_blueprint


def create_app() -> Flask:
    app = Flask(__name__)
    CORS(app)

    app.register_blueprint(health_blueprint)
    app.register_blueprint(schedules_blueprint)
    app.register_blueprint(admin_events_blueprint)
    app.register_blueprint(student_assistants_blueprint)

    @app.errorhandler(RuntimeError)
    def handle_runtime_error(error: RuntimeError):
        return jsonify({"error": str(error)}), 503

    return app


app = create_app()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False, use_reloader=False)
