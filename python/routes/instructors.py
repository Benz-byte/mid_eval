from flask import Blueprint, jsonify

instructors_bp = Blueprint('instructors', __name__)


def not_implemented(**_route_values):
    return jsonify({'error': 'Instructor logic has been removed'}), 501


instructors_bp.add_url_rule('/', endpoint='collection', view_func=not_implemented, methods=['GET', 'POST'])
instructors_bp.add_url_rule(
    '/<int:instructor_id>', endpoint='item', view_func=not_implemented, methods=['DELETE']
)
instructors_bp.add_url_rule(
    '/<int:instructor_id>/subjects',
    endpoint='subjects',
    view_func=not_implemented,
    methods=['GET', 'POST'],
)
instructors_bp.add_url_rule(
    '/<int:instructor_id>/subjects/<int:subject_id>',
    endpoint='subject_item',
    view_func=not_implemented,
    methods=['DELETE'],
)
instructors_bp.add_url_rule(
    '/<int:instructor_id>/availability',
    endpoint='availability',
    view_func=not_implemented,
    methods=['GET', 'POST'],
)
instructors_bp.add_url_rule(
    '/<int:instructor_id>/availability/<int:avail_id>',
    endpoint='availability_item',
    view_func=not_implemented,
    methods=['DELETE'],
)
