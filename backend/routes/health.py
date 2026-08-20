from flask import Blueprint, jsonify

from database.supabase.client import is_configured

blueprint = Blueprint("health", __name__)


@blueprint.get("/api/health")
def health():
    return jsonify({"status": "ok", "cloudConfigured": is_configured()})
