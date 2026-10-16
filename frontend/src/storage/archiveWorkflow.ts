import type { ScheduleArchive } from './archiveTypes'
import { saveArchiveLocally } from './archiveStorage'

// Closing the working schedule must never happen before the snapshot commits.
export async function saveArchiveWithAction(archive: ScheduleArchive, afterSave?: () => void) {
  await saveArchiveLocally(archive)
  afterSave?.()
}
