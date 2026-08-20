import type { Tab } from '../types'

export const ACTIVE_TAB_STORAGE_KEY = 'auto-scheduler-active-tab'
export const SCHEDULE_DATE_STORAGE_KEY = 'auto-scheduler-selected-date'

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
