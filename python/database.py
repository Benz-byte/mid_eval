"""
Database module for the Automated Laboratory Scheduling System.

Handles all SQLite database operations including schema creation,
migrations for existing databases, and CRUD functions for all entities.

The database is stored as a local file (scheduler.db) in the same
directory as this module. SQLite was chosen because the system runs
as a standalone desktop application with no need for a server.

Tables:
    subjects             - Subjects to be scheduled
    rooms                - Available rooms with type and floor
    room_types           - Dynamic list of room type classifications
    instructors          - Instructors with preferences and restrictions
    instructor_subjects  - Many-to-many: instructors assigned to subjects
    instructor_availability - Time windows when instructors are available
    timeslots            - 30-minute slots from 07:00-21:00, Mon-Fri
    schedules            - Generated schedule output
"""

import sqlite3
import os

# Path to the SQLite database file, stored alongside this module
DB_PATH = os.path.join(os.path.dirname(__file__), 'scheduler.db')


def get_db() -> sqlite3.Connection:
    """Open and return a database connection with foreign keys enabled."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row  # Rows accessible as dicts
    conn.execute('PRAGMA foreign_keys = ON')
    return conn


def init_db() -> None:
    """
    Initialize the database schema and seed required data.

    Called once at application startup. All CREATE TABLE statements use
    IF NOT EXISTS so they are safe to run on an existing database.
    Migration blocks below handle adding columns to existing tables
    that were created before those columns existed.
    """
    conn = get_db()
    cursor = conn.cursor()

    cursor.executescript('''
        CREATE TABLE IF NOT EXISTS subjects (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            code            TEXT    NOT NULL UNIQUE,
            name            TEXT    NOT NULL,
            hours_per_week  INTEGER NOT NULL DEFAULT 3,
            type            TEXT    NOT NULL DEFAULT 'lecture',
            preferred_time  TEXT,
            students        INTEGER NOT NULL DEFAULT 30
        );

        CREATE TABLE IF NOT EXISTS rooms (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            name     TEXT    NOT NULL UNIQUE,
            capacity INTEGER NOT NULL DEFAULT 40,
            type     TEXT    NOT NULL DEFAULT 'lecture',
            floor    TEXT    NOT NULL DEFAULT 'Ground'
        );

        CREATE TABLE IF NOT EXISTS instructors (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            name              TEXT NOT NULL,
            preferred_time    TEXT,
            floor_restriction TEXT
        );

        CREATE TABLE IF NOT EXISTS timeslots (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            day        TEXT    NOT NULL,
            start_time TEXT    NOT NULL,
            end_time   TEXT    NOT NULL,
            duration   INTEGER NOT NULL DEFAULT 30
        );

        CREATE TABLE IF NOT EXISTS instructor_subjects (
            instructor_id  INTEGER NOT NULL,
            subject_id     INTEGER NOT NULL,
            preferred_time TEXT,
            PRIMARY KEY (instructor_id, subject_id),
            FOREIGN KEY (instructor_id) REFERENCES instructors(id) ON DELETE CASCADE,
            FOREIGN KEY (subject_id)    REFERENCES subjects(id)    ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS schedules (
            id            INTEGER   PRIMARY KEY AUTOINCREMENT,
            subject_id    INTEGER   NOT NULL,
            room_id       INTEGER   NOT NULL,
            instructor_id INTEGER   NOT NULL,
            timeslot_id   INTEGER   NOT NULL,
            created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (subject_id)    REFERENCES subjects(id),
            FOREIGN KEY (room_id)       REFERENCES rooms(id),
            FOREIGN KEY (instructor_id) REFERENCES instructors(id),
            FOREIGN KEY (timeslot_id)   REFERENCES timeslots(id)
        );

        CREATE TABLE IF NOT EXISTS instructor_availability (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            instructor_id  INTEGER NOT NULL,
            day            TEXT,
            start_time     TEXT    NOT NULL,
            end_time       TEXT    NOT NULL,
            FOREIGN KEY (instructor_id) REFERENCES instructors(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS room_types (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT    NOT NULL UNIQUE
        );
    ''')

    # Migration: remove legacy units column from subjects if present.
    subj_cols = [row[1] for row in cursor.execute('PRAGMA table_info(subjects)').fetchall()]
    if 'units' in subj_cols:
        cursor.executescript('''
            PRAGMA foreign_keys = OFF;
            DROP TABLE IF EXISTS subjects_new;
            CREATE TABLE subjects_new (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                code            TEXT    NOT NULL UNIQUE,
                name            TEXT    NOT NULL,
                hours_per_week  INTEGER NOT NULL DEFAULT 3,
                type            TEXT    NOT NULL DEFAULT 'lecture',
                preferred_time  TEXT
            );
            INSERT INTO subjects_new (id, code, name, hours_per_week, type)
                SELECT id, code, name, hours_per_week, type FROM subjects;
            DROP TABLE subjects;
            ALTER TABLE subjects_new RENAME TO subjects;
            PRAGMA foreign_keys = ON;
        ''')

    # Migration: remove legacy section_id column from schedules if present.
    sched_cols = [row[1] for row in cursor.execute('PRAGMA table_info(schedules)').fetchall()]
    if 'section_id' in sched_cols:
        cursor.executescript('''
            DROP TABLE IF EXISTS schedules;
            CREATE TABLE schedules (
                id            INTEGER   PRIMARY KEY AUTOINCREMENT,
                subject_id    INTEGER   NOT NULL,
                room_id       INTEGER   NOT NULL,
                instructor_id INTEGER   NOT NULL,
                timeslot_id   INTEGER   NOT NULL,
                created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (subject_id)    REFERENCES subjects(id),
                FOREIGN KEY (room_id)       REFERENCES rooms(id),
                FOREIGN KEY (instructor_id) REFERENCES instructors(id),
                FOREIGN KEY (timeslot_id)   REFERENCES timeslots(id)
            );
        ''')

    # Migration: add columns that were introduced after initial release.
    instr_cols = [row[1] for row in cursor.execute('PRAGMA table_info(instructors)').fetchall()]
    if 'preferred_time' not in instr_cols:
        cursor.execute('ALTER TABLE instructors ADD COLUMN preferred_time TEXT')

    subj_cols = [row[1] for row in cursor.execute('PRAGMA table_info(subjects)').fetchall()]
    if 'preferred_time' not in subj_cols:
        cursor.execute('ALTER TABLE subjects ADD COLUMN preferred_time TEXT')
    if 'students' not in subj_cols:
        cursor.execute('ALTER TABLE subjects ADD COLUMN students INTEGER NOT NULL DEFAULT 30')

    is_cols = [row[1] for row in cursor.execute('PRAGMA table_info(instructor_subjects)').fetchall()]
    if 'preferred_time' not in is_cols:
        cursor.execute('ALTER TABLE instructor_subjects ADD COLUMN preferred_time TEXT')

    room_cols = [row[1] for row in cursor.execute('PRAGMA table_info(rooms)').fetchall()]
    if 'floor' not in room_cols:
        cursor.execute("ALTER TABLE rooms ADD COLUMN floor TEXT NOT NULL DEFAULT 'Ground'")

    if 'floor_restriction' not in instr_cols:
        cursor.execute('ALTER TABLE instructors ADD COLUMN floor_restriction TEXT')

    # Seed default room types on first run.
    if cursor.execute('SELECT COUNT(*) FROM room_types').fetchone()[0] == 0:
        for name in ('lecture', 'lab', 'cisco', 'drawing'):
            cursor.execute('INSERT INTO room_types (name) VALUES (?)', (name,))

    # Seed 30-minute timeslots (07:00-21:00, Mon-Fri).
    # If old 60-minute slots exist, wipe and re-seed with 30-minute slots.
    def seed_30min_timeslots():
        days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
        for day in days:
            for start_min in range(7 * 60, 21 * 60, 30):
                h1, m1 = start_min // 60, start_min % 60
                h2, m2 = (start_min + 30) // 60, (start_min + 30) % 60
                cursor.execute(
                    'INSERT INTO timeslots (day, start_time, end_time, duration) VALUES (?, ?, ?, ?)',
                    (day, f'{h1:02d}:{m1:02d}', f'{h2:02d}:{m2:02d}', 30),
                )

    cursor.execute('SELECT COUNT(*) FROM timeslots')
    timeslot_count = cursor.fetchone()[0]

    if timeslot_count == 0:
        seed_30min_timeslots()
    else:
        first_duration = cursor.execute('SELECT duration FROM timeslots LIMIT 1').fetchone()[0]
        if first_duration != 30:
            # Old 60-minute slots detected: clear and re-seed
            cursor.execute('DELETE FROM schedules')
            cursor.execute('DELETE FROM timeslots')
            seed_30min_timeslots()

    conn.commit()
    conn.close()


# ── Subjects ──────────────────────────────────────────────────────────────────

def get_all_subjects():
    """Return all subjects ordered by code."""
    conn = get_db()
    rows = conn.execute('SELECT * FROM subjects ORDER BY code').fetchall()
    conn.close()
    return [dict(row) for row in rows]


def create_subject(code, name, hours_per_week, type, preferred_time=None, students=30):
    """Insert a new subject and return the created row."""
    conn = get_db()
    cursor = conn.execute(
        'INSERT INTO subjects (code, name, hours_per_week, type, preferred_time, students) VALUES (?, ?, ?, ?, ?, ?)',
        (code, name, hours_per_week, type, preferred_time or None, students),
    )
    conn.commit()
    row = conn.execute('SELECT * FROM subjects WHERE id = ?', (cursor.lastrowid,)).fetchone()
    conn.close()
    return dict(row)


def delete_subject(subject_id):
    """Delete a subject and remove any related schedule entries."""
    conn = get_db()
    conn.execute('DELETE FROM schedules WHERE subject_id = ?', (subject_id,))
    conn.execute('DELETE FROM subjects WHERE id = ?', (subject_id,))
    conn.commit()
    conn.close()


# ── Rooms ─────────────────────────────────────────────────────────────────────

def get_all_rooms():
    """Return all rooms ordered by name."""
    conn = get_db()
    rows = conn.execute('SELECT * FROM rooms ORDER BY name').fetchall()
    conn.close()
    return [dict(row) for row in rows]


def create_room(name, capacity, type, floor='Ground'):
    """Insert a new room and return the created row."""
    conn = get_db()
    cursor = conn.execute(
        'INSERT INTO rooms (name, capacity, type, floor) VALUES (?, ?, ?, ?)',
        (name, capacity, type, floor),
    )
    conn.commit()
    row = conn.execute('SELECT * FROM rooms WHERE id = ?', (cursor.lastrowid,)).fetchone()
    conn.close()
    return dict(row)


def delete_room(room_id):
    """Delete a room and remove any related schedule entries."""
    conn = get_db()
    conn.execute('DELETE FROM schedules WHERE room_id = ?', (room_id,))
    conn.execute('DELETE FROM rooms WHERE id = ?', (room_id,))
    conn.commit()
    conn.close()


# ── Instructors ───────────────────────────────────────────────────────────────

def get_all_instructors():
    """Return all instructors ordered by name."""
    conn = get_db()
    rows = conn.execute('SELECT * FROM instructors ORDER BY name').fetchall()
    conn.close()
    return [dict(row) for row in rows]


def create_instructor(name, preferred_time=None, floor_restriction=None):
    """
    Insert a new instructor and return the created row.

    floor_restriction: if set to 'Ground', the solver will only assign
    this instructor to rooms on the ground floor.
    """
    conn = get_db()
    cursor = conn.execute(
        'INSERT INTO instructors (name, preferred_time, floor_restriction) VALUES (?, ?, ?)',
        (name, preferred_time or None, floor_restriction or None),
    )
    conn.commit()
    row = conn.execute('SELECT * FROM instructors WHERE id = ?', (cursor.lastrowid,)).fetchone()
    conn.close()
    return dict(row)


def delete_instructor(instructor_id):
    """Delete an instructor and remove any related schedule entries."""
    conn = get_db()
    conn.execute('DELETE FROM schedules WHERE instructor_id = ?', (instructor_id,))
    conn.execute('DELETE FROM instructors WHERE id = ?', (instructor_id,))
    conn.commit()
    conn.close()


def get_instructor_subjects(instructor_id):
    """Return all subjects assigned to a given instructor."""
    conn = get_db()
    rows = conn.execute(
        '''SELECT sub.*
           FROM subjects sub
           JOIN instructor_subjects ins ON ins.subject_id = sub.id
           WHERE ins.instructor_id = ?
           ORDER BY sub.code''',
        (instructor_id,),
    ).fetchall()
    conn.close()
    return [dict(row) for row in rows]


def assign_subject(instructor_id, subject_id, preferred_time=None):
    """
    Link a subject to an instructor with an optional preferred start time.

    preferred_time is stored on the assignment record and used by the solver
    to prefer blocks starting at that time for this specific pair.
    Raises an exception if the assignment already exists.
    """
    conn = get_db()
    try:
        conn.execute(
            'INSERT INTO instructor_subjects (instructor_id, subject_id, preferred_time) VALUES (?, ?, ?)',
            (instructor_id, subject_id, preferred_time or None),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        conn.close()
        raise
    conn.close()


def remove_instructor_subject(instructor_id, subject_id):
    """Remove a subject assignment from an instructor."""
    conn = get_db()
    conn.execute(
        'DELETE FROM instructor_subjects WHERE instructor_id = ? AND subject_id = ?',
        (instructor_id, subject_id),
    )
    conn.commit()
    conn.close()


# ── Schedules ─────────────────────────────────────────────────────────────────

def get_all_schedules():
    """
    Return all schedule entries with joined subject, room, instructor, and timeslot data.
    Results are ordered by room name, day, and start time for display in the timetable.
    """
    conn = get_db()
    rows = conn.execute('''
        SELECT
            s.id,
            sub.code     AS subject_code,
            sub.name     AS subject_name,
            r.name       AS room_name,
            i.name       AS instructor_name,
            t.day,
            t.start_time,
            t.end_time
        FROM schedules s
        JOIN subjects    sub ON sub.id = s.subject_id
        JOIN rooms       r   ON r.id   = s.room_id
        JOIN instructors i   ON i.id   = s.instructor_id
        JOIN timeslots   t   ON t.id   = s.timeslot_id
        ORDER BY r.name, t.day, t.start_time
    ''').fetchall()
    conn.close()
    return [dict(row) for row in rows]


def clear_schedules():
    """Delete all schedule entries."""
    conn = get_db()
    conn.execute('DELETE FROM schedules')
    conn.commit()
    conn.close()


def save_schedule(assignments):
    """
    Replace the current schedule with a new set of assignments.

    Clears all existing schedule entries before inserting the new ones
    to ensure the stored schedule always reflects the latest solver run.
    """
    conn = get_db()
    conn.execute('DELETE FROM schedules')
    for a in assignments:
        conn.execute(
            'INSERT INTO schedules (subject_id, room_id, instructor_id, timeslot_id) VALUES (?, ?, ?, ?)',
            (a['subject_id'], a['room_id'], a['instructor_id'], a['timeslot_id']),
        )
    conn.commit()
    conn.close()


# ── Timeslots ─────────────────────────────────────────────────────────────────

def get_all_timeslots():
    """Return all timeslots (used by the solver to build candidate blocks)."""
    conn = get_db()
    rows = conn.execute('SELECT * FROM timeslots').fetchall()
    conn.close()
    return [dict(row) for row in rows]


def get_distinct_timeslots():
    """Return distinct start/end time pairs (used by the schedule display)."""
    conn = get_db()
    rows = conn.execute(
        'SELECT DISTINCT start_time, end_time, duration FROM timeslots ORDER BY start_time'
    ).fetchall()
    conn.close()
    return [dict(row) for row in rows]


# ── Solver helpers ────────────────────────────────────────────────────────────

def get_all_instructor_subjects():
    """Return all instructor-subject assignments (used as solver input)."""
    conn = get_db()
    rows = conn.execute('SELECT * FROM instructor_subjects').fetchall()
    conn.close()
    return [dict(row) for row in rows]


def get_instructor_availability():
    """
    Return all instructor availability records for the solver.
    Returns None if no availability windows have been set,
    which tells the solver to allow all timeslots for all instructors.
    """
    conn = get_db()
    rows = conn.execute('SELECT * FROM instructor_availability').fetchall()
    conn.close()
    result = [dict(row) for row in rows]
    return result if result else None


def get_instructor_availability_for(instructor_id):
    """Return availability windows for a specific instructor, ordered by day and start time."""
    conn = get_db()
    rows = conn.execute(
        'SELECT * FROM instructor_availability WHERE instructor_id = ? ORDER BY day, start_time',
        (instructor_id,),
    ).fetchall()
    conn.close()
    return [dict(row) for row in rows]


def add_instructor_availability(instructor_id, day, start_time, end_time):
    """
    Add an availability window for an instructor.

    day=None means the window applies to all days (whole week).
    day='Monday' etc. means the window applies only to that day,
    and overrides any whole-week window for that day in the solver.
    """
    conn = get_db()
    cursor = conn.execute(
        'INSERT INTO instructor_availability (instructor_id, day, start_time, end_time) VALUES (?, ?, ?, ?)',
        (instructor_id, day or None, start_time, end_time),
    )
    conn.commit()
    row = conn.execute('SELECT * FROM instructor_availability WHERE id = ?', (cursor.lastrowid,)).fetchone()
    conn.close()
    return dict(row)


def delete_instructor_availability(avail_id):
    """Delete a specific availability window by its ID."""
    conn = get_db()
    conn.execute('DELETE FROM instructor_availability WHERE id = ?', (avail_id,))
    conn.commit()
    conn.close()


def get_preferred_time_slots():
    """
    Return all instructor-subject pairs that have a preferred start time set.
    Returns None if no preferred times are configured,
    which skips Stage 2 optimization in the solver.
    """
    conn = get_db()
    rows = conn.execute(
        '''SELECT instructor_id, subject_id, preferred_time AS preferred_start_time
           FROM instructor_subjects
           WHERE preferred_time IS NOT NULL AND preferred_time != ""'''
    ).fetchall()
    conn.close()
    result = [dict(row) for row in rows]
    return result if result else None


# ── Room types ────────────────────────────────────────────────────────────────

def get_all_room_types():
    """Return all room type classifications ordered by name."""
    conn = get_db()
    rows = conn.execute('SELECT * FROM room_types ORDER BY name').fetchall()
    conn.close()
    return [dict(row) for row in rows]


def add_room_type(name):
    """
    Add a new room type classification.
    Name is lowercased and trimmed before saving.
    Raises an exception if the type already exists.
    """
    conn = get_db()
    try:
        cursor = conn.execute('INSERT INTO room_types (name) VALUES (?)', (name.strip().lower(),))
        conn.commit()
        row = conn.execute('SELECT * FROM room_types WHERE id = ?', (cursor.lastrowid,)).fetchone()
        conn.close()
        return dict(row)
    except Exception:
        conn.rollback()
        conn.close()
        raise


def delete_room_type(type_id):
    """
    Delete a room type classification.
    Raises ValueError if the type is still assigned to any room or subject,
    to prevent orphaned data that would break room-subject matching in the solver.
    """
    conn = get_db()
    type_row = conn.execute('SELECT name FROM room_types WHERE id = ?', (type_id,)).fetchone()
    if type_row:
        name = type_row['name']
        room_count    = conn.execute('SELECT COUNT(*) FROM rooms    WHERE type = ?', (name,)).fetchone()[0]
        subject_count = conn.execute('SELECT COUNT(*) FROM subjects WHERE type = ?', (name,)).fetchone()[0]
        if room_count > 0 or subject_count > 0:
            conn.close()
            raise ValueError(f"Cannot delete '{name}' — it is still used by {room_count} room(s) and {subject_count} subject(s).")
    conn.execute('DELETE FROM room_types WHERE id = ?', (type_id,))
    conn.commit()
    conn.close()
