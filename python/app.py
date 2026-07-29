"""
Flask application entry point for the Automated Laboratory Scheduling System.

This module initializes the Flask app, registers all route blueprints,
and starts the development server. In production, Electron spawns this
process automatically when the desktop application is launched.

API endpoints are prefixed with /api/ and organized by resource:
    /api/subjects/      - Subject management
    /api/rooms/         - Room management and room type classifications
    /api/instructors/   - Instructor management, subject assignments, availability
    /api/health         - Health check used by the frontend to detect if the API is online
"""

import sys
import os

# Ensure the python directory is in the path so imports work correctly
sys.path.insert(0, os.path.dirname(__file__))

from flask import Flask, jsonify
from flask_cors import CORS
from routes.subjects import subjects_bp
from routes.rooms import rooms_bp
from routes.instructors import instructors_bp

app = Flask(__name__)
CORS(app)  # Allow cross-origin requests from the Electron renderer process

# Register route blueprints with their URL prefixes
app.register_blueprint(subjects_bp,    url_prefix='/api/subjects')
app.register_blueprint(rooms_bp,       url_prefix='/api/rooms')
app.register_blueprint(instructors_bp, url_prefix='/api/instructors')


@app.route('/api/health')
def health():
    return jsonify({'error': 'Application logic has been removed'}), 501


if __name__ == '__main__':
    app.run(port=5000, debug=False, use_reloader=False)
