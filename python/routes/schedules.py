"""
Schedule routes for the Automated Laboratory Scheduling System.

Provides read and clear operations for the generated schedule.
Schedule entries are created by the solver, not directly by the user.
"""

from flask import Blueprint, jsonify
import database as db

schedules_bp = Blueprint('schedules', __name__)


@schedules_bp.route('/', methods=['GET'])
def get_schedules():
    """
    Return all schedule entries with joined subject, room, instructor, and timeslot data.
    Used by the frontend to render the timetable grid.
    """
    return jsonify(db.get_all_schedules())


@schedules_bp.route('/', methods=['DELETE'])
def clear_schedules():
    """Delete all schedule entries to allow a fresh solver run."""
    db.clear_schedules()
    return jsonify({'message': 'All schedules cleared'}), 200
