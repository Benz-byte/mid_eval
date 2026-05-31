"""
Instructor routes for the Automated Laboratory Scheduling System.

Handles all API endpoints related to instructors, including:
- Instructor CRUD
- Subject assignments with preferred time
- Availability window management
"""

from flask import Blueprint, jsonify, request
import database as db

instructors_bp = Blueprint('instructors', __name__)


# ── Instructor CRUD ───────────────────────────────────────────────────────────

@instructors_bp.route('/', methods=['GET'])
def get_instructors():
    """Return all instructors."""
    return jsonify(db.get_all_instructors())


@instructors_bp.route('/', methods=['POST'])
def create_instructor():
    """
    Create a new instructor.

    Expected JSON body:
        name             (required) - instructor's full name
        preferred_time   (optional) - default preferred start time e.g. '07:00'
        floor_restriction (optional) - 'Ground' to restrict to ground floor rooms only
    """
    data = request.get_json()
    row = db.create_instructor(
        data['name'],
        data.get('preferred_time') or None,
        data.get('floor_restriction') or None,
    )
    return jsonify(row), 201


@instructors_bp.route('/<int:instructor_id>', methods=['DELETE'])
def delete_instructor(instructor_id):
    """Delete an instructor and all their schedule entries."""
    db.delete_instructor(instructor_id)
    return jsonify({'message': 'Instructor deleted'}), 200


# ── Subject assignment routes ─────────────────────────────────────────────────

@instructors_bp.route('/<int:instructor_id>/subjects', methods=['GET'])
def get_instructor_subjects(instructor_id):
    """Return all subjects assigned to a specific instructor."""
    return jsonify(db.get_instructor_subjects(instructor_id))


@instructors_bp.route('/<int:instructor_id>/subjects', methods=['POST'])
def assign_subject_to_instructor(instructor_id):
    """
    Assign a subject to an instructor with an optional preferred start time.

    Expected JSON body:
        subject_id     (required) - ID of the subject to assign
        preferred_time (optional) - preferred start time for this specific assignment e.g. '09:00'

    Returns 409 if the subject is already assigned to this instructor.
    """
    data = request.get_json()
    subject_id = data.get('subject_id')
    if not subject_id:
        return jsonify({'error': 'subject_id is required'}), 400
    try:
        db.assign_subject(instructor_id, subject_id, data.get('preferred_time') or None)
    except Exception:
        return jsonify({'error': 'Subject is already assigned to this instructor'}), 409
    return jsonify({'message': 'Subject assigned'}), 201


@instructors_bp.route('/<int:instructor_id>/subjects/<int:subject_id>', methods=['DELETE'])
def remove_subject_from_instructor(instructor_id, subject_id):
    """Remove a subject assignment from an instructor."""
    db.remove_instructor_subject(instructor_id, subject_id)
    return jsonify({'message': 'Assignment removed'}), 200


# ── Availability routes ───────────────────────────────────────────────────────

@instructors_bp.route('/<int:instructor_id>/availability', methods=['GET'])
def get_instructor_availability(instructor_id):
    """Return all availability windows for a specific instructor."""
    return jsonify(db.get_instructor_availability_for(instructor_id))


@instructors_bp.route('/<int:instructor_id>/availability', methods=['POST'])
def add_instructor_availability(instructor_id):
    """
    Add an availability window for an instructor.

    Expected JSON body:
        start_time (required) - window start e.g. '07:00'
        end_time   (required) - window end e.g. '17:00'
        day        (optional) - specific day e.g. 'Monday', or omit for all days

    If day is omitted or null, the window applies to every day of the week.
    Day-specific windows override whole-week windows for that day in the solver.
    """
    data = request.get_json()
    start_time = data.get('start_time')
    end_time = data.get('end_time')
    if not start_time or not end_time:
        return jsonify({'error': 'start_time and end_time are required'}), 400
    row = db.add_instructor_availability(
        instructor_id,
        data.get('day') or None,
        start_time,
        end_time,
    )
    return jsonify(row), 201


@instructors_bp.route('/<int:instructor_id>/availability/<int:avail_id>', methods=['DELETE'])
def delete_instructor_availability(instructor_id, avail_id):
    """Delete a specific availability window by its ID."""
    db.delete_instructor_availability(avail_id)
    return jsonify({'message': 'Availability deleted'}), 200
