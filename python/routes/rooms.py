from flask import Blueprint, jsonify

rooms_bp = Blueprint('rooms', __name__)


def not_implemented(**_route_values):
    return jsonify({'error': 'Room logic has been removed'}), 501


rooms_bp.add_url_rule('/', endpoint='collection', view_func=not_implemented, methods=['GET', 'POST'])
rooms_bp.add_url_rule('/<int:room_id>', endpoint='item', view_func=not_implemented, methods=['DELETE'])
rooms_bp.add_url_rule('/types/', endpoint='types', view_func=not_implemented, methods=['GET', 'POST'])
rooms_bp.add_url_rule(
    '/types/<int:type_id>', endpoint='type_item', view_func=not_implemented, methods=['DELETE']
)
