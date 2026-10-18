from flask import Blueprint, jsonify, request

from services.admin_event_service import (
    get_admin_event_sync,
    get_admin_events as load_admin_events,
    remove_admin_event as delete_admin_event,
    update_admin_event as save_admin_event,
)
from database.supabase.admin_event_repository import EventDeletedError

blueprint = Blueprint("admin_events", __name__)


@blueprint.get("/api/admin-events")
def get_admin_events():
    if request.args.get('include_deleted') == 'true':
        return jsonify(get_admin_event_sync())
    return jsonify(load_admin_events())


@blueprint.put("/api/admin-events/<event_id>")
def put_admin_event(event_id: str):
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "Expected a JSON object."}), 400
    try:
        save_admin_event(payload, event_id)
    except EventDeletedError as error:
        return jsonify({'error': str(error)}), 410
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    return "", 204


@blueprint.delete("/api/admin-events/<event_id>")
def remove_admin_event(event_id: str):
    delete_admin_event(event_id)
    return jsonify({'eventStorageVersion': 1})
