import { useCallback, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import Calendar from 'react-calendar'
import 'react-calendar/dist/Calendar.css'
import type { AdminEventForm, BookingEditScope, CalendarEvent, RoomBookingForm } from '../../types'
import { matchesSelectedDay, toDateInputValue } from '../../formatters/dateFormatter'
import { formatTime, parseInputTime } from '../../formatters/timeFormatter'

type EventMode = 'event' | 'booking'
type EventTimeRange = { id: string, startTime: string, endTime: string }
export type BookingDateSchedule = { date: string, rooms: string[], timeRanges: Array<{ startTime: string, endTime: string }> }

function createEmptyAdminForm(date = toDateInputValue(new Date())): AdminEventForm {
  return { title: '', date, room: '', startTime: '07:00', endTime: '08:00' }
}

function createEmptyBookingForm(date = toDateInputValue(new Date())): RoomBookingForm {
  return {
    title: '', startDate: date, endDate: date, startTime: '07:00', endTime: '08:00',
    rooms: [], repeat: 'none', weekdays: [new Date(`${date}T12:00:00`).getDay()],
  }
}

function inferBookingRepeat(dateKeys: string[]): Pick<RoomBookingForm, 'repeat' | 'weekdays'> {
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

function bookingSeriesKey(id: string) {
  return id.replace(/(?:_\d+)*_\d{4}-\d{2}-\d{2}$/, '')
}

function formatSelectedDate(date: string) {
  return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(`${date}T12:00:00`))
}

function adminFormFromEvent(event: CalendarEvent): AdminEventForm {
  return {
    title: event.courseCode,
    date: event.date ?? toDateInputValue(new Date()),
    room: event.room,
    startTime: `${String(Math.floor(event.startMinutes / 60)).padStart(2, '0')}:${String(event.startMinutes % 60).padStart(2, '0')}`,
    endTime: `${String(Math.floor(event.endMinutes / 60)).padStart(2, '0')}:${String(event.endMinutes % 60).padStart(2, '0')}`,
  }
}

function bookingFormFromEvents(group: CalendarEvent[]): RoomBookingForm {
  const first = group[0]
  const uniqueDates = [...new Set(group.flatMap(event => event.date ? [event.date] : []))].sort()
  return {
    title: first.courseCode,
    startDate: uniqueDates[0],
    endDate: uniqueDates[uniqueDates.length - 1],
    startTime: `${String(Math.floor(first.startMinutes / 60)).padStart(2, '0')}:${String(first.startMinutes % 60).padStart(2, '0')}`,
    endTime: `${String(Math.floor(first.endMinutes / 60)).padStart(2, '0')}:${String(first.endMinutes % 60).padStart(2, '0')}`,
    rooms: [...new Set(group.map(event => event.room))],
    ...inferBookingRepeat(uniqueDates),
  }
}

function hasConflictOnDate(
  room: string, dateKey: string, start: number, end: number,
  csvEvents: CalendarEvent[], adminEvents: CalendarEvent[], ignoredId?: string | null,
) {
  const date = new Date(`${dateKey}T12:00:00`)
  return csvEvents.some(event =>
    event.room === room && matchesSelectedDay(event.dayCode, date)
    && event.startMinutes < end && event.endMinutes > start,
  ) || adminEvents.some(event =>
    event.id !== ignoredId && event.room === room && event.date === dateKey
    && event.startMinutes < end && event.endMinutes > start,
  )
}

export function AdminEventsPanel({ events, csvEvents, rooms, onSave, onUpdateEvents, onBook, onUpdateBooking, onDeleteMany, editRequest, onClose }: {
  events: CalendarEvent[]
  csvEvents: CalendarEvent[]
  rooms: string[]
  onSave: (form: AdminEventForm, editingId: string | null) => void
  onUpdateEvents: (ids: string[], forms: AdminEventForm[]) => void
  onBook: (form: RoomBookingForm, schedules: BookingDateSchedule[]) => void
  onUpdateBooking: (ids: string[], form: RoomBookingForm, schedules: BookingDateSchedule[]) => void
  onDeleteMany: (ids: string[]) => void
  editRequest: { eventId: string, scope?: BookingEditScope } | null
  onClose: () => void
}) {
  const requestedEvent = editRequest ? events.find(event => event.id === editRequest.eventId) : undefined
  const requestedSeries = requestedEvent?.id.startsWith('booking_')
    ? events.filter(event => bookingSeriesKey(event.id) === bookingSeriesKey(requestedEvent.id))
    : []
  const requestedBookingEvents = requestedEvent?.id.startsWith('booking_')
    ? editRequest?.scope === 'room-date' || editRequest?.scope === 'day-time' || editRequest?.scope === 'time-only'
      ? [requestedEvent]
      : editRequest?.scope === 'all-rooms-date'
        ? requestedSeries.filter(event => event.date === requestedEvent.date)
        : requestedSeries
    : []
  const [mode] = useState<EventMode>('booking')
  const [form, setForm] = useState<AdminEventForm>(() => requestedEvent && !requestedEvent.id.startsWith('booking_') ? adminFormFromEvent(requestedEvent) : createEmptyAdminForm())
  const [booking, setBooking] = useState<RoomBookingForm>(() => {
    if (requestedBookingEvents.length === 0) return createEmptyBookingForm()
    const next = bookingFormFromEvents(requestedBookingEvents)
    const firstDate = [...new Set(requestedBookingEvents.flatMap(event => event.date ? [event.date] : []))].sort()[0]
    next.rooms = [...new Set(requestedBookingEvents.filter(event => event.date === firstDate).map(event => event.room))]
    return next
  })
  const [editingId, setEditingId] = useState<string | null>(requestedEvent && !requestedEvent.id.startsWith('booking_') ? requestedEvent.id : null)
  const [error, setError] = useState('')
  const [eventRooms, setEventRooms] = useState<string[]>(requestedEvent && !requestedEvent.id.startsWith('booking_') ? [requestedEvent.room] : [])
  const [showBookingWarning, setShowBookingWarning] = useState(false)
  const [manageOpen, setManageOpen] = useState<'events' | 'bookings' | null>(null)
  const [editingBookingIds, setEditingBookingIds] = useState<string[]>(requestedBookingEvents.map(event => event.id))
  const [editingScope, setEditingScope] = useState<BookingEditScope | undefined>(editRequest?.scope)
  const [editingEventIds, setEditingEventIds] = useState<string[]>([])
  const [eventTimes, setEventTimes] = useState<EventTimeRange[]>(() => [{ id: crypto.randomUUID(), startTime: form.startTime, endTime: form.endTime }])
  const [bookingTimesByDate, setBookingTimesByDate] = useState<Record<string, EventTimeRange[]>>(() => {
    const grouped: Record<string, EventTimeRange[]> = {}
    requestedBookingEvents.forEach(event => {
      if (!event.date) return
      const key = `${event.startMinutes}-${event.endMinutes}`
      if ((grouped[event.date] ?? []).some(range => `${parseInputTime(range.startTime)}-${parseInputTime(range.endTime)}` === key)) return
      grouped[event.date] = [...(grouped[event.date] ?? []), {
        id: crypto.randomUUID(),
        startTime: `${String(Math.floor(event.startMinutes / 60)).padStart(2, '0')}:${String(event.startMinutes % 60).padStart(2, '0')}`,
        endTime: `${String(Math.floor(event.endMinutes / 60)).padStart(2, '0')}:${String(event.endMinutes % 60).padStart(2, '0')}`,
      }]
    })
    if (requestedBookingEvents.length === 0) {
      grouped[toDateInputValue(new Date())] = [{ id: crypto.randomUUID(), startTime: '07:00', endTime: '08:00' }]
    }
    return grouped
  })
  const [activeSelectedDate, setActiveSelectedDate] = useState(() => requestedBookingEvents[0]?.date ?? toDateInputValue(new Date()))
  const [selectedBookingTimeId, setSelectedBookingTimeId] = useState(() => bookingTimesByDate[activeSelectedDate]?.[0]?.id ?? '')
  const [moveDate, setMoveDate] = useState(requestedEvent?.date ?? toDateInputValue(new Date()))
  const [moveStartTime, setMoveStartTime] = useState(requestedEvent ? `${String(Math.floor(requestedEvent.startMinutes / 60)).padStart(2, '0')}:${String(requestedEvent.startMinutes % 60).padStart(2, '0')}` : '07:00')
  const [moveEndTime, setMoveEndTime] = useState(requestedEvent ? `${String(Math.floor(requestedEvent.endMinutes / 60)).padStart(2, '0')}:${String(requestedEvent.endMinutes % 60).padStart(2, '0')}` : '08:00')
  const [moveRoom, setMoveRoom] = useState(requestedEvent?.room ?? '')
  const [showMoveWarning, setShowMoveWarning] = useState(false)
  const [pendingDeleteGroup, setPendingDeleteGroup] = useState<CalendarEvent[] | null>(null)
  const [selectedDates, setSelectedDates] = useState<string[]>(() => {
    const savedDates = [...new Set(requestedBookingEvents.flatMap(event => event.date ? [event.date] : []))].sort()
    return savedDates.length > 0 ? savedDates : [toDateInputValue(new Date())]
  })
  const [customizedTimeDates, setCustomizedTimeDates] = useState<string[]>(() => [...new Set(requestedBookingEvents.flatMap(event => event.date ? [event.date] : []))].sort().slice(1))
  const [customizedRoomDates, setCustomizedRoomDates] = useState<string[]>(() => [...new Set(requestedBookingEvents.flatMap(event => event.date ? [event.date] : []))].sort().slice(1))
  const [roomsByDate, setRoomsByDate] = useState<Record<string, string[]>>(() => Object.fromEntries(
    [...new Set(requestedBookingEvents.flatMap(event => event.date ? [event.date] : []))].map(date => [date, [...new Set(requestedBookingEvents.filter(event => event.date === date).map(event => event.room))]]),
  ))
  const [datePickerOpen, setDatePickerOpen] = useState(false)

  const parsedEventTimes = useMemo(() => eventTimes.map(range => ({ ...range, start: parseInputTime(range.startTime), end: parseInputTime(range.endTime) })), [eventTimes])
  const hasValidTimeRange = parsedEventTimes.length > 0 && parsedEventTimes.every(range => range.end > range.start)
  const availableRooms = useMemo(() => {
    if (!hasValidTimeRange || !form.date) return []
    return rooms.filter(room =>
      parsedEventTimes.every(range => !hasConflictOnDate(room, form.date, range.start, range.end, csvEvents, events, editingId)),
    )
  }, [csvEvents, editingId, events, form.date, hasValidTimeRange, parsedEventTimes, rooms])

  const dates = useMemo(() => [...selectedDates].sort(), [selectedDates])
  const defaultDate = dates[0] ?? ''
  const effectiveTimesForDate = useCallback((date: string) => bookingTimesByDate[date === defaultDate || customizedTimeDates.includes(date) ? date : defaultDate] ?? [], [bookingTimesByDate, customizedTimeDates, defaultDate])
  const effectiveRoomsForDate = useCallback((date: string) => date === defaultDate || !customizedRoomDates.includes(date) ? booking.rooms : roomsByDate[date] ?? [], [booking.rooms, customizedRoomDates, defaultDate, roomsByDate])
  const bookingTimes = activeSelectedDate ? effectiveTimesForDate(activeSelectedDate) : []
  const activeBookingRooms = activeSelectedDate ? effectiveRoomsForDate(activeSelectedDate) : []
  const bookingHasValidRange = dates.length > 0 && dates.every(date => effectiveTimesForDate(date).length > 0 && effectiveTimesForDate(date).every(range => parseInputTime(range.endTime) > parseInputTime(range.startTime)))
  const parsedTimesForDate = useCallback((date: string) => effectiveTimesForDate(date).map(range => ({ start: parseInputTime(range.startTime), end: parseInputTime(range.endTime) })), [effectiveTimesForDate])
  const activeAdminEvents = useMemo(() => events.filter(event => !editingBookingIds.includes(event.id)), [editingBookingIds, events])
  const activeDateHasValidRange = Boolean(activeSelectedDate) && effectiveTimesForDate(activeSelectedDate).length > 0
    && effectiveTimesForDate(activeSelectedDate).every(range => parseInputTime(range.endTime) > parseInputTime(range.startTime))
  const roomsWithClasses = useMemo(() => {
    const selectedDate = new Date(`${activeSelectedDate}T12:00:00`)
    const activeRanges = parsedTimesForDate(activeSelectedDate)
    return new Set(rooms.filter(room => activeDateHasValidRange && csvEvents.some(event =>
      event.room === room && matchesSelectedDay(event.dayCode, selectedDate)
      && activeRanges.some(range => event.startMinutes < range.end && event.endMinutes > range.start),
    )))
  }, [activeDateHasValidRange, activeSelectedDate, csvEvents, parsedTimesForDate, rooms])
  const roomsWithEvents = useMemo(() => new Set(rooms.filter(room => activeDateHasValidRange && activeAdminEvents.some(event =>
    !event.id.startsWith('booking_') && event.room === room && event.date === activeSelectedDate
    && parsedTimesForDate(activeSelectedDate).some(range => event.startMinutes < range.end && event.endMinutes > range.start),
  ))), [activeAdminEvents, activeDateHasValidRange, activeSelectedDate, parsedTimesForDate, rooms])
  const roomsAlreadyBooked = useMemo(() => new Set(rooms.filter(room => activeDateHasValidRange && activeAdminEvents.some(event =>
    event.id.startsWith('booking_') && event.room === room && event.date === activeSelectedDate
    && parsedTimesForDate(activeSelectedDate).some(range => event.startMinutes < range.end && event.endMinutes > range.start),
  ))), [activeAdminEvents, activeDateHasValidRange, activeSelectedDate, parsedTimesForDate, rooms])
  const selectedEventConflictIds = useMemo(() => activeAdminEvents.filter(event =>
    !event.id.startsWith('booking_') && Boolean(event.date) && dates.includes(event.date as string) && effectiveRoomsForDate(event.date as string).includes(event.room)
    && parsedTimesForDate(event.date as string).some(range => event.startMinutes < range.end && event.endMinutes > range.start),
  ).map(event => event.id), [activeAdminEvents, dates, effectiveRoomsForDate, parsedTimesForDate])
  const selectedRoomsHaveClasses = useMemo(() => dates.some(date => {
    const selectedDate = new Date(`${date}T12:00:00`)
    return csvEvents.some(event => effectiveRoomsForDate(date).includes(event.room) && matchesSelectedDay(event.dayCode, selectedDate)
      && parsedTimesForDate(date).some(range => event.startMinutes < range.end && event.endMinutes > range.start))
  }), [csvEvents, dates, effectiveRoomsForDate, parsedTimesForDate])
  const selectedRoomsAlreadyBooked = useMemo(() => activeAdminEvents.some(event =>
    event.id.startsWith('booking_') && Boolean(event.date) && dates.includes(event.date as string)
    && effectiveRoomsForDate(event.date as string).includes(event.room)
    && parsedTimesForDate(event.date as string).some(range => event.startMinutes < range.end && event.endMinutes > range.start),
  ), [activeAdminEvents, dates, effectiveRoomsForDate, parsedTimesForDate])
  const moveStart = parseInputTime(moveStartTime)
  const moveEnd = parseInputTime(moveEndTime)
  const moveHasValidRange = moveEnd > moveStart
  const moveRoomsWithClasses = useMemo(() => {
    const selectedDate = new Date(`${moveDate}T12:00:00`)
    return new Set(rooms.filter(room => moveHasValidRange && csvEvents.some(event =>
      event.room === room && matchesSelectedDay(event.dayCode, selectedDate)
      && event.startMinutes < moveEnd && event.endMinutes > moveStart,
    )))
  }, [csvEvents, moveDate, moveEnd, moveHasValidRange, moveStart, rooms])
  const moveConflictingEvents = useMemo(() => events.filter(event =>
    event.id !== requestedEvent?.id && !event.id.startsWith('booking_') && event.room === moveRoom && event.date === moveDate
    && event.startMinutes < moveEnd && event.endMinutes > moveStart,
  ), [events, moveDate, moveEnd, moveRoom, moveStart, requestedEvent?.id])
  const moveRoomsWithEvents = useMemo(() => new Set(rooms.filter(room => events.some(event =>
    event.id !== requestedEvent?.id && !event.id.startsWith('booking_') && event.room === room && event.date === moveDate
    && event.startMinutes < moveEnd && event.endMinutes > moveStart,
  ))), [events, moveDate, moveEnd, moveStart, requestedEvent?.id, rooms])
  const moveRoomsAlreadyBooked = useMemo(() => new Set(rooms.filter(room => events.some(event =>
    event.id !== requestedEvent?.id && event.id.startsWith('booking_') && event.room === room && event.date === moveDate
    && event.startMinutes < moveEnd && event.endMinutes > moveStart,
  ))), [events, moveDate, moveEnd, moveStart, requestedEvent?.id, rooms])
  const oneDayEvents = useMemo(() => events.filter(event => !event.id.startsWith('booking_')), [events])
  const eventGroups = useMemo(() => {
    const groups = new Map<string, CalendarEvent[]>()
    oneDayEvents.forEach(event => {
      const key = event.courseCode.trim().toLocaleLowerCase()
      groups.set(key, [...(groups.get(key) ?? []), event])
    })
    return [...groups.values()]
  }, [oneDayEvents])
  const bookingGroups = useMemo(() => {
    const groups = new Map<string, CalendarEvent[]>()
    events.filter(event => event.id.startsWith('booking_')).forEach(event => {
      const titleKey = event.courseCode.trim().toLocaleLowerCase()
      groups.set(titleKey, [...(groups.get(titleKey) ?? []), event])
    })
    return [...groups.values()].map(group => group.sort((left, right) => (left.date ?? '').localeCompare(right.date ?? '')))
  }, [events])

  const updateField = (field: keyof AdminEventForm, value: string) => {
    setForm(current => ({
      ...current, [field]: value,
      ...(field === 'date' || field === 'startTime' || field === 'endTime' ? { room: '' } : {}),
    }))
    if (field === 'date' || field === 'startTime' || field === 'endTime') setEventRooms([])
  }

  const updateEventTime = (id: string, field: 'startTime' | 'endTime', value: string) => {
    setEventTimes(current => current.map(range => range.id === id ? { ...range, [field]: value } : range))
    setEventRooms([])
  }

  const updateBooking = <K extends keyof RoomBookingForm>(field: K, value: RoomBookingForm[K]) => {
    setBooking(current => {
      const next = { ...current, [field]: value, ...(field !== 'title' && field !== 'rooms' ? { rooms: [] } : {}) }
      if (field === 'startDate' && current.repeat === 'none') next.endDate = value as string
      if (field === 'endDate') next.repeat = (value as string) > current.startDate ? 'daily' : 'none'
      if (field === 'repeat' && value === 'none') next.endDate = current.startDate
      return next
    })
  }

  const updateBookingTime = (id: string, field: 'startTime' | 'endTime', value: string) => {
    if (!activeSelectedDate) return
    const source = effectiveTimesForDate(activeSelectedDate)
    setBookingTimesByDate(current => ({ ...current, [activeSelectedDate]: source.map(range => range.id === id ? { ...range, [field]: value } : { ...range, id: activeSelectedDate === defaultDate || customizedTimeDates.includes(activeSelectedDate) ? range.id : crypto.randomUUID() }) }))
    if (activeSelectedDate !== defaultDate && !customizedTimeDates.includes(activeSelectedDate)) {
      setRoomsByDate(current => ({ ...current, [activeSelectedDate]: [...booking.rooms] }))
      setCustomizedTimeDates(current => [...current, activeSelectedDate])
      setCustomizedRoomDates(current => [...current, activeSelectedDate])
    }
  }

  const customizeActiveRooms = () => {
    if (!activeSelectedDate || activeSelectedDate === defaultDate || customizedRoomDates.includes(activeSelectedDate)) return
    setBookingTimesByDate(current => ({ ...current, [activeSelectedDate]: effectiveTimesForDate(activeSelectedDate).map(range => ({ ...range, id: crypto.randomUUID() })) }))
    setRoomsByDate(current => ({ ...current, [activeSelectedDate]: [...booking.rooms] }))
    setCustomizedTimeDates(current => [...current, activeSelectedDate])
    setCustomizedRoomDates(current => [...current, activeSelectedDate])
  }

  const addBookingTime = () => {
    if (!activeSelectedDate) return
    const inherited = activeSelectedDate !== defaultDate && !customizedTimeDates.includes(activeSelectedDate)
    const source = effectiveTimesForDate(activeSelectedDate).map(range => inherited ? { ...range, id: crypto.randomUUID() } : range)
    const next = { id: crypto.randomUUID(), startTime: '13:00', endTime: '14:00' }
    setBookingTimesByDate(current => ({ ...current, [activeSelectedDate]: [...source, next] }))
    if (inherited) {
      setRoomsByDate(current => ({ ...current, [activeSelectedDate]: [...booking.rooms] }))
      setCustomizedTimeDates(current => [...current, activeSelectedDate])
      setCustomizedRoomDates(current => [...current, activeSelectedDate])
    }
    setSelectedBookingTimeId(next.id)
  }

  const removeBookingTime = () => {
    if (!activeSelectedDate || !selectedBookingTimeId) return
    const inherited = activeSelectedDate !== defaultDate && !customizedTimeDates.includes(activeSelectedDate)
    const source = effectiveTimesForDate(activeSelectedDate)
    const remaining = source.filter(range => range.id !== selectedBookingTimeId).map(range => inherited ? { ...range, id: crypto.randomUUID() } : range)
    setBookingTimesByDate(current => ({ ...current, [activeSelectedDate]: remaining }))
    if (inherited) {
      setRoomsByDate(current => ({ ...current, [activeSelectedDate]: [...booking.rooms] }))
      setCustomizedTimeDates(current => [...current, activeSelectedDate])
      setCustomizedRoomDates(current => [...current, activeSelectedDate])
    }
    setSelectedBookingTimeId(remaining[0]?.id ?? '')
  }

  const resetDateSelectionToToday = () => {
    const today = toDateInputValue(new Date())
    const resetTime = { id: crypto.randomUUID(), startTime: '07:00', endTime: '08:00' }
    setSelectedDates([today])
    setBookingTimesByDate({ [today]: [resetTime] })
    setCustomizedTimeDates([])
    setCustomizedRoomDates([])
    setRoomsByDate({})
    setActiveSelectedDate(today)
    setSelectedBookingTimeId(resetTime.id)
    setBooking(current => ({ ...current, rooms: [] }))
  }

  const toggleBookingDate = (date: Date) => {
    const key = toDateInputValue(date)
    const removing = selectedDates.includes(key)
    if (removing && selectedDates.length === 1) {
      resetDateSelectionToToday()
      return
    }
    const nextDates = removing ? selectedDates.filter(value => value !== key) : [...selectedDates, key].sort()
    const nextActiveDate = removing ? (activeSelectedDate === key ? nextDates[0] ?? '' : activeSelectedDate) : key
    const addedTime = { id: crypto.randomUUID(), startTime: '07:00', endTime: '08:00' }
    const nextActiveTimeId = removing
      ? effectiveTimesForDate(nextActiveDate)[0]?.id ?? ''
      : nextDates[0] === key ? addedTime.id : effectiveTimesForDate(key)[0]?.id ?? ''

    setSelectedDates(nextDates)
    setBookingTimesByDate(current => {
      if (!removing) return { ...current, [key]: current[key] ?? [addedTime] }
      const next = { ...current }
      if (key === defaultDate && nextActiveDate && !next[nextActiveDate]) {
        next[nextActiveDate] = effectiveTimesForDate(key).map(range => ({ ...range, id: crypto.randomUUID() }))
      }
      delete next[key]
      return next
    })
    if (removing) {
      setCustomizedTimeDates(current => current.filter(value => value !== key))
      setCustomizedRoomDates(current => current.filter(value => value !== key))
      setRoomsByDate(current => { const next = { ...current }; delete next[key]; return next })
    }
    setActiveSelectedDate(nextActiveDate)
    setSelectedBookingTimeId(nextActiveTimeId)
  }

  const selectDatesInBetween = () => {
    if (dates.length < 2) return
    const first = new Date(`${dates[0]}T12:00:00`)
    const last = new Date(`${dates[dates.length - 1]}T12:00:00`)
    const filledDates: string[] = []
    const cursor = new Date(first)
    while (cursor <= last) {
      filledDates.push(toDateInputValue(cursor))
      cursor.setDate(cursor.getDate() + 1)
    }
    setSelectedDates(filledDates)
  }

  const openDatePicker = () => {
    if (defaultDate) {
      setActiveSelectedDate(defaultDate)
      setSelectedBookingTimeId(effectiveTimesForDate(defaultDate)[0]?.id ?? '')
    }
    setDatePickerOpen(true)
  }

  const applyCalendarDates = () => {
    const firstDate = dates[0] ?? ''
    setActiveSelectedDate(firstDate)
    setSelectedBookingTimeId(effectiveTimesForDate(firstDate)[0]?.id ?? '')
    setDatePickerOpen(false)
  }

  const resetActiveDateToDefault = () => {
    if (!activeSelectedDate || activeSelectedDate === defaultDate) return
    setBookingTimesByDate(current => { const next = { ...current }; delete next[activeSelectedDate]; return next })
    setRoomsByDate(current => { const next = { ...current }; delete next[activeSelectedDate]; return next })
    setCustomizedTimeDates(current => current.filter(date => date !== activeSelectedDate))
    setCustomizedRoomDates(current => current.filter(date => date !== activeSelectedDate))
    setSelectedBookingTimeId(effectiveTimesForDate(defaultDate)[0]?.id ?? '')
  }

  const submitEvent = (event: FormEvent) => {
    event.preventDefault()
    setError('')
    const normalizedTitle = form.title.trim().toLocaleLowerCase()
    const originalTitle = editingEventIds.length > 0 ? events.find(savedEvent => savedEvent.id === editingEventIds[0])?.courseCode.trim().toLocaleLowerCase() : editingId ? events.find(savedEvent => savedEvent.id === editingId)?.courseCode.trim().toLocaleLowerCase() : undefined
    if (normalizedTitle !== originalTitle && events.some(savedEvent => savedEvent.courseCode.trim().toLocaleLowerCase() === normalizedTitle)) return setError('An event or booking with this title already exists.')
    if (!hasValidTimeRange) return setError('Every end time must be later than its start time.')
    const sortedTimes = [...parsedEventTimes].sort((left, right) => left.start - right.start)
    if (sortedTimes.some((range, index) => index > 0 && range.start < sortedTimes[index - 1].end)) return setError('Event time ranges cannot overlap.')
    if (eventRooms.length === 0 || eventRooms.some(room => !availableRooms.includes(room))) return setError('Select at least one available room.')
    const instances = eventRooms.flatMap(room => eventTimes.map(range => ({ ...form, room, startTime: range.startTime, endTime: range.endTime })))
    if (editingEventIds.length > 0) onUpdateEvents(editingEventIds, instances)
    else instances.forEach((instance, index) => onSave(instance, index === 0 ? editingId : null))
    setEditingId(null)
    setEditingEventIds([])
    setForm(createEmptyAdminForm(form.date))
    setEventTimes([{ id: crypto.randomUUID(), startTime: '07:00', endTime: '08:00' }])
    setEventRooms([])
    setEditingScope(undefined)
  }

  const submitBooking = (event: FormEvent) => {
    event.preventDefault()
    setError('')
    const normalizedTitle = booking.title.trim().toLocaleLowerCase()
    const originalTitle = editingBookingIds.length > 0 ? events.find(savedEvent => savedEvent.id === editingBookingIds[0])?.courseCode.trim().toLocaleLowerCase() : undefined
    if (normalizedTitle !== originalTitle && events.some(savedEvent => !editingBookingIds.includes(savedEvent.id) && savedEvent.courseCode.trim().toLocaleLowerCase() === normalizedTitle)) return setError('An event or booking with this title already exists.')
    if (dates.length === 0) return setError('Select at least one event date.')
    if (!bookingHasValidRange) return setError('Every end time must be later than its start time.')
    if (dates.some(date => {
      const sortedTimes = parsedTimesForDate(date).sort((left, right) => left.start - right.start)
      return sortedTimes.some((range, index) => index > 0 && range.start < sortedTimes[index - 1].end)
    })) return setError('Time slots cannot overlap on the same date.')
    if (dates.some(date => effectiveRoomsForDate(date).length === 0)) return setError('Select at least one room for every date.')
    if (selectedRoomsAlreadyBooked) {
      return setError('One or more selected rooms already have a room booking. Edit or delete the existing booking in Manage Events first.')
    }
    if (selectedRoomsHaveClasses || selectedEventConflictIds.length > 0) {
      setShowBookingWarning(true)
      return
    }
    completeBooking()
  }

  const completeBooking = () => {
    if (selectedEventConflictIds.length > 0) onDeleteMany(selectedEventConflictIds)
    const schedules = dates.map(date => ({ date, rooms: effectiveRoomsForDate(date), timeRanges: effectiveTimesForDate(date).map(({ startTime, endTime }) => ({ startTime, endTime })) }))
    const datedBooking = { ...booking, startDate: dates[0], endDate: dates[dates.length - 1], repeat: 'none' as const }
    if (editingBookingIds.length > 0) onUpdateBooking(editingBookingIds, datedBooking, schedules)
    else onBook(datedBooking, schedules)
    setBooking(createEmptyBookingForm(toDateInputValue(new Date())))
    const today = toDateInputValue(new Date())
    const resetTime = { id: crypto.randomUUID(), startTime: '07:00', endTime: '08:00' }
    setBookingTimesByDate({ [today]: [resetTime] })
    setCustomizedTimeDates([])
    setCustomizedRoomDates([])
    setRoomsByDate({})
    setSelectedDates([today])
    setActiveSelectedDate(today)
    setSelectedBookingTimeId(resetTime.id)
    setEditingBookingIds([])
    setEditingScope(undefined)
    setShowBookingWarning(false)
  }

  const selectBookingRoom = (room: string) => {
    if (!activeSelectedDate || activeSelectedDate === defaultDate) {
      updateBooking('rooms', booking.rooms.includes(room) ? booking.rooms.filter(value => value !== room) : [...booking.rooms, room])
      return
    }
    if (!customizedRoomDates.includes(activeSelectedDate)) customizeActiveRooms()
    const currentRooms = effectiveRoomsForDate(activeSelectedDate)
    setRoomsByDate(current => ({ ...current, [activeSelectedDate]: currentRooms.includes(room) ? currentRooms.filter(value => value !== room) : [...currentRooms, room] }))
    setBooking(current => ({ ...current, rooms: current.rooms }))
  }

  const completeMove = () => {
    if (!requestedEvent) return
    if (moveConflictingEvents.length > 0) onDeleteMany(moveConflictingEvents.map(event => event.id))
    if (requestedEvent.id.startsWith('booking_')) {
      const movedBooking: RoomBookingForm = {
        title: requestedEvent.courseCode,
        startDate: moveDate,
        endDate: moveDate,
        startTime: moveStartTime,
        endTime: moveEndTime,
        rooms: [moveRoom],
        repeat: 'none',
        weekdays: [new Date(`${moveDate}T12:00:00`).getDay()],
      }
      onUpdateBooking([requestedEvent.id], movedBooking, [{ date: moveDate, rooms: [moveRoom], timeRanges: [{ startTime: moveStartTime, endTime: moveEndTime }] }])
    } else {
      onSave({ title: requestedEvent.courseCode, date: moveDate, room: moveRoom, startTime: moveStartTime, endTime: moveEndTime }, requestedEvent.id)
    }
    setShowMoveWarning(false)
    onClose()
  }

  const submitMove = (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (!moveHasValidRange) return setError('End time must be later than start time.')
    if (!moveRoom) return setError('Select one room.')
    if (moveRoomsAlreadyBooked.has(moveRoom)) return setError('This room already has a room booking. Edit or delete that booking first.')
    if (moveRoomsWithClasses.has(moveRoom) || moveConflictingEvents.length > 0) {
      setShowMoveWarning(true)
      return
    }
    completeMove()
  }

  if (requestedEvent) {
    return (
      <section className="event-panel focused-event-editor">
        {error && <p className="msg-error">{error}</p>}
        <form className="event-form" onSubmit={submitMove}>
          <label className="full-field">Title<input disabled value={requestedEvent.courseCode} /></label>
          <label>Date<input required type="date" value={moveDate} onChange={event => setMoveDate(event.target.value)} /></label>
          <label>Start time<input required type="time" value={moveStartTime} onChange={event => setMoveStartTime(event.target.value)} /></label>
          <label>End time<input required type="time" value={moveEndTime} onChange={event => setMoveEndTime(event.target.value)} /></label>
          <fieldset className="vacant-room-picker booking-room-picker">
            <legend>Select one room</legend>
            {rooms.map(room => {
              const status = moveRoomsAlreadyBooked.has(room) ? 'Already booked' : moveRoomsWithEvents.has(room) ? 'Has an event' : moveRoomsWithClasses.has(room) ? 'Occupied' : 'Vacant'
              const statusClass = moveRoomsAlreadyBooked.has(room) ? 'already-booked' : moveRoomsWithEvents.has(room) ? 'has-event' : moveRoomsWithClasses.has(room) ? 'has-classes' : ''
              return <button className={`${moveRoom === room ? 'selected ' : ''}${statusClass}`.trim()} type="button" key={room} onClick={() => setMoveRoom(room)}><span>{room}</span><small>{status}</small></button>
            })}
          </fieldset>
          <div className="event-form-actions"><button className="btn-primary" type="submit">Save Changes</button><button className="btn-secondary" type="button" onClick={onClose}>Cancel</button></div>
        </form>
        {showMoveWarning && <div className="booking-warning-backdrop" role="presentation"><div className="booking-warning" role="alertdialog" aria-modal="true" aria-labelledby="move-warning-title"><h3 id="move-warning-title">Warning</h3><p>{moveConflictingEvents.length > 0 && moveRoomsWithClasses.has(moveRoom) ? 'An existing event and scheduled classes will be replaced.' : moveConflictingEvents.length > 0 ? 'An existing event will be replaced.' : 'Scheduled classes during the selected time will be replaced.'}</p><p>Do you want to proceed?</p><div><button className="btn-secondary" type="button" onClick={() => setShowMoveWarning(false)}>No</button><button className="btn-primary" type="button" onClick={completeMove}>Yes</button></div></div></div>}
      </section>
    )
  }

  const isManagerEdit = editingEventIds.length > 0 || editingBookingIds.length > 0
  const selectedBookingTime = bookingTimes.find(range => range.id === selectedBookingTimeId)

  return (
    <section className="event-panel">
      {isManagerEdit && <h2 className="manager-edit-title">{mode === 'event' ? 'Edit Event' : 'Edit Booked Room'}</h2>}
      {error && <p className="msg-error">{error}</p>}

      {mode === 'event' && editingEventIds.length > 0 ? (
        <>
          <form className="event-form" onSubmit={submitEvent}>
            <label>Event name<input required disabled={editingScope === 'time-only'} value={form.title} onChange={event => updateField('title', event.target.value)} /></label>
            <label>Date<input required disabled={editingScope === 'time-only'} type="date" value={form.date} onChange={event => updateField('date', event.target.value)} /></label>
            <fieldset className="event-time-ranges full-field">
              <legend>Time ranges</legend>
              {eventTimes.map((range, index) => <div className="event-time-row" key={range.id}><label>Start time {index + 1}<input required type="time" value={range.startTime} onChange={event => updateEventTime(range.id, 'startTime', event.target.value)} /></label><label>End time {index + 1}<input required type="time" value={range.endTime} onChange={event => updateEventTime(range.id, 'endTime', event.target.value)} /></label>{eventTimes.length > 1 && <button className="btn-secondary" type="button" onClick={() => { setEventTimes(current => current.filter(value => value.id !== range.id)); setEventRooms([]) }}>Remove</button>}</div>)}
              <button className="btn-secondary add-time-button" type="button" onClick={() => { setEventTimes(current => [...current, { id: crypto.randomUUID(), startTime: '13:00', endTime: '14:00' }]); setEventRooms([]) }}>Add Another Time</button>
            </fieldset>
            <fieldset className="vacant-room-picker">
              <legend>Vacant rooms</legend>
              {!hasValidTimeRange && <p>Choose an end time later than the start time.</p>}
              {hasValidTimeRange && rooms.length === 0 && <p>No rooms are listed. Upload a schedule first.</p>}
              {hasValidTimeRange && rooms.length > 0 && availableRooms.length === 0 && <p>No rooms are available across all selected time ranges.</p>}
              {availableRooms.map(room => <button disabled={editingScope === 'time-only'} className={eventRooms.includes(room) ? 'selected' : ''} type="button" key={room} onClick={() => setEventRooms(current => current.includes(room) ? current.filter(value => value !== room) : [...current, room])}>{room}</button>)}
            </fieldset>
            <div className="event-form-actions"><button className="btn-primary" type="submit">{editingId ? 'Save Changes' : 'Add Event'}</button><button className="btn-secondary" type="button" onClick={() => { setEditingId(null); setEditingScope(undefined); setForm(createEmptyAdminForm(form.date)); setEventTimes([{ id: crypto.randomUUID(), startTime: '07:00', endTime: '08:00' }]); setEventRooms([]) }}>Clear</button></div>
          </form>
        </>
      ) : (
        <>
          <form className="event-form booking-form" onSubmit={submitBooking}>
            <label className="full-field">Title<input required disabled={editingScope === 'time-only'} value={booking.title} onChange={event => updateBooking('title', event.target.value)} /></label>
            <div className="event-date-controls full-field">
              <label>Event dates<select value={activeSelectedDate} onChange={event => { const date = event.target.value; setActiveSelectedDate(date); setSelectedBookingTimeId(effectiveTimesForDate(date)[0]?.id ?? '') }}>{dates.map(date => <option value={date} key={date}>{formatSelectedDate(date)}</option>)}</select></label>
              <div className="add-date-control"><span>Add Date</span><button className="date-select-button" type="button" onClick={openDatePicker} aria-label="Open calendar" title="Open calendar"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 2v3M17 2v3M3.5 9h17M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z" /></svg></button></div>
            </div>
            <fieldset className="booking-time-slots full-field">
              <legend>Time slots{activeSelectedDate !== defaultDate && customizedTimeDates.includes(activeSelectedDate) && <button className="date-setting-status" type="button" onClick={resetActiveDateToDefault}>Customized</button>}</legend>
              <label>Stored time<select value={selectedBookingTimeId} onChange={event => setSelectedBookingTimeId(event.target.value)}>{bookingTimes.map((range, index) => <option value={range.id} key={range.id}>Time {index + 1}: {formatTime(parseInputTime(range.startTime))} to {formatTime(parseInputTime(range.endTime))}</option>)}</select></label>
              <div className="event-time-row"><label>Start time<input required disabled={!selectedBookingTime} type="time" value={selectedBookingTime?.startTime ?? ''} onChange={event => { if (selectedBookingTime) updateBookingTime(selectedBookingTime.id, 'startTime', event.target.value) }} /></label><label>End time<input required disabled={!selectedBookingTime} type="time" value={selectedBookingTime?.endTime ?? ''} onChange={event => { if (selectedBookingTime) updateBookingTime(selectedBookingTime.id, 'endTime', event.target.value) }} /></label></div>
              <div className="time-slot-actions"><button className="btn-secondary" disabled={!activeSelectedDate} type="button" onClick={addBookingTime}>Add Time Slot</button><button className="btn-secondary" disabled={bookingTimes.length <= 1 || !selectedBookingTime} type="button" onClick={removeBookingTime}>Remove Time Slot</button></div>
            </fieldset>
            <fieldset className="vacant-room-picker booking-room-picker">
              <legend>Room availability{activeSelectedDate !== defaultDate && customizedRoomDates.includes(activeSelectedDate) && <button className="date-setting-status" type="button" onClick={resetActiveDateToDefault}>Customized</button>}</legend>
              {!bookingHasValidRange && <p>Enter a valid date range and time to view rooms.</p>}
              {bookingHasValidRange && rooms.length === 0 && <p>No rooms are listed. Upload a schedule first.</p>}
              {bookingHasValidRange && rooms.map(room => {
                const status = roomsAlreadyBooked.has(room) ? 'Already booked' : roomsWithEvents.has(room) ? 'Has an event' : roomsWithClasses.has(room) ? 'Occupied' : 'Vacant'
                const statusClass = roomsAlreadyBooked.has(room) ? 'already-booked' : roomsWithEvents.has(room) ? 'has-event' : roomsWithClasses.has(room) ? 'has-classes' : ''
                return <button disabled={editingScope === 'time-only'} className={`${activeBookingRooms.includes(room) ? 'selected ' : ''}${statusClass}`.trim()} type="button" key={room} onClick={() => selectBookingRoom(room)}><span>{room}</span><small>{status}</small></button>
              })}
            </fieldset>
            <div className="event-form-actions"><button className="btn-primary" type="submit">{editingBookingIds.length > 0 ? 'Save Changes' : 'Add Event'}</button><button className="btn-secondary" type="button" onClick={() => { const today = toDateInputValue(new Date()); const resetTime = { id: crypto.randomUUID(), startTime: '07:00', endTime: '08:00' }; setBooking(createEmptyBookingForm(today)); setSelectedDates([today]); setBookingTimesByDate({ [today]: [resetTime] }); setCustomizedTimeDates([]); setCustomizedRoomDates([]); setRoomsByDate({}); setActiveSelectedDate(today); setSelectedBookingTimeId(resetTime.id); setEditingBookingIds([]); setEditingScope(undefined) }}>Clear</button></div>
          </form>
        </>
      )}

      {datePickerOpen && <div className="event-date-picker-backdrop" role="presentation"><section className="event-date-picker" role="dialog" aria-modal="true" aria-labelledby="event-date-picker-title"><div className="event-date-picker-heading"><h3 id="event-date-picker-title">Select Event Dates</h3><button type="button" onClick={applyCalendarDates}>Close</button></div><Calendar key={`event-calendar-${activeSelectedDate || 'none'}`} value={activeSelectedDate ? new Date(`${activeSelectedDate}T12:00:00`) : null} onClickDay={toggleBookingDate} tileClassName={({ date, view }) => view === 'month' && selectedDates.includes(toDateInputValue(date)) ? 'multi-date-selected' : null} /><div className="event-date-picker-actions"><button className="btn-secondary" type="button" onClick={resetDateSelectionToToday}>Clear Selection</button><button className="btn-secondary" disabled={dates.length < 2} type="button" onClick={selectDatesInBetween}>Select in-between</button><button className="btn-primary" type="button" onClick={applyCalendarDates}>Apply Dates</button></div></section></div>}

      {!isManagerEdit && <button className="manage-events-button" type="button" onClick={() => setManageOpen('events')}>Manage Events</button>}

      {manageOpen && (
        <div className="manage-events-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setManageOpen(null) }}>
          <section className="manage-events-window" role="dialog" aria-modal="true" aria-labelledby="manage-events-title">
            <div className="manage-events-heading"><h2 id="manage-events-title">Manage Events</h2><button type="button" onClick={() => setManageOpen(null)}>Close</button></div>
            <div className="admin-event-list">
              {eventGroups.length === 0 && bookingGroups.length === 0 && <p className="empty-state">No saved events yet.</p>}
              {bookingGroups.map(group => {
                const first = group[0]
                const last = group[group.length - 1]
                const dateLabel = first.date === last.date ? first.date : `${first.date} through ${last.date}`
                const roomLabel = [...new Set(group.map(event => event.room))].join(', ')
                const timesLabel = [...new Set(group.map(event => `${formatTime(event.startMinutes)}–${formatTime(event.endMinutes)}`))].join(', ')
                return <article className="admin-event-card" key={first.id}><div><strong>{first.courseCode}</strong><span>{dateLabel} · {roomLabel}</span><small>{timesLabel}</small></div><div><button type="button" className="btn-danger" onClick={() => setPendingDeleteGroup(group)}>Delete</button></div></article>
              })}
              {eventGroups.map(group => {
                const first = group[0]
                const datesLabel = [...new Set(group.map(event => event.date))].join(', ')
                const roomsLabel = [...new Set(group.map(event => event.room))].join(', ')
                const timesLabel = [...new Set(group.map(event => `${formatTime(event.startMinutes)}–${formatTime(event.endMinutes)}`))].join(', ')
                return <article className="admin-event-card" key={first.id}><div><strong>{first.courseCode}</strong><span>{datesLabel} · {roomsLabel}</span><small>{timesLabel}</small></div><div><button type="button" className="btn-danger" onClick={() => setPendingDeleteGroup(group)}>Delete</button></div></article>
              })}
            </div>
          </section>
        </div>
      )}

      {pendingDeleteGroup && <div className="booking-warning-backdrop" role="presentation"><div className="booking-warning" role="alertdialog" aria-modal="true" aria-labelledby="delete-event-title"><h3 id="delete-event-title">Delete event</h3><p>Do you want to delete {pendingDeleteGroup[0]?.courseCode} and all of its saved cards?</p><div><button className="btn-secondary" type="button" onClick={() => setPendingDeleteGroup(null)}>No</button><button className="btn-danger" type="button" onClick={() => { onDeleteMany(pendingDeleteGroup.map(event => event.id)); setPendingDeleteGroup(null) }}>Yes</button></div></div></div>}

      {showBookingWarning && <div className="booking-warning-backdrop" role="presentation"><div className="booking-warning" role="alertdialog" aria-modal="true" aria-labelledby="booking-warning-title"><h3 id="booking-warning-title">Warning</h3><p>{selectedEventConflictIds.length > 0 && selectedRoomsHaveClasses ? 'Existing events and scheduled classes in the selected rooms will be replaced.' : selectedEventConflictIds.length > 0 ? 'One or more selected rooms have an existing event that will be replaced.' : 'One or more selected rooms have scheduled classes during the selected date and time.'}</p><p>Do you want to proceed with this booking?</p><div><button className="btn-secondary" type="button" onClick={() => setShowBookingWarning(false)}>No</button><button className="btn-primary" type="button" onClick={completeBooking}>Yes</button></div></div></div>}
    </section>
  )
}
