"""
Subject routes for the Automated Laboratory Scheduling System.

Handles CRUD operations for subjects. Each subject has a room type
that must match a room type in the rooms table for the solver to
assign it a room during schedule generation.
"""

from flask import Blueprint, jsonify, request
import database as db

subjects_bp = Blueprint('subjects', __name__)


@subjects_bp.route('/', methods=['GET'])
def get_subjects():
    """Return all subjects ordered by code."""
    return jsonify(db.get_all_subjects())


@subjects_bp.route('/', methods=['POST'])
def create_subject():
    """
    Create a new subject.

    Expected JSON body:
        code           (required) - subject code e.g. 'CS101'
        name           (required) - full subject name
        hours_per_week (required) - total contact hours per week
        type           (required) - room type required e.g. 'lab', 'lecture'
        students       (optional) - number of enrolled students, defaults to 30
        preferred_time (optional) - preferred start time, currently unused by solver
    """
    data = request.get_json()
    row = db.create_subject(
        data['code'],
        data['name'],
        data['hours_per_week'],
        data.get('type', 'lecture'),
        data.get('preferred_time') or None,
        data.get('students', 30),
    )
    return jsonify(row), 201


@subjects_bp.route('/<int:subject_id>', methods=['DELETE'])
def delete_subject(subject_id):
    """Delete a subject and all its schedule entries."""
    db.delete_subject(subject_id)
    return jsonify({'message': 'Subject deleted'}), 200
