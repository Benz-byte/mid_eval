import type { CalendarEvent } from '../types'

export const CSV_STORAGE_KEY = 'auto-scheduler-imported-schedule'

function validTbaSubjects(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter(subject =>
    typeof subject === 'string'
    && subject.trim().length > 0
    && !/^0{1,4}\s*[-–—]\s*0{1,4}$/.test(subject.trim()),
  )
}

export function loadCsvSchedule(): { events: CalendarEvent[]; name: string; tbaSubjects: string[] } {
  try {
    const saved = localStorage.getItem(CSV_STORAGE_KEY)
    if (!saved) return { events: [], name: '', tbaSubjects: [] }
    const parsed = JSON.parse(saved) as { events?: CalendarEvent[]; name?: string; tbaSubjects?: string[] }
    return {
      events: Array.isArray(parsed.events) ? parsed.events : [],
      name: typeof parsed.name === 'string' ? parsed.name : '',
      tbaSubjects: validTbaSubjects(parsed.tbaSubjects),
    }
  } catch {
    return { events: [], name: '', tbaSubjects: [] }
  }
}
