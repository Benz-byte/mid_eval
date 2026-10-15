import type { CalendarEvent, RoomBookingForm } from '../../types'
import { toDateInputValue } from '../../formatters/dateFormatter'
import { isExamBooking } from '../../formatters/examPeriod'

export function defaultSelectableDate() {
  const date = new Date()
  if (date.getDay() === 0) date.setDate(date.getDate() + 1)
  return toDateInputValue(date)
}

export function createEmptyBookingForm(date = defaultSelectableDate()): RoomBookingForm {
  return {
    title: '', startDate: date, endDate: date, startTime: '07:00', endTime: '08:00',
    rooms: [], repeat: 'none', weekdays: [new Date(`${date}T12:00:00`).getDay()],
  }
}

export function inferBookingRepeat(dateKeys: string[]): Pick<RoomBookingForm, 'repeat' | 'weekdays'> {
  const uniqueDates = [...new Set(dateKeys)].sort()
  if (uniqueDates.length <= 1) {
    const day = new Date(`${uniqueDates[0]}T12:00:00`).getDay()
    return { repeat: 'none', weekdays: [day] }
  }
  const dates = uniqueDates.map(value => new Date(`${value}T12:00:00`))
  const dayGaps = dates.slice(1).map((date, index) => Math.round((date.getTime() - dates[index].getTime()) / 86_400_000))
  if (dayGaps.every(gap => gap === 1)) return { repeat: 'daily', weekdays: [] }
  if (dates.every(date => date.getDate() === dates[0].getDate())) return { repeat: 'monthly', weekdays: [] }
  const weekdays = [...new Set(dates.map(date => date.getDay()))]
  const weekIndexes = [...new Set(dates.map(date => Math.floor((date.getTime() - dates[0].getTime()) / (7 * 86_400_000))))]
  const skipsWeeks = weekIndexes.slice(1).some((week, index) => week - weekIndexes[index] > 1)
  return { repeat: skipsWeeks ? 'biweekly' : 'weekly', weekdays }
}

export function bookingSeriesKey(id: string) {
  return id.replace(/(?:_\d+)*_\d{4}-\d{2}-\d{2}$/, '')
}

export function formatSelectedDate(date: string) {
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(`${date}T12:00:00`))
}

export function bookingFormFromEvents(group: CalendarEvent[]): RoomBookingForm {
  const first = group[0]
  const uniqueDates = [...new Set(group.flatMap(event => event.date ? [event.date] : []))].sort()
  return {
    title: first.courseCode,
    description: first.description ?? '',
    examPeriod: isExamBooking(first),
    startDate: uniqueDates[0],
    endDate: uniqueDates[uniqueDates.length - 1],
    startTime: `${String(Math.floor(first.startMinutes / 60)).padStart(2, '0')}:${String(first.startMinutes % 60).padStart(2, '0')}`,
    endTime: `${String(Math.floor(first.endMinutes / 60)).padStart(2, '0')}:${String(first.endMinutes % 60).padStart(2, '0')}`,
    rooms: [...new Set(group.map(event => event.room))],
    ...inferBookingRepeat(uniqueDates),
  }
}
