from flask import Blueprint, jsonify

subjects_bp = Blueprint('subjects', __name__)


def not_implemented(**_route_values):
    return jsonify({'error': 'Subject logic has been removed'}), 501


subjects_bp.add_url_rule('/', endpoint='collection', view_func=not_implemented, methods=['GET', 'POST'])
subjects_bp.add_url_rule(
    '/<int:subject_id>', endpoint='item', view_func=not_implemented, methods=['DELETE']
)
