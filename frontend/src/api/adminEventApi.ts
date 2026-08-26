import { pollForChanges, requestJson } from './apiClient'
import { isCloudConfigured } from './scheduleApi'

export interface SharedAdminEvent {
  id: string
  source: 'admin'
  courseCode: string
  subject: string
  date: string
  startMinutes: number
  endMinutes: number
  classType: string
  section: string
  room: string
  studentCount: string
  instructorLastName: string
  assistantId?: string
  assistantLabel?: string
}

export async function loadSharedAdminEvents(): Promise<SharedAdminEvent[]> {
  if (!isCloudConfigured) return []
  return requestJson<SharedAdminEvent[]>('/api/admin-events')
}

export async function saveSharedAdminEvent(event: {
  id: string
  courseCode: string
  date?: string
  room: string
  startMinutes: number
  endMinutes: number
  assistantId?: string
  assistantLabel?: string
}): Promise<void> {
  if (!isCloudConfigured) return
  if (!event.date) throw new Error('An event date is required.')
  await requestJson<void>(`/api/admin-events/${encodeURIComponent(event.id)}`, {
    method: 'PUT',
    body: JSON.stringify(event),
  })
}

export async function deleteSharedAdminEvent(id: string): Promise<void> {
  if (!isCloudConfigured) return
  await requestJson<void>(`/api/admin-events/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function subscribeToSharedAdminEvents(onChange: () => void) {
  return isCloudConfigured ? pollForChanges(onChange) : () => undefined
}
