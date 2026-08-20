import type { CalendarEvent } from './schedule'

export interface UploadedAssistant {
  id: string
  label: string
  fileName: string
  events: CalendarEvent[]
}
