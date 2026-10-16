import {
  DEFAULT_SCHEDULING_SETTINGS,
  normalizeSchedulingSettings,
  type SchedulingSettings,
  type DutyAssignment,
  type StudentAssistantResult,
  type SharedStudentAssistantData,
} from '../api/studentAssistantApi'
import type { CalendarEvent, UploadedAssistant } from '../types'
import { queueAssistantSync } from './localFirstSync'

export const ASSISTANT_STORAGE_KEY = 'auto-scheduler-student-assistants'

export interface LocalAssistantData {
  rosterRevisions?: Record<string, string>
  rostersBySchedule?: Record<string, UploadedAssistant[]>
  unlinkedAssistants?: UploadedAssistant[]
  assistants: UploadedAssistant[]
  result: StudentAssistantResult | null
  settings: SchedulingSettings
  activeScheduleKey: string
  resultsBySchedule: Record<string, StudentAssistantResult>
}

export function withManualDutyAssignments(
  data: LocalAssistantData,
  assignments: DutyAssignment[],
  mainSchedule: CalendarEvent[],
): StudentAssistantResult {
  const optimizedAssistantIds = data.result?.optimizedAssistantIds
    ?? data.result?.assistantTotals?.map(total => total.assistantId)
    ?? []
  const minutesByAssistant = new Map<string, number>()
  for (const assignment of assignments) {
    minutesByAssistant.set(
      assignment.assistantId,
      (minutesByAssistant.get(assignment.assistantId) ?? 0)
        + Math.max(0, assignment.endMinutes - assignment.startMinutes),
    )
  }
  const assignedClassIds = new Set(assignments.map(assignment => assignment.classId))
  const classIds = new Set(mainSchedule.map(event => event.id))
  return {
    ...data.result,
    status: 'FEASIBLE',
    diagnostics: data.result?.diagnostics ?? [],
    assignments,
    optimizedAssistantIds,
    assistantTotals: data.assistants.map(assistant => {
      const minutes = minutesByAssistant.get(assistant.id) ?? 0
      return {
        assistantId: assistant.id,
        assistantLabel: assistant.label,
        hours: minutes / 60,
        remainingHours: (data.settings.maximumWeeklyDutyMinutes - minutes) / 60,
      }
    }),
    appliedSettings: data.result?.appliedSettings ?? data.settings,
    summary: {
      assistantCount: data.assistants.length,
      capacityHours: data.assistants.length * data.settings.maximumWeeklyDutyMinutes / 60,
      coverageHours: data.result?.summary?.coverageHours ?? 0,
      assignmentCount: assignments.length,
      assignedClassCount: assignedClassIds.size,
      unassignedClassCount: Math.max(0, classIds.size - assignedClassIds.size),
    },
  }
}

export function loadLocalAssistantData(): LocalAssistantData {
  try {
    const saved = localStorage.getItem(ASSISTANT_STORAGE_KEY)
    if (!saved) return { assistants: [], result: null, settings: DEFAULT_SCHEDULING_SETTINGS, activeScheduleKey: '', resultsBySchedule: {} }
    const parsed = JSON.parse(saved) as {
      rostersBySchedule?: Record<string, UploadedAssistant[]>
      rosterRevisions?: Record<string, string>
      unlinkedAssistants?: UploadedAssistant[]
      assistants?: UploadedAssistant[]
      result?: StudentAssistantResult | null
      settings?: SchedulingSettings
      activeScheduleKey?: string
      resultsBySchedule?: Record<string, StudentAssistantResult>
    }
    const rostersBySchedule = parsed.rostersBySchedule ?? {}
    const activeScheduleKey = typeof parsed.activeScheduleKey === 'string' ? parsed.activeScheduleKey : ''
    const resultsBySchedule = { ...parsed.resultsBySchedule }
    if (activeScheduleKey && parsed.result) resultsBySchedule[activeScheduleKey] ??= parsed.result
    return {
      rosterRevisions: parsed.rosterRevisions ?? {},
      rostersBySchedule,
      unlinkedAssistants: [...new Map([
        ...(parsed.unlinkedAssistants ?? []),
        ...(!Object.hasOwn(rostersBySchedule, activeScheduleKey) && Array.isArray(parsed.assistants) ? parsed.assistants : []),
      ].map(assistant => [assistant.id, assistant])).values()],
      assistants: activeScheduleKey ? rostersBySchedule[activeScheduleKey] ?? [] : [],
      result: rostersBySchedule[activeScheduleKey] ? parsed.result ?? null : null,
      settings: normalizeSchedulingSettings(parsed.settings),
      activeScheduleKey: typeof parsed.activeScheduleKey === 'string' ? parsed.activeScheduleKey : '',
      resultsBySchedule,
    }
  } catch {
    return { assistants: [], result: null, settings: DEFAULT_SCHEDULING_SETTINGS, activeScheduleKey: '', resultsBySchedule: {} }
  }
}

export function saveLocalAssistantData(value: LocalAssistantData, synchronize = true, updateActiveResult = true) {
  const current = loadLocalAssistantData()
  const rostersBySchedule = { ...current.rostersBySchedule, ...value.rostersBySchedule }
  const rosterRevisions = { ...current.rosterRevisions, ...value.rosterRevisions }
  if (value.activeScheduleKey && updateActiveResult) {
    if (JSON.stringify(current.rostersBySchedule?.[value.activeScheduleKey]) !== JSON.stringify(value.assistants)) {
      const previous = Date.parse(rosterRevisions[value.activeScheduleKey]?.slice(0, 24) ?? '') || 0
      rosterRevisions[value.activeScheduleKey] = `${new Date(Math.max(Date.now(), previous + 1)).toISOString()}:${crypto.randomUUID()}`
    }
    rostersBySchedule[value.activeScheduleKey] = value.assistants
  }
  else if (!value.activeScheduleKey && value.assistants.length) throw new Error('Upload a schedule before adding student assistants.')
  const resultsBySchedule = { ...value.resultsBySchedule }
  if (value.activeScheduleKey && updateActiveResult) {
    if (value.result) resultsBySchedule[value.activeScheduleKey] = value.result
    else delete resultsBySchedule[value.activeScheduleKey]
  }
  const normalized = { ...value, resultsBySchedule, rostersBySchedule, rosterRevisions,
    unlinkedAssistants: value.unlinkedAssistants ?? current.unlinkedAssistants ?? [] }
  localStorage.setItem(ASSISTANT_STORAGE_KEY, JSON.stringify(normalized))
  if (synchronize) queueAssistantSync(normalized)
}

export function activateLocalAssistantSchedule(scheduleKey: string, synchronize = true) {
  const current = loadLocalAssistantData()
  const nextResult = scheduleKey
    ? current.resultsBySchedule[scheduleKey] ?? null
    : null
  const resultsBySchedule = { ...current.resultsBySchedule }
  if (scheduleKey && nextResult && !resultsBySchedule[scheduleKey]) resultsBySchedule[scheduleKey] = nextResult
  saveLocalAssistantData({
    ...current,
    assistants: current.rostersBySchedule?.[scheduleKey] ?? [],
    activeScheduleKey: scheduleKey,
    result: current.rostersBySchedule?.[scheduleKey]?.length ? nextResult : null,
    resultsBySchedule,
  }, synchronize, false)
}

export function mergeSharedAssistantData(
  remote: SharedStudentAssistantData<UploadedAssistant, StudentAssistantResult>, scheduleKey: string,
): LocalAssistantData {
  const local = loadLocalAssistantData()
  const rostersBySchedule = { ...local.rostersBySchedule }
  const rosterRevisions = { ...local.rosterRevisions }
  for (const [key, roster] of Object.entries(remote.rostersBySchedule ?? {})) {
    const remoteRevision = remote.rosterRevisions?.[key] ?? ''
    if ((rosterRevisions[key] ?? '') > remoteRevision) continue
    rostersBySchedule[key] = roster
    if (remoteRevision) rosterRevisions[key] = remoteRevision
  }
  const resultsBySchedule = { ...local.resultsBySchedule, ...remote.solverResultsBySchedule }
  if (remote.activeScheduleKey && remote.solverResult) resultsBySchedule[remote.activeScheduleKey] = remote.solverResult
  for (const [key, revision] of Object.entries(local.rosterRevisions ?? {})) {
    if (revision > (remote.rosterRevisions?.[key] ?? '')) {
      if (local.resultsBySchedule[key]) resultsBySchedule[key] = local.resultsBySchedule[key]
      else delete resultsBySchedule[key]
    }
  }
  const legacyAssistants = !Object.hasOwn(remote.rostersBySchedule ?? {}, remote.activeScheduleKey ?? '') ? remote.assistants : []
  const linkedIds = new Set(Object.values(rostersBySchedule).flat().map(assistant => assistant.id))
  const unlinkedAssistants = [...new Map([
    ...(local.unlinkedAssistants ?? []), ...(remote.unlinkedAssistants ?? []), ...legacyAssistants,
  ].filter(assistant => !linkedIds.has(assistant.id)).map(assistant => [assistant.id, assistant])).values()]
  return { assistants: rostersBySchedule[scheduleKey] ?? [],
    result: scheduleKey && rostersBySchedule[scheduleKey]?.length ? resultsBySchedule[scheduleKey] ?? null : null,
    activeScheduleKey: scheduleKey, resultsBySchedule, rostersBySchedule, rosterRevisions, unlinkedAssistants,
    settings: normalizeSchedulingSettings(remote.schedulingSettings ?? local.settings) }
}
