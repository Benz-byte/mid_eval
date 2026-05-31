/**
 * TypeScript interfaces for all API data types used in the
 * Automated Laboratory Scheduling System.
 *
 * These interfaces match the JSON shapes returned by the Flask API
 * and are shared across the API client and UI components.
 */

/** A room type classification (e.g. lecture, lab, cisco, drawing). */
export interface RoomType {
  id: number
  name: string
}

/** A subject to be scheduled. */
export interface Subject {
  id: number
  code: string
  name: string
  hours_per_week: number
  /** Must match an existing RoomType name for the solver to assign a room. */
  type: string
  preferred_time?: string
  students: number
}

/** A physical room available for scheduling. */
export interface Room {
  id: number
  name: string
  capacity: number
  /** Must match an existing RoomType name for the solver to match subjects. */
  type: string
  /** 'Ground' or '2nd Floor' — used to enforce instructor floor restrictions. */
  floor: string
}

/** An instructor who can be assigned to subjects. */
export interface Instructor {
  id: number
  name: string
  /** Preferred start time for scheduling (e.g. '07:00'). Set per assignment, not per instructor. */
  preferred_time?: string
  /** If set to 'Ground', the solver only assigns this instructor to ground floor rooms. */
  floor_restriction?: string
}

/** An availability window defining when an instructor can be scheduled. */
export interface InstructorAvailability {
  id: number
  instructor_id: number
  /** null means the window applies to all days (whole week). */
  day: string | null
  start_time: string
  end_time: string
}

/** A 30-minute timeslot used as the base unit for scheduling. */
export interface Timeslot {
  id: number
  day: string
  start_time: string
  end_time: string
  duration: number
}

/** A single entry in the generated schedule timetable. */
export interface ScheduleEntry {
  id: number
  subject_code: string
  subject_name: string
  room_name: string
  instructor_name: string
  day: string
  start_time: string
  end_time: string
}

/** Result returned by the solver endpoint after a run. */
export interface SolverResult {
  status: 'success' | 'infeasible' | 'error'
  solver?: string
  solution_status?: string
  message?: string
  assignments: Array<{
    subject_id: number
    room_id: number
    instructor_id: number
    timeslot_id: number
  }>
}
