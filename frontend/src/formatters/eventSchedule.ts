import type { CalendarEvent } from '../types'
import { examBelongsToSchedule, isExamPeriod } from './examPeriod'

// Unscoped legacy events stay stored, but cannot safely be attributed to a CSV.
export function eventBelongsToSchedule(event: CalendarEvent, scheduleKey: string) {
  if (!scheduleKey) return false
  return event.scheduleKey ? event.scheduleKey === scheduleKey : examBelongsToSchedule(event, scheduleKey)
}

export function eventsForSchedule(events: CalendarEvent[], scheduleKey: string, rooms: string[]) {
  const roomNames = new Map(rooms.map(room => [room.trim().toLocaleLowerCase(), room]))
  return events.flatMap(event => {
    if (!eventBelongsToSchedule(event, scheduleKey)) return []
    if (isExamPeriod(event)) return [event]
    const room = roomNames.get(event.room.trim().toLocaleLowerCase())
    return room ? [{ ...event, room }] : []
  })
}
