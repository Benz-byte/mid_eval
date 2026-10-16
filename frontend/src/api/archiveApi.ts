import { requestJson } from './apiClient'
import type { RemoteArchiveRecord, ScheduleArchive } from '../storage/archiveTypes'

export function loadSharedArchives() {
  return requestJson<RemoteArchiveRecord[]>('/api/archives')
}

export function createSharedArchive(archive: ScheduleArchive) {
  return requestJson<void>(`/api/archives/${encodeURIComponent(archive.id)}`, {
    method: 'PUT', body: JSON.stringify(archive),
  })
}

export function deleteSharedArchive(id: string) {
  return requestJson<void>(`/api/archives/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
