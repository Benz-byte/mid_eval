import unittest
from unittest.mock import patch

from backend.services.schedule_parser import parse_schedule_rows, OFFICIAL_HEADER_LABELS
from backend.models.schedule import validate_shared_schedule
from backend.database.supabase.schedule_repository import load_schedule, save_schedule
from backend.solver.student_assistant_solver import _parse_meetings


HEADER = ["Stub No.", "Course No. & Description", "Time", "Day", "Room", "Teacher", "Credits"]


def offering(time="0700-1000", day="TTh", stub="6", room="MTCL3", course="CCS 1301 - LAB"):
    return [stub, course, time, day, room, "Baylon, G", "3"]


class ScheduleParserTests(unittest.TestCase):
    def parse(self, *rows):
        return parse_schedule_rows([HEADER, *rows], "auto")

    def test_shared_meeting_merges_sections_but_keeps_lecture_and_other_stubs(self):
        result = self.parse(
            ["Section", "BLIS 1-01"], offering(),
            ["Section", "BSIT 1-04"], offering(),
            offering(course="CCS 1301 - LEC"), offering(stub="7"),
        )
        self.assertEqual(len(result["events"]), 3)
        event = result["events"][0]
        self.assertEqual(event["sections"], ["BLIS 1-01", "BSIT 1-04"])
        self.assertEqual(event["courseCode"], "CCS 1301")
        self.assertEqual(event["classType"], "LAB")
        self.assertEqual(event["credits"], 3)
        self.assertEqual((event["startMinutes"], event["endMinutes"]), (420, 600))
        self.assertEqual({meeting.day for meeting in _parse_meetings([event], "test")}, {"T", "Th"})
        reordered = self.parse(["Section", "BSIT 1-04"], offering(), ["Section", "BLIS 1-01"], offering())
        self.assertEqual(event["id"], reordered["events"][0]["id"])

    def test_invalid_time_is_tba_without_creating_a_calendar_meeting(self):
        for time in ("1800-0200", "0000-0000", "1000-1000", "0960-1100", "2401-2500", "TBA", "", "07oops-1000", "0700-0800-0900"):
            with self.subTest(time=time):
                result = self.parse(offering(time=time))
                self.assertEqual(result["events"], [])
                self.assertEqual(len(result["tbaSubjects"]), 1)
                self.assertIn(time or "Time not specified", result["tbaSubjects"][0])

    def test_clock_formats_and_unresolved_days_and_rooms(self):
        for time in ("0700-1000", "700-1000", "07:00–10:00", "7:00 AM-10:00 AM"):
            self.assertEqual(len(self.parse(offering(time=time))["events"]), 1)
        for row in (offering(day="TBA"), offering(day="invalid"), offering(room="TBA"), offering(room="")):
            self.assertEqual(len(self.parse(row)["tbaSubjects"]), 1)

    def test_report_spacer_columns_metadata_and_credits_inside_header_span(self):
        header = [""] * 25
        row = [""] * 25
        for index, label, value in zip((1, 3, 7, 11, 14, 17, 22), HEADER, offering()):
            header[index] = label.lower()
            row[index] = value
        row[23], row[22] = row[22], ""
        result = parse_schedule_rows([
            ["C P U - BLOCKED SECTION Schedule of Classes for 2nd SEMESTER 2026-2027"],
            header, ["", "Section", "", "", "", "BSIT 1-01"], row,
            ["", "Total", "", "", "", "6"],
        ], "auto")
        self.assertEqual(result["metadata"], {"semester": "2nd", "schoolYear": "2026-2027"})
        self.assertEqual(len(result["events"]), 1)
        self.assertEqual(result["events"][0]["credits"], 3)
        self.assertEqual(result["events"][0]["section"], "BSIT 1-01")

    def test_official_format_still_supports_classes_rooms_and_time_only_rows(self):
        header = list(OFFICIAL_HEADER_LABELS)
        row = ["1", "CS 1001", "Introduction", "0700", "0900", "M", "LEC", "MT102", "30", "Cruz", "Ana", ""]
        room_only = [""] * len(header)
        room_only[header.index("Room")] = "Server Room"
        time_only = [""] * len(header)
        time_only[header.index("StartTime")] = "0600"
        rows = [header, row, room_only, time_only]
        self.assertEqual(parse_schedule_rows(rows, "auto"), parse_schedule_rows(rows, "official"))
        result = parse_schedule_rows(rows, "auto")
        self.assertEqual(result["rooms"], ["MT102", "Server Room"])
        self.assertEqual(result["times"], [360])

    def test_unknown_and_empty_files_rejected(self):
        for rows in ([], [["Something", "Else"], ["123", "456"]]):
            with self.assertRaises(ValueError):
                parse_schedule_rows(rows, "auto")

    def test_save_reload_preserves_sections_credits_tba_and_metadata(self):
        parsed = self.parse(["Section", "BSIT 1-01"], offering(), offering(time="1800-0200"))
        payload = validate_shared_schedule({"csvName": "report.xls", "csvEvents": parsed["events"],
            "rooms": parsed["rooms"], "times": [], "fingerprint": "test",
            "tbaSubjects": parsed["tbaSubjects"], "metadata": {"semester": "2nd", "schoolYear": "2026-2027"}})
        with patch("backend.database.supabase.schedule_repository.request") as request:
            save_schedule(payload)
            saved_row = request.call_args.kwargs["payload"]
            request.return_value = [saved_row]
            restored = load_schedule()
        for field in payload:
            self.assertEqual(restored[field], payload[field])


if __name__ == "__main__":
    unittest.main()
