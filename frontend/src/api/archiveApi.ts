import { BackendError, requestJson } from './apiClient'
import type { RemoteArchiveRecord, ScheduleArchive } from '../storage/archiveTypes'

export function loadSharedArchives() {
  return requestJson<RemoteArchiveRecord[]>('/api/archives')
}

export class ArchiveNameConflictError extends Error {}

export async function createSharedArchive(archive: ScheduleArchive) {
  try {
    await requestJson<void>(`/api/archives/${encodeURIComponent(archive.id)}`, {
      method: 'PUT', body: JSON.stringify(archive),
    })
  } catch (error) {
    if (error instanceof BackendError && (error.status === 409 || (error.status === 400
      && error.message === 'An archive with this name already exists. Choose a different name.'))) {
      throw new ArchiveNameConflictError(error.message)
    }
    throw error
  }
}

export function deleteSharedArchive(id: string) {
  return requestJson<void>(`/api/archives/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
