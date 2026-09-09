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

function validRooms(value: unknown, events: CalendarEvent[] = []): string[] {
  const candidates = Array.isArray(value) ? value : events.map(event => event.room)
  const rooms = new Map<string, string>()
  candidates.forEach(room => {
    if (typeof room !== 'string') return
    const displayName = room.trim()
    if (displayName) rooms.set(displayName.toLocaleLowerCase(), rooms.get(displayName.toLocaleLowerCase()) ?? displayName)
  })
  return [...rooms.values()]
}

function validTimes(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter(time => Number.isInteger(time) && time >= 0 && time <= 1440))].sort((left, right) => left - right)
}

export function loadCsvSchedule(): { events: CalendarEvent[]; name: string; rooms: string[]; times: number[]; fingerprint: string; tbaSubjects: string[] } {
  try {
    const saved = localStorage.getItem(CSV_STORAGE_KEY)
    if (!saved) return { events: [], name: '', rooms: [], times: [], fingerprint: '', tbaSubjects: [] }
    const parsed = JSON.parse(saved) as { events?: CalendarEvent[]; name?: string; rooms?: string[]; times?: number[]; fingerprint?: string; tbaSubjects?: string[] }
    const events = Array.isArray(parsed.events) ? parsed.events : []
    return {
      events,
      name: typeof parsed.name === 'string' ? parsed.name : '',
      rooms: validRooms(parsed.rooms, events),
      times: validTimes(parsed.times),
      fingerprint: typeof parsed.fingerprint === 'string' ? parsed.fingerprint : '',
      tbaSubjects: validTbaSubjects(parsed.tbaSubjects),
    }
  } catch {
    return { events: [], name: '', rooms: [], times: [], fingerprint: '', tbaSubjects: [] }
  }
}

export function saveCsvScheduleLocally(value: { events: CalendarEvent[]; name: string; rooms: string[]; times: number[]; fingerprint: string; tbaSubjects: string[] }) {
  localStorage.setItem(CSV_STORAGE_KEY, JSON.stringify(value))
}
