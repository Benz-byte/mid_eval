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
        "rostersBySchedule": stored_result.get("rostersBySchedule") if isinstance(stored_result, dict) else None,
        "rosterRevisions": stored_result.get("rosterRevisions") if isinstance(stored_result, dict) else None,
        "resultRevisions": stored_result.get("resultRevisions") if isinstance(stored_result, dict) else None,
        "unlinkedAssistants": stored_result.get("unlinkedAssistants") if isinstance(stored_result, dict) else None,
        "schedulingSettings": row.get("scheduling_settings") or {
            "minimumGapAfterThreeHourDutyMinutes": 30,
            "maximumDailyDutyMinutes": 240,
            "maximumWeeklyDutyMinutes": 1200,
        },
        "updatedAt": row.get("updated_at"),
    }


def save_data(value: dict[str, Any]) -> None:
    # Read before writing so a queued empty/local snapshot cannot erase a
    # legacy cloud roster, or CSVs this device has not loaded yet.
    existing = load_data() or {}
    rosters = dict(existing.get('rostersBySchedule') or {})
    revisions = dict(existing.get('rosterRevisions') or {})
    incoming_revisions = value.get('rosterRevisions') or {}
    for key, roster in (value.get('rostersBySchedule') or {}).items():
        if revisions.get(key, '') > incoming_revisions.get(key, ''):
            continue
        rosters[key] = roster
        if incoming_revisions.get(key):
            revisions[key] = incoming_revisions[key]
    unlinked = {}
    for source in (existing, value):
        for assistant in source.get('unlinkedAssistants') or []:
            unlinked[assistant['id']] = assistant
        if (source.get('activeScheduleKey') or '') not in (source.get('rostersBySchedule') or {}):
            for assistant in source.get('assistants') or []:
                unlinked[assistant['id']] = assistant
    for roster in rosters.values():
        for assistant in roster:
            unlinked.pop(assistant['id'], None)
    results = dict(existing.get('solverResultsBySchedule') or {})
    result_revisions = dict(existing.get('resultRevisions') or {})
    incoming_result_revisions = value.get('resultRevisions') or {}
    incoming_results = dict(value.get('solverResultsBySchedule') or {})
    active_key = value.get('activeScheduleKey') or ''
    if active_key:
        incoming_results[active_key] = value.get('solverResult')
    for key in incoming_results.keys() | incoming_result_revisions.keys():
        if key not in (value.get('rostersBySchedule') or {}) or revisions.get(key, '') > incoming_revisions.get(key, ''):
            continue
        revision = incoming_result_revisions.get(key, '')
        # Cached results are not edits. Only a newer per-CSV revision may replace
        # versioned data; legacy clients may save only their unversioned active CSV.
        if revision:
            if revision <= result_revisions.get(key, ''):
                continue
        elif result_revisions.get(key) or key != active_key:
            continue
        if incoming_results.get(key) is None:
            results.pop(key, None)
        else:
            results[key] = incoming_results[key]
        if revision:
            result_revisions[key] = revision
    request("POST", "student_assistant_schedules", payload={
        "id": ASSISTANT_SCHEDULE_ID,
        "assistants": rosters.get(active_key, []),
        "solver_result": {
            "kind": "schedule-result-cache",
            "activeResult": results.get(active_key),
            "activeScheduleKey": active_key,
            "resultsBySchedule": results,
            "rostersBySchedule": rosters,
            "rosterRevisions": revisions,
            "resultRevisions": result_revisions,
            "unlinkedAssistants": list(unlinked.values()),
        },
        "scheduling_settings": value.get("schedulingSettings") or {
            "minimumGapAfterThreeHourDutyMinutes": 30,
            "maximumDailyDutyMinutes": 240,
            "maximumWeeklyDutyMinutes": 1200,
        },
    }, prefer="resolution=merge-duplicates,return=minimal")
