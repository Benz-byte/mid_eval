export type Tab = 'schedule' | 'student-assistant'
export type EventSource = 'csv' | 'admin'

export interface CalendarEvent {
  id: string
  source: EventSource
  courseCode: string
  subject: string
  startMinutes: number
  endMinutes: number
  stubCode?: string
  dayCode?: string
  date?: string
  classType: string
  section: string
  room: string
  studentCount: string
  instructorLastName?: string
  lastName?: string
  firstName?: string
  middleName?: string
}

export interface ScheduleImportResult {
  events: CalendarEvent[]
  tbaSubjects: string[]
}

export interface ScheduleConflict {
  first: CalendarEvent
  second: CalendarEvent
  overlapStart: number
  overlapEnd: number
}
