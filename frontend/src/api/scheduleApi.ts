import { pollForChanges, requestJson } from './apiClient'

export interface SharedSchedule<T> {
  csvName: string
  csvEvents: T[]
}

// Flask is always local to the desktop app. It decides whether cloud storage
// is configured, so Supabase credentials are never bundled into React.
export const isCloudConfigured = true

export async function loadSharedSchedule<T>(): Promise<SharedSchedule<T> | null> {
  if (!isCloudConfigured) return null
  return requestJson<SharedSchedule<T> | null>('/api/schedules/shared')
}

export async function saveSharedSchedule<T>(schedule: SharedSchedule<T>): Promise<void> {
  if (!isCloudConfigured) return
  await requestJson<void>('/api/schedules/shared', {
    method: 'PUT',
    body: JSON.stringify(schedule),
  })
}

export function subscribeToSharedSchedule(onChange: () => void) {
  return isCloudConfigured ? pollForChanges(onChange) : () => undefined
}
