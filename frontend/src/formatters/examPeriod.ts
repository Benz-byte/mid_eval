import type { CalendarEvent } from '../types'

// Like booking IDs, exam IDs retain their kind and schedule scope through the
// existing local/cloud event storage without a database migration.
export function isExamPeriod(event: CalendarEvent) {
  return event.id.startsWith('exam_')
}

export function isExamBooking(event: CalendarEvent) {
  return event.id.startsWith('booking_exam_')
}

export function examPeriodPrefix(scheduleKey: string) {
  return `exam_${encodeURIComponent(scheduleKey).replaceAll('_', '%5F')}_`
}

export function examBelongsToSchedule(event: CalendarEvent, scheduleKey: string) {
  return Boolean(scheduleKey) && (event.id.startsWith(examPeriodPrefix(scheduleKey))
    || event.id.startsWith(`booking_${examPeriodPrefix(scheduleKey)}`))
}

export function isExamDate(events: CalendarEvent[], date: string) {
  return events.some(event => (isExamPeriod(event) || isExamBooking(event)) && event.date === date)
}

export function createExamPeriodEvents(scheduleKey: string, title: string, dates: string[]): CalendarEvent[] {
  if (!scheduleKey || !title.trim()) return []
  const series = `${examPeriodPrefix(scheduleKey)}${crypto.randomUUID()}`
  return [...new Set(dates)].map(date => ({
    id: `${series}_${date}`, source: 'admin', courseCode: title.trim(), subject: '',
    date, startMinutes: 0, endMinutes: 1440, room: 'Exam period',
    classType: 'EXAM_PERIOD', section: '', studentCount: '',
  }))
}
