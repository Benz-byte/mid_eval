/**
 * API client for the Automated Laboratory Scheduling System.
 *
 * All communication between the React frontend and the Flask backend
 * goes through this module. Each method maps directly to a Flask endpoint.
 *
 * The base URL is injected by the Electron preload script in production.
 * In development (plain browser), it falls back to localhost:5000.
 */

import type {
  Subject, Room, Instructor,
  ScheduleEntry, SolverResult, InstructorAvailability, RoomType,
} from './types'

// URL injected by the Electron preload; fall back for plain browser dev
const BASE = window.electron?.flaskUrl ?? 'http://localhost:5000'

/**
 * Generic HTTP request helper.
 * Throws an error with the server's error message if the response is not ok.
 */
async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as { error?: string }).error ?? res.statusText)
  }
  return res.json() as Promise<T>
}

export const api = {
  /** Check if the Flask API is reachable. */
  health: () =>
    req<{ status: string; message: string }>('GET', '/api/health'),

  subjects: {
    /** Return all subjects. */
    list:   ()                          => req<Subject[]>('GET',    '/api/subjects/'),
    /** Create a new subject. */
    create: (data: Omit<Subject, 'id'>) => req<Subject>  ('POST',   '/api/subjects/', data),
    /** Delete a subject by ID. */
    remove: (id: number)                => req<void>      ('DELETE', `/api/subjects/${id}`),
  },

  rooms: {
    /** Return all rooms. */
    list:   ()                        => req<Room[]>('GET',    '/api/rooms/'),
    /** Create a new room. */
    create: (data: Omit<Room, 'id'>) => req<Room>  ('POST',   '/api/rooms/', data),
    /** Delete a room by ID. */
    remove: (id: number)              => req<void>  ('DELETE', `/api/rooms/${id}`),
    /** Return all room type classifications. */
    listTypes:   ()                   => req<RoomType[]>('GET',    '/api/rooms/types/'),
    /** Add a new room type classification. */
    addType:     (name: string)       => req<RoomType>  ('POST',   '/api/rooms/types/', { name }),
    /** Delete a room type by ID. Fails if the type is still in use. */
    removeType:  (id: number)         => req<void>       ('DELETE', `/api/rooms/types/${id}`),
  },

  instructors: {
    /** Return all instructors. */
    list:          ()                              => req<Instructor[]>('GET',    '/api/instructors/'),
    /** Create a new instructor. */
    create:        (data: Omit<Instructor, 'id'>) => req<Instructor>  ('POST',   '/api/instructors/', data),
    /** Delete an instructor by ID. */
    remove:        (id: number)                    => req<void>         ('DELETE', `/api/instructors/${id}`),
    /** Return all subjects assigned to an instructor. */
    listSubjects:  (id: number)                    => req<Subject[]>   ('GET',    `/api/instructors/${id}/subjects`),
    /** Assign a subject to an instructor with an optional preferred start time. */
    assignSubject: (id: number, subjectId: number, preferredTime?: string) =>
      req<void>('POST', `/api/instructors/${id}/subjects`, { subject_id: subjectId, preferred_time: preferredTime || null }),
    /** Remove a subject assignment from an instructor. */
    removeSubject: (id: number, subjectId: number) => req<void>         ('DELETE', `/api/instructors/${id}/subjects/${subjectId}`),
    /** Return all availability windows for an instructor. */
    listAvailability: (id: number) =>
      req<InstructorAvailability[]>('GET', `/api/instructors/${id}/availability`),
    /** Add an availability window for an instructor. day=null means all days. */
    addAvailability: (id: number, data: { day: string | null; start_time: string; end_time: string }) =>
      req<InstructorAvailability>('POST', `/api/instructors/${id}/availability`, data),
    /** Delete a specific availability window. */
    removeAvailability: (id: number, availId: number) =>
      req<void>('DELETE', `/api/instructors/${id}/availability/${availId}`),
  },

  timeslots: {
    /** Return distinct timeslot start/end pairs for rendering the schedule grid. */
    list: () => req<{ start_time: string; end_time: string }[]>('GET', '/api/timeslots/'),
  },

  schedules: {
    /** Return all schedule entries with joined display data. */
    list:  () => req<ScheduleEntry[]>('GET',    '/api/schedules/'),
    /** Clear all schedule entries. */
    clear: () => req<void>            ('DELETE', '/api/schedules/'),
  },

  solver: {
    /** Trigger the CP-SAT solver and return the result. */
    run:    () => req<SolverResult>                       ('POST', '/api/solver/run'),
    /** Check the current solver state (idle, running, done). */
    status: () => req<{ status: string; message: string }>('GET',  '/api/solver/status'),
  },
}
