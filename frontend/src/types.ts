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

export interface AdminEventForm {
  title: string
  date: string
  room: string
  startTime: string
  endTime: string
}

export type BookingRepeat = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly'
export type BookingEditScope = 'room-date' | 'all-rooms-date' | 'entire-booking' | 'day-time' | 'time-only'

export interface RoomBookingForm {
  title: string
  startDate: string
  endDate: string
  startTime: string
  endTime: string
  rooms: string[]
  repeat: BookingRepeat
  weekdays: number[]
}

export interface UploadedAssistant {
  id: string
  label: string
  fileName: string
  events: CalendarEvent[]
}

declare global {
  interface Window {
    electron: {
      flaskUrl: string
    }
  }
}
