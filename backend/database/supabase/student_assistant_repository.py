from typing import Any

from .client import request

ASSISTANT_SCHEDULE_ID = "ccs-main"


def load_data() -> dict[str, Any] | None:
    try:
        rows = request("GET", "student_assistant_schedules", query={
            "id": f"eq.{ASSISTANT_SCHEDULE_ID}",
            "select": "assistants,solver_result,scheduling_settings,updated_at",
        })
    except RuntimeError as error:
        if "scheduling_settings" not in str(error):
            raise
        rows = request("GET", "student_assistant_schedules", query={
            "id": f"eq.{ASSISTANT_SCHEDULE_ID}",
            "select": "assistants,solver_result,updated_at",
        })
    if not rows:
        return None
    row = rows[0]
    return {
        "assistants": row.get("assistants") or [],
        "solverResult": row.get("solver_result"),
        "schedulingSettings": row.get("scheduling_settings") or {
            "minimumGapAfterThreeHourDutyMinutes": 30,
        },
        "updatedAt": row.get("updated_at"),
    }


def save_data(value: dict[str, Any]) -> None:
    request("POST", "student_assistant_schedules", payload={
        "id": ASSISTANT_SCHEDULE_ID,
        "assistants": value.get("assistants") or [],
        "solver_result": value.get("solverResult"),
        "scheduling_settings": value.get("schedulingSettings") or {
            "minimumGapAfterThreeHourDutyMinutes": 30,
        },
    }, prefer="resolution=merge-duplicates,return=minimal")
