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
    stored_result = row.get("solver_result")
    if isinstance(stored_result, dict) and stored_result.get("kind") == "schedule-result-cache":
        solver_result = stored_result.get("activeResult")
        active_schedule_key = stored_result.get("activeScheduleKey") or ""
        results_by_schedule = stored_result.get("resultsBySchedule") or {}
    else:
        solver_result = stored_result
        active_schedule_key = ""
        results_by_schedule = {}
    return {
        "assistants": row.get("assistants") or [],
        "solverResult": solver_result,
        "activeScheduleKey": active_schedule_key,
        "solverResultsBySchedule": results_by_schedule,
        "schedulingSettings": row.get("scheduling_settings") or {
            "minimumGapAfterThreeHourDutyMinutes": 30,
            "maximumDailyDutyMinutes": 240,
            "maximumWeeklyDutyMinutes": 1200,
        },
        "updatedAt": row.get("updated_at"),
    }


def save_data(value: dict[str, Any]) -> None:
    request("POST", "student_assistant_schedules", payload={
        "id": ASSISTANT_SCHEDULE_ID,
        "assistants": value.get("assistants") or [],
        "solver_result": {
            "kind": "schedule-result-cache",
            "activeResult": value.get("solverResult"),
            "activeScheduleKey": value.get("activeScheduleKey") or "",
            "resultsBySchedule": value.get("solverResultsBySchedule") or {},
        },
        "scheduling_settings": value.get("schedulingSettings") or {
            "minimumGapAfterThreeHourDutyMinutes": 30,
            "maximumDailyDutyMinutes": 240,
            "maximumWeeklyDutyMinutes": 1200,
        },
    }, prefer="resolution=merge-duplicates,return=minimal")
