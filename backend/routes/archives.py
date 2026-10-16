from flask import Blueprint, jsonify, request

from services.archive_service import get_archives, remove_archive, save_archive

blueprint = Blueprint('archives', __name__)


@blueprint.get('/api/archives')
def list_archives():
    return jsonify(get_archives())


@blueprint.put('/api/archives/<archive_id>')
def put_archive(archive_id: str):
    try:
        save_archive(request.get_json(silent=True), archive_id)
    except ValueError as error:
        return jsonify({'error': str(error)}), 400
    return '', 204


@blueprint.delete('/api/archives/<archive_id>')
def delete_archive(archive_id: str):
    try:
        remove_archive(archive_id)
    except ValueError as error:
        return jsonify({'error': str(error)}), 400
    return '', 204
