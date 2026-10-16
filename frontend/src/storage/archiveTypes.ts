import type { CalendarEvent, Tab } from '../types'
import type { LocalAssistantData } from './studentAssistantStorage'
import type { SavedSchedule } from './scheduleStorage'

export interface ArchiveView {
  scheduleDate: string
  assistantWeekStart: string
  selectedAssistantId: string
  tab: Tab
}

export interface ScheduleArchive {
  schemaVersion: 1
  id: string
  name: string
  schoolYear: string
  semester: string
  createdAt: string
  schedule: SavedSchedule
  adminEvents: CalendarEvent[]
  assistantData: LocalAssistantData
  view: ArchiveView
}

export interface ArchiveRecord {
  id: string
  archive: ScheduleArchive
  deletedAt: string | null
  pending: boolean
}

export interface RemoteArchiveRecord {
  id: string
  archive: ScheduleArchive
  deletedAt: string | null
}

export function createScheduleArchive(
  details: Pick<ScheduleArchive, 'name' | 'schoolYear' | 'semester'>,
  schedule: SavedSchedule,
  adminEvents: CalendarEvent[],
  data: LocalAssistantData,
  view: ArchiveView,
): ScheduleArchive {
  if (!schedule.name) throw new Error('Upload a schedule before saving an archive.')
  if (!details.name.trim() || !details.schoolYear.trim() || !details.semester.trim()) {
    throw new Error('Enter an archive name, school year, and semester.')
  }
  const assistants = data.rostersBySchedule
    ? data.rostersBySchedule[schedule.fingerprint] ?? []
    : data.activeScheduleKey === schedule.fingerprint ? data.assistants : []
  const result = assistants.length ? data.resultsBySchedule[schedule.fingerprint]
    ?? (data.activeScheduleKey === schedule.fingerprint ? data.result : null)
    ?? null : null
  // Clone every field: later edits cannot mutate the captured snapshot.
  return JSON.parse(JSON.stringify({
    schemaVersion: 1, id: crypto.randomUUID(), createdAt: new Date().toISOString(),
    name: details.name.trim(), schoolYear: details.schoolYear.trim(), semester: details.semester.trim(),
    schedule, adminEvents, view,
    assistantData: { ...data, assistants, result, activeScheduleKey: schedule.fingerprint,
      rostersBySchedule: { [schedule.fingerprint]: assistants }, unlinkedAssistants: [],
      rosterRevisions: data.rosterRevisions?.[schedule.fingerprint]
        ? { [schedule.fingerprint]: data.rosterRevisions[schedule.fingerprint] } : {},
      resultsBySchedule: result ? { [schedule.fingerprint]: result } : {} },
  })) as ScheduleArchive
}
