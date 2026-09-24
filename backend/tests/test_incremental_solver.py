import unittest

from backend.solver.student_assistant_solver import solve_student_assistant_schedule


SETTINGS = {
    "minimumGapAfterThreeHourDutyMinutes": 0,
    "maximumDailyDutyMinutes": 60,
    "maximumWeeklyDutyMinutes": 300,
}


def assistant(assistant_id):
    return {
        "id": assistant_id,
        "label": assistant_id,
        "schedule": [{
            "id": f"{assistant_id}-class",
            "dayCode": "M",
            "startMinutes": 600,
            "endMinutes": 660,
        }],
    }


class IncrementalSolverTests(unittest.TestCase):
    def setUp(self):
        self.events = [
            {"id": "duty-1", "dayCode": "M", "startMinutes": 420, "endMinutes": 480,
             "courseCode": "ONE", "room": "A"},
            {"id": "duty-2", "dayCode": "M", "startMinutes": 480, "endMinutes": 540,
             "courseCode": "TWO", "room": "B"},
        ]
        self.original_payload = {
            "mainSchedule": self.events,
            "assistants": [assistant("old")],
            "schedulingSettings": SETTINGS,
            "randomSeed": 1,
        }
        self.original = solve_student_assistant_schedule(self.original_payload)
        self.assertIn(self.original["status"], ("OPTIMAL", "FEASIBLE"))
        self.assertEqual(len(self.original["assignments"]), 1)

    def incremental(self, settings=SETTINGS, result=None):
        return solve_student_assistant_schedule({
            **self.original_payload,
            "assistants": [assistant("old"), assistant("new")],
            "schedulingSettings": settings,
            "incremental": {
                "existingResult": result or self.original,
                "newAssistantIds": ["new"],
            },
        })

    def test_new_assistant_fills_open_duty_without_moving_existing_one(self):
        updated = self.incremental()
        self.assertIn(updated["status"], ("OPTIMAL", "FEASIBLE"))
        self.assertEqual(len(updated["assignments"]), 2)
        self.assertEqual(
            [item for item in updated["assignments"] if item["assistantId"] == "old"],
            self.original["assignments"],
        )
        self.assertEqual(
            {item["classId"] for item in updated["assignments"]},
            {"duty-1", "duty-2"},
        )

    def test_no_open_duty_keeps_current_assignments(self):
        filled = self.incremental()
        again = solve_student_assistant_schedule({
            **self.original_payload,
            "assistants": [assistant("old"), assistant("new"), assistant("third")],
            "incremental": {"existingResult": filled, "newAssistantIds": ["third"]},
        })
        self.assertEqual(again["assignments"], filled["assignments"])
        self.assertEqual(len(again["assistantTotals"]), 3)

    def test_partial_opening_keeps_existing_portion(self):
        assigned = self.original["assignments"][0]
        extended_events = [{**event, "endMinutes": event["endMinutes"] + 60}
                           for event in self.events if event["id"] == assigned["classId"]]
        updated = solve_student_assistant_schedule({
            **self.original_payload,
            "mainSchedule": extended_events,
            "assistants": [assistant("old"), assistant("new")],
            "incremental": {
                "existingResult": self.original,
                "newAssistantIds": ["new"],
            },
        })
        self.assertIn(updated["status"], ("OPTIMAL", "FEASIBLE"))
        self.assertIn(assigned, updated["assignments"])
        self.assertTrue(any(
            item["assistantId"] == "new"
            and item["classId"] == assigned["classId"]
            and item["startMinutes"] == assigned["endMinutes"]
            for item in updated["assignments"]
        ))

    def test_changed_settings_do_not_reschedule_existing_duties(self):
        changed = self.incremental({**SETTINGS, "maximumDailyDutyMinutes": 120})
        self.assertEqual(changed["status"], "INVALID")
        self.assertIn("settings differ", changed["diagnostics"][0])

    def test_manual_assignment_to_new_assistant_is_saved_and_counted(self):
        open_event = next(event for event in self.events
                          if event["id"] != self.original["assignments"][0]["classId"])
        manual = {
            "assistantId": "new",
            "assistantLabel": "new",
            "classId": open_event["id"],
            "day": "M",
            "startMinutes": open_event["startMinutes"],
            "endMinutes": open_event["endMinutes"],
            "courseCode": open_event["courseCode"],
            "room": open_event["room"],
        }
        saved = {
            **self.original,
            "assignments": [*self.original["assignments"], manual],
            "assistantTotals": [*self.original["assistantTotals"], {
                "assistantId": "new", "assistantLabel": "new", "hours": 1,
            }],
            "optimizedAssistantIds": ["old"],
        }
        updated = self.incremental(result=saved)
        self.assertIn(updated["status"], ("OPTIMAL", "FEASIBLE"))
        self.assertEqual(updated["assignments"], sorted(saved["assignments"],
            key=lambda item: (item["startMinutes"], item["room"], item["assistantLabel"])))
        self.assertEqual(updated["optimizedAssistantIds"], ["old", "new"])

        third_event = {"id": "duty-3", "dayCode": "M", "startMinutes": 540,
                       "endMinutes": 600, "courseCode": "THREE", "room": "C"}
        with_open_duty = solve_student_assistant_schedule({
            **self.original_payload,
            "mainSchedule": [*self.events, third_event],
            "assistants": [assistant("old"), assistant("new")],
            "incremental": {"existingResult": saved, "newAssistantIds": ["new"]},
        })
        self.assertIn(with_open_duty["status"], ("OPTIMAL", "FEASIBLE"))
        self.assertEqual(len(with_open_duty["assignments"]), 2)

    def test_manual_only_schedule_is_used_as_incremental_start(self):
        first = self.events[0]
        manual = {
            "assistantId": "old", "assistantLabel": "old", "classId": first["id"],
            "day": "M", "startMinutes": first["startMinutes"],
            "endMinutes": first["endMinutes"], "courseCode": first["courseCode"],
            "room": first["room"],
        }
        saved = {
            "status": "FEASIBLE",
            "assignments": [manual],
            "assistantTotals": [
                {"assistantId": "old", "assistantLabel": "old", "hours": 1},
                {"assistantId": "new", "assistantLabel": "new", "hours": 0},
            ],
            "optimizedAssistantIds": [],
            "appliedSettings": SETTINGS,
        }
        updated = solve_student_assistant_schedule({
            **self.original_payload,
            "assistants": [assistant("old"), assistant("new")],
            "incremental": {
                "existingResult": saved,
                "newAssistantIds": ["old", "new"],
            },
        })
        self.assertIn(updated["status"], ("OPTIMAL", "FEASIBLE"))
        self.assertIn(manual, updated["assignments"])
        self.assertEqual(
            [item["assistantId"] for item in updated["assignments"]
             if item["classId"] == "duty-2"],
            ["new"],
        )


if __name__ == "__main__":
    unittest.main()
