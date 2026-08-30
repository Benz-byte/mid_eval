import type { CalendarEvent } from '../types'

export const ADMIN_STORAGE_KEY = 'auto-scheduler-admin-events'

export function loadAdminEvents(): CalendarEvent[] {
  try {
    const saved = localStorage.getItem(ADMIN_STORAGE_KEY)
    return saved ? JSON.parse(saved) as CalendarEvent[] : []
  } catch {
    return []
  }
}

export function saveAdminEventsLocally(events: CalendarEvent[]) {
  localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(events))
}
