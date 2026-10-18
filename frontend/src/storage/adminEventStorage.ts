import type { CalendarEvent } from '../types'

export const ADMIN_STORAGE_KEY = 'auto-scheduler-admin-events'
const DELETED_IDS_KEY = 'auto-scheduler-deleted-admin-events'
export const EVENT_DELETION_CHANGE = 'admin-event-deletions-changed'

export function loadDeletedEventIds(): Set<string> {
  return new Set<string>(JSON.parse(localStorage.getItem(DELETED_IDS_KEY) ?? '[]'))
}

export function rememberDeletedEvents(ids: string[]) {
  const deleted = loadDeletedEventIds()
  if (ids.every(id => deleted.has(id))) return
  ids.forEach(id => deleted.add(id))
  localStorage.setItem(DELETED_IDS_KEY, JSON.stringify([...deleted]))
  saveAdminEventsLocally(loadAdminEvents())
  window.dispatchEvent?.(new Event(EVENT_DELETION_CHANGE))
}

export function loadAdminEvents(): CalendarEvent[] {
  try {
    const saved = localStorage.getItem(ADMIN_STORAGE_KEY)
    const deleted = loadDeletedEventIds()
    return saved ? (JSON.parse(saved) as CalendarEvent[]).filter(event => !deleted.has(event.id)) : []
  } catch {
    return []
  }
}

export function saveAdminEventsLocally(events: CalendarEvent[]) {
  const deleted = loadDeletedEventIds()
  localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(events.filter(event => !deleted.has(event.id))))
}
