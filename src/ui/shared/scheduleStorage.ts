import type { CalendarEvent, Tab } from './scheduleTypes'

export const ADMIN_STORAGE_KEY = 'auto-scheduler-admin-events'
export const CSV_STORAGE_KEY = 'auto-scheduler-imported-schedule'
export const ACTIVE_TAB_STORAGE_KEY = 'auto-scheduler-active-tab'
export const SCHEDULE_DATE_STORAGE_KEY = 'auto-scheduler-selected-date'

export function loadAdminEvents(): CalendarEvent[] {
  try {
    const saved = localStorage.getItem(ADMIN_STORAGE_KEY)
    return saved ? JSON.parse(saved) as CalendarEvent[] : []
  } catch {
    return []
  }
}

export function loadCsvSchedule(): { events: CalendarEvent[]; name: string; tbaSubjects: string[] } {
  try {
    const saved = localStorage.getItem(CSV_STORAGE_KEY)
    if (!saved) return { events: [], name: '', tbaSubjects: [] }
    const parsed = JSON.parse(saved) as { events?: CalendarEvent[]; name?: string; tbaSubjects?: string[] }
    return {
      events: Array.isArray(parsed.events) ? parsed.events : [],
      name: typeof parsed.name === 'string' ? parsed.name : '',
      tbaSubjects: Array.isArray(parsed.tbaSubjects) ? parsed.tbaSubjects : [],
    }
  } catch {
    return { events: [], name: '', tbaSubjects: [] }
  }
}

export function loadActiveTab(): Tab {
  const saved = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY)
  return saved === 'schedule' || saved === 'student-assistant' ? saved : 'schedule'
}

export function loadScheduleDate(): Date {
  const saved = localStorage.getItem(SCHEDULE_DATE_STORAGE_KEY)
  if (!saved) return new Date()
  const parsed = new Date(`${saved}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}
