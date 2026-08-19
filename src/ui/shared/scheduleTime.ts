import type { AdminEventForm, CalendarEvent } from './scheduleTypes'

export function toDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function createEmptyAdminForm(date = toDateInputValue(new Date())): AdminEventForm {
  return { title: '', date, room: '', startTime: '07:00', endTime: '08:00' }
}

export function parseInputTime(value: string): number {
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
}

export function formatTime(minutes: number) {
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  const period = hour >= 12 ? 'PM' : 'AM'
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${period}`
}

export function conflictLabel(event: CalendarEvent) {
  const subject = event.subject || event.courseCode || 'Untitled class'
  const details = [event.section, event.instructorLastName].filter(Boolean)
  return details.length > 0 ? `${subject} (${details.join(' · ')})` : subject
}

export function matchesSelectedDay(dayCode: string | undefined, date: Date) {
  if (!dayCode) return false
  const selectedCode = ['Su', 'M', 'T', 'W', 'Th', 'F', 'S'][date.getDay()]
  return dayCode.match(/Th|Su|M|T|W|F|S/g)?.includes(selectedCode) ?? false
}
