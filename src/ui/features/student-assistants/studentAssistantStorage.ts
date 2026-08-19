import type { StudentAssistantResult } from '../../../api/studentAssistantSolver'
import type { CalendarEvent } from '../../shared/scheduleTypes'

export interface UploadedAssistant {
  id: string
  label: string
  fileName: string
  events: CalendarEvent[]
}

export const ASSISTANT_STORAGE_KEY = 'auto-scheduler-student-assistants'

export function loadLocalAssistantData(): {
  assistants: UploadedAssistant[]
  result: StudentAssistantResult | null
} {
  try {
    const saved = localStorage.getItem(ASSISTANT_STORAGE_KEY)
    if (!saved) return { assistants: [], result: null }
    const parsed = JSON.parse(saved) as {
      assistants?: UploadedAssistant[]
      result?: StudentAssistantResult | null
    }
    return {
      assistants: Array.isArray(parsed.assistants) ? parsed.assistants : [],
      result: parsed.result ?? null,
    }
  } catch {
    return { assistants: [], result: null }
  }
}
