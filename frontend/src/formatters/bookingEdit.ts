import type { BookingDateSchedule, CalendarEvent, RoomBookingForm, UploadedAssistant } from '../types'
import type { StudentAssistantResult } from '../api/studentAssistantApi'
import { bookingSeriesKey } from './bookingSeries'
import { examPeriodPrefix, isExamBooking, isExamDate } from './examPeriod'
import { dateFromInputValue, matchesSelectedDay } from './dateFormatter'
import { parseInputTime, formatTime } from './timeFormatter'

/** Match unchanged cards first, then unambiguous moves. Never copy one assignment twice. */
export function editedBookingEvents(previous: CalendarEvent[], form: RoomBookingForm,
  schedules: BookingDateSchedule[], scheduleKey: string): CalendarEvent[] {
  const series = previous[0] && isExamBooking(previous[0]) === Boolean(form.examPeriod)
    ? bookingSeriesKey(previous[0].id)
    : `booking_${form.examPeriod ? examPeriodPrefix(scheduleKey) : ''}${crypto.randomUUID()}`
  const drafts: CalendarEvent[] = schedules.flatMap(({ date, rooms, timeRanges }) => rooms.flatMap(room => timeRanges.map(range => ({
    id: `${series}_${Date.now()}_${Math.floor(Math.random() * 1e9)}_${date}`, source: 'admin', scheduleKey,
    courseCode: form.title.trim(), description: form.description?.trim() ?? '', subject: '', date,
    startMinutes: parseInputTime(range.startTime), endMinutes: parseInputTime(range.endTime),
    classType: 'BOOKING', section: '', room: room.trim(), studentCount: '', instructorLastName: '',
  }))))
  const unmatched = new Set(previous)
  const matches = new Map<CalendarEvent, CalendarEvent>()
  for (const fields of [
    ['date', 'room', 'startMinutes', 'endMinutes'],
    ['date', 'room'], ['date', 'startMinutes', 'endMinutes'],
    ['room', 'startMinutes', 'endMinutes'], [],
  ] satisfies (keyof CalendarEvent)[][]) {
    const compare = (a: CalendarEvent, b: CalendarEvent) => fields.every(field => a[field] === b[field])
    for (const draft of drafts.filter(item => !matches.has(item))) {
      const candidates = [...unmatched].filter(old => compare(old, draft))
      if (candidates.length !== 1) continue
      const old = candidates[0]
      if (drafts.filter(item => !matches.has(item) && compare(old, item)).length !== 1) continue
      matches.set(draft, old)
      unmatched.delete(old)
    }
  }
  return drafts.map(draft => {
    const old = matches.get(draft)
    return old ? { ...old, ...draft,
      id: isExamBooking(old) === Boolean(form.examPeriod) ? old.id : draft.id,
      assistantId: old.assistantId, assistantLabel: old.assistantLabel } : draft
  })
}

/** Recheck only changed slots; workload limits do not apply to event overtime. */
export function validateEditedEventAssistants(previous: CalendarEvent[], updated: CalendarEvent[],
  otherEvents: CalendarEvent[], assistants: UploadedAssistant[], result: StudentAssistantResult | null) {
  const conflicts: string[] = []
  const finalCalendar = [...otherEvents, ...updated]
  const events = updated.map(event => {
    const old = previous.find(item => item.id === event.id)
    const changed = !old || old.date !== event.date || old.startMinutes !== event.startMinutes
      || old.endMinutes !== event.endMinutes || old.room !== event.room
      || (event.date && isExamDate([...otherEvents, ...previous], event.date) !== isExamDate(finalCalendar, event.date))
    const assistant = assistants.find(item => item.id === event.assistantId)
    const overlaps = (item: { startMinutes: number, endMinutes: number }) => event.startMinutes < item.endMinutes && item.startMinutes < event.endMinutes
    const onDay = (day?: string) => Boolean(event.date && matchesSelectedDay(day, dateFromInputValue(event.date)))
    const exam = Boolean(event.date && isExamDate(finalCalendar, event.date))
    if (!changed || !event.assistantId) return event
    const blocked = !assistant || (!exam && (
      assistant.events.some(item => (item.date ? item.date === event.date : onDay(item.dayCode)) && overlaps(item))
      || result?.assignments?.some(item => item.assistantId === event.assistantId && onDay(item.day) && overlaps(item))
      || result?.relieverAssignments?.some(item => item.replacementAssistantId === event.assistantId && item.date === event.date && overlaps(item))
    )) || finalCalendar.some(item => item.id !== event.id && item.assistantId === event.assistantId && item.date === event.date && overlaps(item))
    if (!blocked) return event
    conflicts.push(`${event.assistantLabel ?? event.assistantId} · ${event.courseCode} · ${event.date} · ${formatTime(event.startMinutes)}–${formatTime(event.endMinutes)} · ${event.room}`)
    return { ...event, assistantId: undefined, assistantLabel: undefined }
  })
  return { events, conflicts }
}
