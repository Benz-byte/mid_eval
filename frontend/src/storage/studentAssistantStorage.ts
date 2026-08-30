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
}

export function loadLocalAssistantData(): LocalAssistantData {
  try {
    const saved = localStorage.getItem(ASSISTANT_STORAGE_KEY)
    if (!saved) return { assistants: [], result: null, settings: DEFAULT_SCHEDULING_SETTINGS }
    const parsed = JSON.parse(saved) as {
      assistants?: UploadedAssistant[]
      result?: StudentAssistantResult | null
      settings?: SchedulingSettings
    }
    return {
      assistants: Array.isArray(parsed.assistants) ? parsed.assistants : [],
      result: parsed.result ?? null,
      settings: normalizeSchedulingSettings(parsed.settings),
    }
  } catch {
    return { assistants: [], result: null, settings: DEFAULT_SCHEDULING_SETTINGS }
  }
}

export function saveLocalAssistantData(value: LocalAssistantData, synchronize = true) {
  localStorage.setItem(ASSISTANT_STORAGE_KEY, JSON.stringify(value))
  if (synchronize) queueAssistantSync(value)
}
