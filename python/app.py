"""
Flask application entry point for the Automated Laboratory Scheduling System.

This module initializes the Flask app, registers all route blueprints,
and starts the development server. In production, Electron spawns this
process automatically when the desktop application is launched.

API endpoints are prefixed with /api/ and organized by resource:
    /api/subjects/      - Subject management
    /api/rooms/         - Room management and room type classifications
    /api/instructors/   - Instructor management, subject assignments, availability
    /api/schedules/     - Schedule retrieval and clearing
    /api/solver/        - Trigger the CP-SAT solver and check its status
    /api/timeslots/     - Read-only timeslot list for the schedule display
    /api/health         - Health check used by the frontend to detect if the API is online
"""

import sys
import os

# Ensure the python directory is in the path so imports work correctly
sys.path.insert(0, os.path.dirname(__file__))

from flask import Flask, jsonify
from flask_cors import CORS
from database import init_db
import database as db
from routes.subjects import subjects_bp
from routes.rooms import rooms_bp
from routes.instructors import instructors_bp
from routes.schedules import schedules_bp
from routes.solver import solver_bp

app = Flask(__name__)
CORS(app)  # Allow cross-origin requests from the Electron renderer process

# Register route blueprints with their URL prefixes
app.register_blueprint(subjects_bp,    url_prefix='/api/subjects')
app.register_blueprint(rooms_bp,       url_prefix='/api/rooms')
app.register_blueprint(instructors_bp, url_prefix='/api/instructors')
app.register_blueprint(schedules_bp,   url_prefix='/api/schedules')
app.register_blueprint(solver_bp,      url_prefix='/api/solver')


@app.route('/api/health')
def health():
    """Health check endpoint. The frontend polls this to show API online/offline status."""
    return jsonify({'status': 'ok', 'message': 'API is running'})


@app.route('/api/timeslots/')
def get_timeslots():
    """Return distinct timeslot start/end pairs used to render the schedule timetable grid."""
    return jsonify(db.get_distinct_timeslots())


if __name__ == '__main__':
    init_db()  # Create tables and seed data on startup
    app.run(port=5000, debug=False, use_reloader=False)
