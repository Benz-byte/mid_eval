import {
  DEFAULT_SCHEDULING_SETTINGS,
  normalizeSchedulingSettings,
  type SchedulingSettings,
  type DutyAssignment,
  type StudentAssistantResult,
} from '../api/studentAssistantApi'
import type { CalendarEvent, UploadedAssistant } from '../types'
import { queueAssistantSync } from './localFirstSync'

export const ASSISTANT_STORAGE_KEY = 'auto-scheduler-student-assistants'

export interface LocalAssistantData {
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
      assistants?: UploadedAssistant[]
      result?: StudentAssistantResult | null
      settings?: SchedulingSettings
      activeScheduleKey?: string
      resultsBySchedule?: Record<string, StudentAssistantResult>
    }
    return {
      assistants: Array.isArray(parsed.assistants) ? parsed.assistants : [],
      result: parsed.result ?? null,
      settings: normalizeSchedulingSettings(parsed.settings),
      activeScheduleKey: typeof parsed.activeScheduleKey === 'string' ? parsed.activeScheduleKey : '',
      resultsBySchedule: parsed.resultsBySchedule && typeof parsed.resultsBySchedule === 'object' ? parsed.resultsBySchedule : {},
    }
  } catch {
    return { assistants: [], result: null, settings: DEFAULT_SCHEDULING_SETTINGS, activeScheduleKey: '', resultsBySchedule: {} }
  }
}

export function saveLocalAssistantData(value: LocalAssistantData, synchronize = true) {
  const resultsBySchedule = { ...value.resultsBySchedule }
  if (value.activeScheduleKey) {
    if (value.result) resultsBySchedule[value.activeScheduleKey] = value.result
    else delete resultsBySchedule[value.activeScheduleKey]
  }
  const normalized = { ...value, resultsBySchedule }
  localStorage.setItem(ASSISTANT_STORAGE_KEY, JSON.stringify(normalized))
  if (synchronize) queueAssistantSync(normalized)
}

export function activateLocalAssistantSchedule(scheduleKey: string, synchronize = true, fallbackKey = '') {
  const current = loadLocalAssistantData()
  const fallbackResult = fallbackKey
    ? current.resultsBySchedule[fallbackKey] ?? (current.activeScheduleKey === fallbackKey ? current.result : null)
    : null
  const nextResult = scheduleKey
    ? current.resultsBySchedule[scheduleKey] ?? fallbackResult ?? (!current.activeScheduleKey ? current.result : null)
    : null
  const resultsBySchedule = { ...current.resultsBySchedule }
  if (scheduleKey && nextResult && !resultsBySchedule[scheduleKey]) resultsBySchedule[scheduleKey] = nextResult
  saveLocalAssistantData({
    ...current,
    activeScheduleKey: scheduleKey,
    result: nextResult,
    resultsBySchedule,
  }, synchronize)
}
