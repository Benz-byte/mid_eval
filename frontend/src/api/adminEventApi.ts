import { BackendError, pollForChanges, requestJson } from './apiClient'
import { isCloudConfigured } from './scheduleApi'

export interface SharedAdminEvent {
  scheduleKey?: string
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

export async function loadSharedAdminEvents(): Promise<{ events: SharedAdminEvent[], deletedIds: string[] }> {
  if (!isCloudConfigured) return { events: [], deletedIds: [] }
  const snapshot = await requestJson<{ events: SharedAdminEvent[], deletedIds: string[], eventStorageVersion: number }>('/api/admin-events?include_deleted=true')
  if (snapshot.eventStorageVersion !== 1) throw new Error('Restart the backend to enable event deletion protection.')
  return snapshot
}

export async function saveSharedAdminEvent(event: {
  scheduleKey?: string
  id: string
  courseCode: string
  date?: string
  room: string
  startMinutes: number
  endMinutes: number
  assistantId?: string
  assistantLabel?: string
}): Promise<boolean> {
  if (!isCloudConfigured) throw new Error('Event synchronization is not configured.')
  if (!event.date) throw new Error('An event date is required.')
  try {
    await requestJson<void>(`/api/admin-events/${encodeURIComponent(event.id)}`, {
      method: 'PUT', body: JSON.stringify(event),
    })
    return true
  } catch (error) {
    if (error instanceof BackendError && error.status === 410) return false
    throw error
  }
}

export async function deleteSharedAdminEvent(id: string): Promise<void> {
  if (!isCloudConfigured) throw new Error('Event synchronization is not configured.')
  const acknowledgement = await requestJson<{ eventStorageVersion: number }>(`/api/admin-events/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (acknowledgement?.eventStorageVersion !== 1) throw new Error('Restart the backend to enable event deletion protection. The deletion is still queued.')
}

export function subscribeToSharedAdminEvents(onChange: () => void) {
  return isCloudConfigured ? pollForChanges(onChange) : () => undefined
}
