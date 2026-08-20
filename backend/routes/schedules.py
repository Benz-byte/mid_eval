from flask import Blueprint, jsonify, request

from services.schedule_parser import parse_schedule_rows
from services.schedule_service import get_shared_schedule, update_shared_schedule

blueprint = Blueprint("schedules", __name__)


@blueprint.post("/api/schedules/parse")
def parse_schedule():
    payload = request.get_json(silent=True)
    try:
        rows = payload.get("rows") if isinstance(payload, dict) else None
        return jsonify(parse_schedule_rows(rows))
    except ValueError as error:
        return jsonify({"error": str(error)}), 400


@blueprint.get("/api/schedules/shared")
def get_shared_schedule():
    return jsonify(get_shared_schedule())


@blueprint.put("/api/schedules/shared")
def put_shared_schedule():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "Expected a JSON object."}), 400
    try:
        update_shared_schedule(payload)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    return "", 204
