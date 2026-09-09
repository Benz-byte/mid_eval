import {
  DEFAULT_SCHEDULING_SETTINGS,
  normalizeSchedulingSettings,
  type SchedulingSettings,
  type StudentAssistantResult,
} from '../api/studentAssistantApi'
import type { UploadedAssistant } from '../types'
import { queueAssistantSync } from './localFirstSync'

export const ASSISTANT_STORAGE_KEY = 'auto-scheduler-student-assistants'

export interface LocalAssistantData {
  assistants: UploadedAssistant[]
  result: StudentAssistantResult | null
  settings: SchedulingSettings
  activeScheduleKey: string
  resultsBySchedule: Record<string, StudentAssistantResult>
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
