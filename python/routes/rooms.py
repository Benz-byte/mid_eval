"""
Room routes for the Automated Laboratory Scheduling System.

Handles all API endpoints related to rooms and room type classifications.
Room types are shared between rooms and subjects — the solver matches
subjects to rooms by comparing their type strings directly.
"""

from flask import Blueprint, jsonify, request
import database as db

rooms_bp = Blueprint('rooms', __name__)


# ── Room CRUD ─────────────────────────────────────────────────────────────────

@rooms_bp.route('/', methods=['GET'])
def get_rooms():
    """Return all rooms ordered by name."""
    return jsonify(db.get_all_rooms())


@rooms_bp.route('/', methods=['POST'])
def create_room():
    """
    Create a new room.

    Expected JSON body:
        name     (required) - room identifier e.g. 'R101'
        capacity (required) - maximum number of students
        type     (required) - room type matching a room_types entry e.g. 'lab'
        floor    (optional) - 'Ground' or '2nd Floor', defaults to 'Ground'
    """
    data = request.get_json()
    row = db.create_room(data['name'], data['capacity'], data.get('type', 'lecture'), data.get('floor', 'Ground'))
    return jsonify(row), 201


@rooms_bp.route('/<int:room_id>', methods=['DELETE'])
def delete_room(room_id):
    """Delete a room and all its schedule entries."""
    db.delete_room(room_id)
    return jsonify({'message': 'Room deleted'}), 200


# ── Room type routes ──────────────────────────────────────────────────────────

@rooms_bp.route('/types/', methods=['GET'])
def get_room_types():
    """Return all room type classifications ordered by name."""
    return jsonify(db.get_all_room_types())


@rooms_bp.route('/types/', methods=['POST'])
def add_room_type():
    """
    Add a new room type classification.

    Expected JSON body:
        name (required) - type name e.g. 'studio'

    Returns 409 if the type already exists.
    """
    data = request.get_json()
    name = data.get('name', '').strip()
    if not name:
        return jsonify({'error': 'name is required'}), 400
    try:
        row = db.add_room_type(name)
        return jsonify(row), 201
    except Exception:
        return jsonify({'error': f"Room type '{name}' already exists"}), 409


@rooms_bp.route('/types/<int:type_id>', methods=['DELETE'])
def delete_room_type(type_id):
    """
    Delete a room type classification.

    Returns 409 if the type is still assigned to any room or subject.
    The type must be removed from all rooms and subjects first.
    """
    try:
        db.delete_room_type(type_id)
        return jsonify({'message': 'Room type deleted'}), 200
    except ValueError as e:
        return jsonify({'error': str(e)}), 409
