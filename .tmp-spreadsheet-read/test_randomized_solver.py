import sys

sys.path.insert(0, "backend")
from solver.student_assistant_solver import solve_student_assistant_schedule

main_schedule = []
for day_index, day in enumerate(("M", "T", "W", "Th", "F")):
    for start in (7 * 60, (9 + day_index) * 60):
        main_schedule.append({
            "id": f"{day}-{start}",
            "dayCode": day,
            "startMinutes": start,
            "endMinutes": start + 4 * 60,
            "courseCode": f"TEST {day} {start}",
            "subject": "Test class",
            "room": "ROOM1",
            "section": "",
        })

assistant = {
    "id": "assistant-1",
    "label": "Assistant 1",
    "schedule": [{
        "id": "personal",
        "dayCode": "S",
        "startMinutes": 8 * 60,
        "endMinutes": 9 * 60,
        "courseCode": "PERSONAL",
        "subject": "Personal class",
        "room": "",
        "section": "",
    }],
}

for seed in (1, 2):
    result = solve_student_assistant_schedule({
        "mainSchedule": main_schedule,
        "assistants": [assistant],
        "randomSeed": seed,
    })
    starts = [(item["day"], item["startMinutes"]) for item in result.get("assignments", [])]
    print(seed, result["status"], starts)

overloaded = solve_student_assistant_schedule({
    "mainSchedule": main_schedule,
    "assistants": [
        {**assistant, "id": f"assistant-{index}", "label": f"Assistant {index}"}
        for index in range(1, 4)
    ],
    "randomSeed": 7,
})
print("overloaded", overloaded["status"], overloaded["assistantTotals"])
