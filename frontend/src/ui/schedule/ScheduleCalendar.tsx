import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ChangeEvent } from 'react'
import type { BookingEditScope, CalendarEvent, ScheduleConflict, UploadedAssistant } from '../../types'
import type { DutyAssignment, RelieverAssignment, StudentAssistantResult } from '../../api/studentAssistantApi'
import { matchesSelectedDay, toDateInputValue } from '../../formatters/dateFormatter'
import { formatTime } from '../../formatters/timeFormatter'
import { SCHEDULE_DATE_STORAGE_KEY, loadScheduleDate } from '../../storage/preferenceStorage'
import { loadLocalAssistantData, saveLocalAssistantData, withManualDutyAssignments } from '../../storage/studentAssistantStorage'
import { ScheduleFilter, type ScheduleFilterOption } from './ScheduleFilter'

const DEFAULT_START = 7 * 60
const DEFAULT_END = 21 * 60
const TIME_ROW_HEIGHT = 48
const WEEKDAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const DATE_DAY_CODES = ['Su', 'M', 'T', 'W', 'Th', 'F', 'S']

interface DutyContext {
  event: CalendarEvent
  date: Date
  assignment: DutyAssignment
}

interface RelieverCandidate {
  assistant: UploadedAssistant
  weeklyMinutesAfter: number
  dailyMinutesAfter: number
  consecutiveMinutesAfter: number
  dailyDutyCountAfter: number
}

function startOfWeek(date: Date) {
  const start = new Date(date)
  const day = start.getDay()
  start.setDate(start.getDate() - (day === 0 ? 6 : day - 1))
  start.setHours(0, 0, 0, 0)
  return start
}

function scheduleIdentifier(event: CalendarEvent) {
  if (event.stubCode) return event.stubCode
  return /^\d{2}-[A-Z]\d{3}-\d{2}$/i.test(event.section) ? '' : event.section
}

function conflictLabel(event: CalendarEvent) {
  const courseCode = event.courseCode || event.subject || 'Untitled class'
  const stubCode = scheduleIdentifier(event)
  return stubCode ? `${courseCode}(${stubCode})` : courseCode
}

function calendarEventKey(date: Date, event: CalendarEvent) {
  return `${toDateInputValue(date)}-${event.id}`
}

function sameWeek(left: Date, right: Date) {
  return startOfWeek(left).getTime() === startOfWeek(right).getTime()
}

function overlaps(start: number, end: number, otherStart: number, otherEnd: number) {
  return start < otherEnd && end > otherStart
}

function dateFromInputValue(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function longestConsecutiveMinutes(intervals: Array<{ start: number, end: number }>) {
  if (intervals.length === 0) return 0
  const ordered = [...intervals].sort((left, right) => left.start - right.start || left.end - right.end)
  let longest = 0
  let blockStart = ordered[0].start
  let blockEnd = ordered[0].end
  for (const interval of ordered.slice(1)) {
    if (interval.start <= blockEnd) {
      blockEnd = Math.max(blockEnd, interval.end)
    } else {
      longest = Math.max(longest, blockEnd - blockStart)
      blockStart = interval.start
      blockEnd = interval.end
    }
  }
  return Math.max(longest, blockEnd - blockStart)
}

function violatesDutyGap(intervals: Array<{ start: number, end: number }>, minimumGap: number) {
  if (minimumGap <= 0) return false
  const ordered = [...intervals].sort((left, right) => left.start - right.start || left.end - right.end)
  for (let index = 0; index < ordered.length; index += 1) {
    let chainEnd = ordered[index].end
    let continuousMinutes = ordered[index].end - ordered[index].start
    let nextIndex = index + 1
    while (nextIndex < ordered.length && ordered[nextIndex].start === chainEnd) {
      continuousMinutes += ordered[nextIndex].end - ordered[nextIndex].start
      chainEnd = ordered[nextIndex].end
      nextIndex += 1
    }
    if (continuousMinutes >= 180 && ordered.slice(nextIndex).some(interval => interval.start >= chainEnd && interval.start < chainEnd + minimumGap)) return true
  }
  return false
}

function teacherKey(event: CalendarEvent) {
  return [event.lastName, event.firstName, event.middleName]
    .filter(Boolean)
    .join('|')
    .toLocaleLowerCase()
}

function abbreviatedAssistantName(name: string) {
  const [lastName, firstName] = name.split(',').map(part => part.trim())
  if (!lastName || !firstName) return name
  const initial = Array.from(firstName).find(character => /\p{L}/u.test(character))
  return initial ? `${lastName}, ${initial.toLocaleUpperCase()}.` : lastName
}

export function ScheduleCalendar({
  csvEvents,
  adminEvents,
  csvName,
  tbaSubjects,
  rooms,
  times,
  onCsvUpload,
  onCsvRemove,
  onOpenEvents,
  onEditEvent,
  onDeleteEvent,
  onAssignAssistant,
  focusRequest,
  onFocusHandled,
}: {
  csvEvents: CalendarEvent[]
  adminEvents: CalendarEvent[]
  csvName: string
  tbaSubjects: string[]
  rooms: string[]
  times: number[]
  onCsvUpload: (file: File) => Promise<void>
  onCsvRemove: () => void
  onOpenEvents: () => void
  onEditEvent: (eventId: string, scope?: BookingEditScope) => void
  onDeleteEvent: (eventId: string) => void
  onAssignAssistant: (eventId: string, assistantId?: string, assistantLabel?: string) => void
  focusRequest?: { eventId: string, date: string, requestId: number, consumed: boolean } | null
  onFocusHandled?: (requestId: number) => void
}) {
  const [selectedDate, setSelectedDate] = useState(loadScheduleDate)
  const [uploadError, setUploadError] = useState('')
  const [showConflictColors, setShowConflictColors] = useState(true)
  const [filterOpen, setFilterOpen] = useState(false)
  const [selectedCalendarEvent, setSelectedCalendarEvent] = useState<CalendarEvent | null>(null)
  const [confirmCardDelete, setConfirmCardDelete] = useState(false)
  const [assistantAssignmentOpen, setAssistantAssignmentOpen] = useState(false)
  const [selectedEventAssistantId, setSelectedEventAssistantId] = useState('')
  const [selectedTeachers, setSelectedTeachers] = useState<Set<string>>(() => new Set())
  const [selectedRooms, setSelectedRooms] = useState<Set<string>>(() => new Set())
  const [viewMode, setViewMode] = useState<'daily' | 'weekly'>('daily')
  const [selectedWeeklyRoom, setSelectedWeeklyRoom] = useState('')
  const [roomPickerOpen, setRoomPickerOpen] = useState(false)
  const [warningDrawer, setWarningDrawer] = useState<'conflicts' | 'tba' | null>(null)
  const [focusedEventKey, setFocusedEventKey] = useState('')
  const [assistantData, setAssistantData] = useState(loadLocalAssistantData)
  const [absenceDuty, setAbsenceDuty] = useState<DutyContext | null>(null)
  const [relieverStep, setRelieverStep] = useState<'report' | 'assigned' | 'change' | null>(null)
  const [selectedRelieverId, setSelectedRelieverId] = useState('')
  const [relieverMessage, setRelieverMessage] = useState('')
  const [unassignedDuty, setUnassignedDuty] = useState<{ event: CalendarEvent, date: Date, candidates: RelieverCandidate[] } | null>(null)
  const [selectedDutyAssistantId, setSelectedDutyAssistantId] = useState('')
  const roomPickerRef = useRef<HTMLDivElement>(null)
  const dutyAssignments = assistantData.result?.assignments ?? []
  const relieverAssignments = assistantData.result?.relieverAssignments ?? []

  useEffect(() => {
    if (!focusRequest || focusRequest.consumed) return
    const [year, month, day] = focusRequest.date.split('-').map(Number)
    const date = new Date(year, month - 1, day)
    const event = csvEvents.find(candidate => candidate.id === focusRequest.eventId)
    if (!event || Number.isNaN(date.getTime())) return
    const eventKey = calendarEventKey(date, event)
    setSelectedDate(date)
    setViewMode('daily')
    setWarningDrawer(null)
    setFocusedEventKey(eventKey)
    onFocusHandled?.(focusRequest.requestId)
    const scrollTimer = window.setTimeout(() => {
      document.querySelector<HTMLElement>(`[data-calendar-event-key="${CSS.escape(eventKey)}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
    }, 120)
    const highlightTimer = window.setTimeout(() => setFocusedEventKey(''), 1000)
    return () => {
      window.clearTimeout(scrollTimer)
      window.clearTimeout(highlightTimer)
    }
  }, [csvEvents, focusRequest?.requestId])

  useEffect(() => {
    if (!focusedEventKey) return
    const clearHighlight = () => setFocusedEventKey('')
    document.addEventListener('pointerdown', clearHighlight)
    return () => document.removeEventListener('pointerdown', clearHighlight)
  }, [focusedEventKey])

  useEffect(() => {
    if (!unassignedDuty) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setUnassignedDuty(null)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [unassignedDuty])

  const assignmentForEvent = (event: CalendarEvent, date: Date) => dutyAssignments.find(value =>
    value.classId === event.id && value.day === DATE_DAY_CODES[date.getDay()],
  ) ?? dutyAssignments.find(value => value.classId === event.id)
  const relieverForEvent = (event: CalendarEvent, date: Date) => {
    const assignment = assignmentForEvent(event, date)
    return relieverAssignments.find(value =>
      value.classId === event.id
      && value.day === DATE_DAY_CODES[date.getDay()]
      && value.date === toDateInputValue(date)
      && value.startMinutes === assignment?.startMinutes
      && value.endMinutes === assignment?.endMinutes,
    )
  }
  const assistantForEvent = (event: CalendarEvent, date: Date) => {
    if (event.source === 'admin') {
      if (!event.assistantId || !event.assistantLabel) return null
      return {
        shortName: abbreviatedAssistantName(event.assistantLabel),
        fullName: event.assistantLabel,
        absentName: '',
        isPending: false,
        isReliever: false,
      }
    }
    const assignment = assignmentForEvent(event, date)
    if (!assignment) return null
    const reliever = relieverForEvent(event, date)
    if (reliever && !reliever.replacementAssistantId) {
      return {
        shortName: '',
        fullName: '',
        absentName: abbreviatedAssistantName(reliever.originalAssistantLabel),
        isPending: true,
        isReliever: false,
      }
    }
    const label = reliever?.replacementAssistantLabel ?? assignment.assistantLabel
    return {
      shortName: abbreviatedAssistantName(label),
      fullName: label,
      absentName: reliever ? abbreviatedAssistantName(reliever.originalAssistantLabel) : '',
      isPending: false,
      isReliever: Boolean(reliever?.replacementAssistantId),
    }
  }
  const selectedDateKey = toDateInputValue(selectedDate)
  const availableEventAssistants = useMemo(() => {
    if (!selectedCalendarEvent?.date) return []
    const eventDate = dateFromInputValue(selectedCalendarEvent.date)
    const assignments = assistantData.result?.assignments ?? []
    const relieverRecords = assistantData.result?.relieverAssignments ?? []
    return assistantData.assistants.filter(assistant => {
      const hasPersonalClassConflict = assistant.events.some(event =>
        matchesSelectedDay(event.dayCode, eventDate)
        && overlaps(selectedCalendarEvent.startMinutes, selectedCalendarEvent.endMinutes, event.startMinutes, event.endMinutes),
      )
      if (hasPersonalClassConflict) return false

      const hasDutyConflict = assignments.some(assignment =>
        assignment.assistantId === assistant.id
        && matchesSelectedDay(assignment.day, eventDate)
        && overlaps(selectedCalendarEvent.startMinutes, selectedCalendarEvent.endMinutes, assignment.startMinutes, assignment.endMinutes),
      ) || relieverRecords.some(assignment =>
        assignment.date === selectedCalendarEvent.date
        && assignment.replacementAssistantId === assistant.id
        && overlaps(selectedCalendarEvent.startMinutes, selectedCalendarEvent.endMinutes, assignment.startMinutes, assignment.endMinutes),
      )
      if (hasDutyConflict) return false

      return !adminEvents.some(event =>
        event.id !== selectedCalendarEvent.id
        && event.date === selectedCalendarEvent.date
        && event.assistantId === assistant.id
        && overlaps(selectedCalendarEvent.startMinutes, selectedCalendarEvent.endMinutes, event.startMinutes, event.endMinutes),
      )
    })
  }, [adminEvents, assistantData.assistants, assistantData.result, selectedCalendarEvent])
  const selectedEventAssistantAvailable = availableEventAssistants.some(assistant => assistant.id === selectedEventAssistantId)
  const openAssistantAssignment = () => {
    if (!selectedCalendarEvent) return
    setSelectedEventAssistantId(selectedCalendarEvent.assistantId ?? '')
    setAssistantAssignmentOpen(true)
  }
  const saveEventAssistant = () => {
    if (!selectedCalendarEvent || !selectedEventAssistantId) return
    const assistant = availableEventAssistants.find(value => value.id === selectedEventAssistantId)
    if (!assistant) return
    onAssignAssistant(selectedCalendarEvent.id, assistant.id, assistant.label)
    setSelectedCalendarEvent(current => current ? { ...current, assistantId: assistant.id, assistantLabel: assistant.label } : current)
    setAssistantAssignmentOpen(false)
  }
  const removeEventAssistant = () => {
    if (!selectedCalendarEvent) return
    onAssignAssistant(selectedCalendarEvent.id)
    setSelectedCalendarEvent(current => current ? { ...current, assistantId: undefined, assistantLabel: undefined } : current)
    setSelectedEventAssistantId('')
    setAssistantAssignmentOpen(false)
  }
  const openEventEditor = (eventId: string) => {
    setSelectedCalendarEvent(null)
    setAssistantAssignmentOpen(false)
    onEditEvent(eventId, 'day-time')
  }
  const visibleTbaSubjects = useMemo(
    () => tbaSubjects.filter(subject => !/^0{1,4}\s*[-–—]\s*0{1,4}$/.test(subject.trim())),
    [tbaSubjects],
  )

  useEffect(() => {
    localStorage.setItem(SCHEDULE_DATE_STORAGE_KEY, selectedDateKey)
  }, [selectedDateKey])

  useEffect(() => {
    if (!roomPickerOpen) return
    const closeRoomPicker = (event: MouseEvent) => {
      if (!roomPickerRef.current?.contains(event.target as Node)) setRoomPickerOpen(false)
    }
    const closeRoomPickerOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRoomPickerOpen(false)
    }
    document.addEventListener('mousedown', closeRoomPicker)
    document.addEventListener('keydown', closeRoomPickerOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeRoomPicker)
      document.removeEventListener('keydown', closeRoomPickerOnEscape)
    }
  }, [roomPickerOpen])

  useEffect(() => {
    if (!warningDrawer) return
    const closeWarningDrawer = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setWarningDrawer(null)
    }
    document.addEventListener('keydown', closeWarningDrawer)
    return () => document.removeEventListener('keydown', closeWarningDrawer)
  }, [warningDrawer])

  const teachers = useMemo(() => {
    const unique = new Map<string, ScheduleFilterOption>()
    csvEvents.forEach(event => {
      const key = teacherKey(event)
      if (!key || !event.lastName || unique.has(key)) return
      unique.set(key, { key, label: event.lastName })
    })
    return [...unique.values()].sort((left, right) => left.label.localeCompare(right.label))
  }, [csvEvents])

  const displayedRooms = useMemo(
    () => selectedRooms.size === 0 ? rooms : rooms.filter(room => selectedRooms.has(room)),
    [rooms, selectedRooms],
  )

  const weeklyRoom = displayedRooms.includes(selectedWeeklyRoom) ? selectedWeeklyRoom : displayedRooms[0] ?? ''

  const allEvents = useMemo(() => [...csvEvents, ...adminEvents], [csvEvents, adminEvents])
  const visibleEvents = useMemo(() => {
    const eventsForDate = allEvents.filter(event => {
    const matchesDate = event.source === 'csv'
      ? matchesSelectedDay(event.dayCode, selectedDate)
      : event.date === selectedDateKey
    if (!matchesDate) return false
    if (selectedRooms.size > 0 && !selectedRooms.has(event.room)) return false
    if (event.source === 'csv' && selectedTeachers.size > 0 && !selectedTeachers.has(teacherKey(event))) return false
    return true
    })
    const bookings = eventsForDate.filter(event => event.id.startsWith('booking_'))
    return eventsForDate.filter(event => event.source !== 'csv' || !bookings.some(booking =>
      booking.room === event.room
      && booking.startMinutes < event.endMinutes
      && booking.endMinutes > event.startMinutes,
    ))
  }, [allEvents, selectedDate, selectedDateKey, selectedRooms, selectedTeachers])
  const weekDates = useMemo(() => {
    const first = startOfWeek(selectedDate)
    return WEEKDAY_LABELS.map((_, index) => {
      const date = new Date(first)
      date.setDate(first.getDate() + index)
      return date
    })
  }, [selectedDate])
  const weeklyAllRoomEvents = useMemo(() => weekDates.map(date => {
    const dateKey = toDateInputValue(date)
    const eventsForDate = allEvents.filter(event => {
      const matchesDate = event.source === 'csv' ? matchesSelectedDay(event.dayCode, date) : event.date === dateKey
      if (!matchesDate) return false
      if (selectedRooms.size > 0 && !selectedRooms.has(event.room)) return false
      if (event.source === 'csv' && selectedTeachers.size > 0 && !selectedTeachers.has(teacherKey(event))) return false
      return true
    })
    const bookings = eventsForDate.filter(event => event.id.startsWith('booking_'))
    return eventsForDate.filter(event => event.source !== 'csv' || !bookings.some(booking =>
      booking.room === event.room
      && booking.startMinutes < event.endMinutes
      && booking.endMinutes > event.startMinutes,
    ))
  }), [allEvents, selectedRooms, selectedTeachers, weekDates])
  const weeklyEvents = useMemo(
    () => weeklyAllRoomEvents.map(dayEvents => dayEvents.filter(event => event.room === weeklyRoom)),
    [weeklyAllRoomEvents, weeklyRoom],
  )
  const conflicts = useMemo(() => {
    const detected: ScheduleConflict[] = []
    for (let firstIndex = 0; firstIndex < visibleEvents.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < visibleEvents.length; secondIndex += 1) {
        const first = visibleEvents[firstIndex]
        const second = visibleEvents[secondIndex]
        if (first.room !== second.room) continue
        const overlapStart = Math.max(first.startMinutes, second.startMinutes)
        const overlapEnd = Math.min(first.endMinutes, second.endMinutes)
        if (overlapStart < overlapEnd) detected.push({ first, second, overlapStart, overlapEnd })
      }
    }
    return detected
  }, [visibleEvents])
  const weeklyConflictDays = useMemo(() => weekDates.map((date, dayIndex) => {
    const detected: ScheduleConflict[] = []
    const dayEvents = weeklyAllRoomEvents[dayIndex]
    for (let firstIndex = 0; firstIndex < dayEvents.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < dayEvents.length; secondIndex += 1) {
        const first = dayEvents[firstIndex]
        const second = dayEvents[secondIndex]
        if (first.room !== second.room) continue
        const overlapStart = Math.max(first.startMinutes, second.startMinutes)
        const overlapEnd = Math.min(first.endMinutes, second.endMinutes)
        if (overlapStart < overlapEnd) detected.push({ first, second, overlapStart, overlapEnd })
      }
    }
    return { date, conflicts: detected }
  }).filter(day => day.conflicts.length > 0), [weekDates, weeklyAllRoomEvents])
  const displayedConflictDays = useMemo(() => {
    if (viewMode === 'weekly') return weeklyConflictDays
    return weeklyConflictDays.map(day => {
      const repeatsWeekly = day.conflicts.every(conflict => conflict.first.source === 'csv' && conflict.second.source === 'csv')
      if (!repeatsWeekly) return day
      const candidates = [-7, 0, 7].map(offset => {
        const date = new Date(day.date)
        date.setDate(date.getDate() + offset)
        return date
      })
      const nearestDate = candidates.reduce((nearest, candidate) =>
        Math.abs(candidate.getTime() - selectedDate.getTime()) < Math.abs(nearest.getTime() - selectedDate.getTime()) ? candidate : nearest,
      )
      return { ...day, date: nearestDate }
    }).sort((left, right) =>
      Math.abs(left.date.getTime() - selectedDate.getTime())
      - Math.abs(right.date.getTime() - selectedDate.getTime()),
    )
  }, [selectedDate, viewMode, weeklyConflictDays])
  const displayedConflictCount = displayedConflictDays.reduce((total, day) => total + day.conflicts.length, 0)
  const weeklyConflictingEventIds = useMemo(() => {
    const ids = new Set<string>()
    weeklyConflictDays.forEach(day => {
      day.conflicts.forEach(conflict => {
        ids.add(conflict.first.id)
        ids.add(conflict.second.id)
      })
    })
    return ids
  }, [weeklyConflictDays])
  const conflictingEventIds = useMemo(
    () => new Set(conflicts.flatMap(conflict => [conflict.first.id, conflict.second.id])),
    [conflicts],
  )
  const conflictGroups = useMemo(() => {
    const groups = new Map<string, Map<string, CalendarEvent>>()
    conflicts.forEach(conflict => {
      const roomEvents = groups.get(conflict.first.room) ?? new Map<string, CalendarEvent>()
      roomEvents.set(conflict.first.id, conflict.first)
      roomEvents.set(conflict.second.id, conflict.second)
      groups.set(conflict.first.room, roomEvents)
    })
    return [...groups.entries()]
      .sort(([leftRoom], [rightRoom]) => leftRoom.localeCompare(rightRoom))
      .map(([room, roomEvents]) => ({
        room,
        events: [...roomEvents.values()].sort((left, right) =>
          left.startMinutes - right.startMinutes
          || left.endMinutes - right.endMinutes
          || conflictLabel(left).localeCompare(conflictLabel(right)),
        ),
      }))
  }, [conflicts])

  useEffect(() => {
    if (conflictGroups.length === 0) return

    const weekday = selectedDate.toLocaleDateString(undefined, { weekday: 'long' })
    const lines = [`Conflict - ${weekday}`]
    conflictGroups.forEach(group => {
      lines.push('', `Room: ${group.room}`)
      group.events.forEach(event => {
        lines.push(`- ${conflictLabel(event)}, ${formatTime(event.startMinutes)}–${formatTime(event.endMinutes)}`)
      })
    })
    console.log(lines.join('\n'))
  }, [conflictGroups, selectedDate])

  const { rangeStart, rangeEnd } = useMemo(() => {
    if (allEvents.length === 0) {
      return {
        rangeStart: Math.floor(Math.min(DEFAULT_START, ...times) / 30) * 30,
        rangeEnd: Math.ceil(Math.max(DEFAULT_END, ...times) / 30) * 30,
      }
    }
    const earliest = Math.min(...allEvents.map(event => event.startMinutes), ...times)
    const latest = Math.max(...allEvents.map(event => event.endMinutes), ...times)
    return {
      rangeStart: Math.floor(earliest / 30) * 30,
      rangeEnd: Math.ceil(latest / 30) * 30,
    }
  }, [allEvents, times])

  const guideMinutes = useMemo(() => {
    const values = new Set<number>()
    for (let minute = rangeStart; minute <= rangeEnd; minute += 30) values.add(minute)
    allEvents.forEach(event => {
      values.add(event.startMinutes)
      values.add(event.endMinutes)
    })
    times.forEach(time => values.add(time))
    return [...values].filter(value => value >= rangeStart && value <= rangeEnd).sort((a, b) => a - b)
  }, [allEvents, rangeEnd, rangeStart, times])

  const rowHeight = TIME_ROW_HEIGHT
  const positionForMinute = (minute: number) => {
    const index = guideMinutes.indexOf(minute)
    return Math.max(index, 0) * rowHeight
  }
  const timelineHeight = Math.max((guideMinutes.length - 1) * rowHeight, rowHeight)
  const timetableStyle = {
    '--room-count': displayedRooms.length,
    '--timeline-height': `${timelineHeight}px`,
    '--timetable-width': `${96 + displayedRooms.length * 145}px`,
  } as CSSProperties
  const weeklyTimetableStyle = {
    '--timeline-height': `${timelineHeight}px`,
    '--timetable-width': `${96 + WEEKDAY_LABELS.length * 145}px`,
  } as CSSProperties

  const openFilters = () => {
    setFilterOpen(true)
  }

  const applyFilters = (teachersToShow: Set<string>, roomsToShow: Set<string>) => {
    setSelectedTeachers(teachersToShow)
    setSelectedRooms(roomsToShow)
    setFilterOpen(false)
  }

  const moveDate = (days: number) => {
    setSelectedDate(current => {
      const next = new Date(current)
      next.setDate(next.getDate() + days)
      return next
    })
  }

  const moveWeeklyRoom = (direction: number) => {
    if (displayedRooms.length < 2) return
    const currentIndex = Math.max(displayedRooms.indexOf(weeklyRoom), 0)
    const nextIndex = (currentIndex + direction + displayedRooms.length) % displayedRooms.length
    setSelectedWeeklyRoom(displayedRooms[nextIndex])
  }

  const selectDate = (value: string) => {
    if (!value) return
    const [year, month, day] = value.split('-').map(Number)
    setSelectedDate(new Date(year, month - 1, day))
  }

  const navigateToConflict = (date: Date, event: CalendarEvent) => {
    const eventKey = calendarEventKey(date, event)
    setSelectedDate(new Date(date))
    if (viewMode === 'weekly') setSelectedWeeklyRoom(event.room)
    setWarningDrawer(null)
    window.setTimeout(() => {
      document.querySelector<HTMLElement>(`[data-calendar-event-key="${CSS.escape(eventKey)}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
    }, 80)
  }

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setUploadError('')
    try {
      await onCsvUpload(file)
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Unable to read the schedule file.')
    } finally {
      event.target.value = ''
    }
  }

  const closeRelieverFlow = () => {
    setAbsenceDuty(null)
    setRelieverStep(null)
    setSelectedRelieverId('')
    setRelieverMessage('')
  }

  const openAbsenceFlow = (event: CalendarEvent, date: Date) => {
    const assignment = assignmentForEvent(event, date)
    if (!assignment) return
    const existingReliever = relieverForEvent(event, date)
    const duty = { event, date: new Date(date), assignment }
    setAbsenceDuty(duty)
    setSelectedRelieverId('')
    setRelieverMessage('')
    setRelieverStep(existingReliever?.replacementAssistantId ? 'assigned' : 'report')
  }

  const effectiveIntervalsFor = (
    assistantId: string,
    date: Date,
    reserved: Array<{ assistantId: string, date: Date, start: number, end: number }>,
    ignoredReliever?: RelieverAssignment,
  ) => {
    const day = DATE_DAY_CODES[date.getDay()]
    const dateKey = toDateInputValue(date)
    const intervals = dutyAssignments
      .filter(assignment => assignment.assistantId === assistantId && assignment.day === day && !relieverAssignments.some(record =>
        record.date === dateKey
        && record.day === day
        && record.originalAssistantId === assistantId
        && record.classId === assignment.classId
        && record.startMinutes === assignment.startMinutes
        && record.endMinutes === assignment.endMinutes,
      ))
      .map(assignment => ({ start: assignment.startMinutes, end: assignment.endMinutes }))
    relieverAssignments.filter(record =>
      record !== ignoredReliever
      && record.date === dateKey && record.replacementAssistantId === assistantId,
    ).forEach(record => intervals.push({ start: record.startMinutes, end: record.endMinutes }))
    reserved.filter(item =>
      item.assistantId === assistantId && toDateInputValue(item.date) === dateKey,
    ).forEach(item => intervals.push({ start: item.start, end: item.end }))
    return intervals
  }

  const effectiveWeeklyMinutes = (
    assistantId: string,
    date: Date,
    reserved: Array<{ assistantId: string, date: Date, start: number, end: number }>,
    ignoredReliever?: RelieverAssignment,
  ) => {
    let minutes = dutyAssignments
      .filter(assignment => assignment.assistantId === assistantId)
      .reduce((total, assignment) => total + assignment.endMinutes - assignment.startMinutes, 0)
    relieverAssignments.forEach(record => {
      if (record === ignoredReliever) return
      const recordDate = new Date(`${record.date}T00:00:00`)
      if (!sameWeek(recordDate, date)) return
      const duration = record.endMinutes - record.startMinutes
      if (record.originalAssistantId === assistantId) minutes -= duration
      if (record.replacementAssistantId === assistantId) minutes += duration
    })
    reserved.filter(item => item.assistantId === assistantId && sameWeek(item.date, date))
      .forEach(item => { minutes += item.end - item.start })
    return Math.max(0, minutes)
  }

  const rankRelievers = (
    duty: DutyContext,
    reserved: Array<{ assistantId: string, date: Date, start: number, end: number }>,
    ignoredReliever?: RelieverAssignment,
  ): RelieverCandidate[] => {
    const duration = duty.assignment.endMinutes - duty.assignment.startMinutes
    const dateKey = toDateInputValue(duty.date)
    return assistantData.assistants
      .filter(assistant => assistant.id !== duty.assignment.assistantId)
      .flatMap(assistant => {
        const hasPersonalClassConflict = assistant.events.some(event =>
          matchesSelectedDay(event.dayCode, duty.date)
          && overlaps(duty.assignment.startMinutes, duty.assignment.endMinutes, event.startMinutes, event.endMinutes),
        )
        if (hasPersonalClassConflict) return []
        const hasEventConflict = adminEvents.some(event =>
          event.assistantId === assistant.id
          && event.date === dateKey
          && overlaps(duty.assignment.startMinutes, duty.assignment.endMinutes, event.startMinutes, event.endMinutes),
        )
        if (hasEventConflict) return []
        const currentIntervals = effectiveIntervalsFor(assistant.id, duty.date, reserved, ignoredReliever)
        if (currentIntervals.some(interval => overlaps(
          duty.assignment.startMinutes,
          duty.assignment.endMinutes,
          interval.start,
          interval.end,
        ))) return []
        const currentWeeklyMinutes = effectiveWeeklyMinutes(assistant.id, duty.date, reserved, ignoredReliever)
        const weeklyMinutesAfter = currentWeeklyMinutes + duration
        const intervalsAfter = [...currentIntervals, {
          start: duty.assignment.startMinutes,
          end: duty.assignment.endMinutes,
        }]
        return [{
          assistant,
          weeklyMinutesAfter,
          dailyMinutesAfter: intervalsAfter.reduce((total, interval) => total + interval.end - interval.start, 0),
          consecutiveMinutesAfter: longestConsecutiveMinutes(intervalsAfter),
          dailyDutyCountAfter: intervalsAfter.length,
        }]
      })
      .sort((left, right) =>
        left.weeklyMinutesAfter - right.weeklyMinutesAfter
        || left.dailyMinutesAfter - right.dailyMinutesAfter
        || left.consecutiveMinutesAfter - right.consecutiveMinutesAfter
        || left.dailyDutyCountAfter - right.dailyDutyCountAfter
        || (left.assistant.studentId ?? left.assistant.id).localeCompare(right.assistant.studentId ?? right.assistant.id),
      )
  }

  const regularDutyIntervalsFor = (assistantId: string, date: Date) => {
    const day = DATE_DAY_CODES[date.getDay()]
    const dateKey = toDateInputValue(date)
    return dutyAssignments
      .filter(assignment => assignment.assistantId === assistantId && assignment.day === day && !relieverAssignments.some(record =>
        record.date === dateKey
        && record.day === day
        && record.originalAssistantId === assistantId
        && record.classId === assignment.classId
        && record.startMinutes === assignment.startMinutes
        && record.endMinutes === assignment.endMinutes,
      ))
      .map(assignment => ({ start: assignment.startMinutes, end: assignment.endMinutes }))
  }

  const regularWeeklyMinutesFor = (assistantId: string, date: Date) => {
    let minutes = dutyAssignments
      .filter(assignment => assignment.assistantId === assistantId)
      .reduce((total, assignment) => total + assignment.endMinutes - assignment.startMinutes, 0)
    relieverAssignments.forEach(record => {
      if (record.originalAssistantId !== assistantId || !sameWeek(dateFromInputValue(record.date), date)) return
      minutes -= record.endMinutes - record.startMinutes
    })
    return Math.max(0, minutes)
  }

  const availableRegularDutyCandidates = (event: CalendarEvent, date: Date): RelieverCandidate[] => {
    const duration = event.endMinutes - event.startMinutes
    const dateValue = toDateInputValue(date)
    return assistantData.assistants.flatMap(assistant => {
      const hasPersonalClassConflict = assistant.events.some(personalEvent =>
        matchesSelectedDay(personalEvent.dayCode, date)
        && overlaps(event.startMinutes, event.endMinutes, personalEvent.startMinutes, personalEvent.endMinutes),
      )
      if (hasPersonalClassConflict) return []
      const busyIntervals = effectiveIntervalsFor(assistant.id, date, [])
      const hasDutyConflict = busyIntervals.some(interval => overlaps(event.startMinutes, event.endMinutes, interval.start, interval.end))
      const hasEventConflict = adminEvents.some(adminEvent =>
        adminEvent.assistantId === assistant.id
        && adminEvent.date === dateValue
        && overlaps(event.startMinutes, event.endMinutes, adminEvent.startMinutes, adminEvent.endMinutes),
      )
      if (hasDutyConflict || hasEventConflict) return []
      const regularIntervalsAfter = [...regularDutyIntervalsFor(assistant.id, date), { start: event.startMinutes, end: event.endMinutes }]
      const dailyMinutesAfter = regularIntervalsAfter.reduce((total, interval) => total + interval.end - interval.start, 0)
      const weeklyMinutesAfter = regularWeeklyMinutesFor(assistant.id, date) + duration
      if (dailyMinutesAfter > assistantData.settings.maximumDailyDutyMinutes
        || weeklyMinutesAfter > assistantData.settings.maximumWeeklyDutyMinutes
        || violatesDutyGap(regularIntervalsAfter, assistantData.settings.minimumGapAfterThreeHourDutyMinutes)) return []
      return [{
        assistant,
        weeklyMinutesAfter,
        dailyMinutesAfter,
        consecutiveMinutesAfter: longestConsecutiveMinutes(regularIntervalsAfter),
        dailyDutyCountAfter: regularIntervalsAfter.length,
      }]
    }).sort((left, right) =>
      left.weeklyMinutesAfter - right.weeklyMinutesAfter
      || left.dailyMinutesAfter - right.dailyMinutesAfter
      || left.consecutiveMinutesAfter - right.consecutiveMinutesAfter
      || left.dailyDutyCountAfter - right.dailyDutyCountAfter
      || (left.assistant.studentId ?? left.assistant.id).localeCompare(right.assistant.studentId ?? right.assistant.id),
    )
  }

  const openUnassignedDuty = (event: CalendarEvent, date: Date) => {
    const candidates = availableRegularDutyCandidates(event, date)
    setUnassignedDuty({ event, date: new Date(date), candidates })
    setSelectedDutyAssistantId(candidates[0]?.assistant.id ?? '')
  }

  const assignRegularDuty = () => {
    if (!unassignedDuty || assignmentForEvent(unassignedDuty.event, unassignedDuty.date)) return
    const selected = availableRegularDutyCandidates(unassignedDuty.event, unassignedDuty.date).find(candidate => candidate.assistant.id === selectedDutyAssistantId)
    if (!selected) return
    const assignment: DutyAssignment = {
      assistantId: selected.assistant.id,
      assistantLabel: selected.assistant.label,
      classId: unassignedDuty.event.id,
      day: DATE_DAY_CODES[unassignedDuty.date.getDay()],
      startMinutes: unassignedDuty.event.startMinutes,
      endMinutes: unassignedDuty.event.endMinutes,
      courseCode: unassignedDuty.event.courseCode,
      subject: unassignedDuty.event.subject,
      room: unassignedDuty.event.room,
      section: unassignedDuty.event.section,
    }
    const nextResult = withManualDutyAssignments(
      assistantData,
      [...(assistantData.result?.assignments ?? []), assignment],
      csvEvents,
    )
    const nextData = { ...assistantData, result: nextResult }
    setAssistantData(nextData)
    saveLocalAssistantData(nextData)
    setUnassignedDuty(null)
    setSelectedDutyAssistantId('')
  }

  const relieverRecordFor = (duty: DutyContext, candidate: RelieverCandidate): RelieverAssignment => ({
    date: toDateInputValue(duty.date),
    classId: duty.assignment.classId,
    day: duty.assignment.day,
    startMinutes: duty.assignment.startMinutes,
    endMinutes: duty.assignment.endMinutes,
    courseCode: duty.assignment.courseCode,
    room: duty.assignment.room,
    originalAssistantId: duty.assignment.assistantId,
    originalAssistantLabel: duty.assignment.assistantLabel,
    replacementAssistantId: candidate.assistant.id,
    replacementAssistantLabel: candidate.assistant.label,
  })

  const persistRelieverRecords = (records: RelieverAssignment[]) => {
    if (!assistantData.result) return
    const replacementKeys = new Set(records.map(record => `${record.date}|${record.day}|${record.classId}|${record.startMinutes}|${record.endMinutes}`))
    const nextResult: StudentAssistantResult = {
      ...assistantData.result,
      relieverAssignments: [
        ...relieverAssignments.filter(record => !replacementKeys.has(`${record.date}|${record.day}|${record.classId}|${record.startMinutes}|${record.endMinutes}`)),
        ...records,
      ],
    }
    const nextData = { ...assistantData, result: nextResult }
    setAssistantData(nextData)
    saveLocalAssistantData(nextData)
  }

  const findRelievers = () => {
    if (!absenceDuty) return
    const candidates = rankRelievers(absenceDuty, [])
    if (candidates.length === 0) {
      setRelieverMessage('No reliever available.')
      return
    }
    persistRelieverRecords([relieverRecordFor(absenceDuty, candidates[0])])
    closeRelieverFlow()
  }

  const activeReliever = absenceDuty ? relieverForEvent(absenceDuty.event, absenceDuty.date) : undefined
  const changeRelieverCandidates = absenceDuty && activeReliever?.replacementAssistantId
    ? rankRelievers(absenceDuty, [], activeReliever).filter(candidate => candidate.assistant.id !== activeReliever.replacementAssistantId)
    : []

  const changeReliever = () => {
    setSelectedRelieverId(activeReliever?.replacementAssistantId ?? '')
    setRelieverMessage('')
    setRelieverStep('change')
  }

  const saveChangedReliever = () => {
    if (!absenceDuty || !activeReliever) return
    const candidate = rankRelievers(absenceDuty, [], activeReliever).find(value => value.assistant.id === selectedRelieverId)
    if (!candidate || candidate.assistant.id === activeReliever.replacementAssistantId) return
    persistRelieverRecords([relieverRecordFor(absenceDuty, candidate)])
    closeRelieverFlow()
  }

  const removeReliever = () => {
    if (!absenceDuty || !activeReliever || !assistantData.result) return
    const nextResult: StudentAssistantResult = {
      ...assistantData.result,
      relieverAssignments: relieverAssignments.filter(record => record !== activeReliever),
    }
    const nextData = { ...assistantData, result: nextResult }
    setAssistantData(nextData)
    saveLocalAssistantData(nextData)
    closeRelieverFlow()
  }

  return (
    <section className={`schedule-calendar${showConflictColors ? '' : ' hide-conflict-colors'}`}>
      <div className="calendar-toolbar">
        <div className="calendar-nav">
          <button type="button" onClick={() => moveDate(viewMode === 'weekly' ? -7 : -1)} aria-label={viewMode === 'weekly' ? 'Previous week' : 'Previous date'}>←</button>
          <button type="button" onClick={() => setSelectedDate(new Date())}>Today</button>
          <button type="button" onClick={() => moveDate(viewMode === 'weekly' ? 7 : 1)} aria-label={viewMode === 'weekly' ? 'Next week' : 'Next date'}>→</button>
        </div>

        <h2>
          {viewMode === 'weekly' ? `${weekDates[0].toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}–${weekDates[6].toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}` : selectedDate.toLocaleDateString(undefined, {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </h2>

        <div className="calendar-actions">
          <input
            type="date"
            aria-label="Choose schedule date"
            value={selectedDateKey}
            onChange={event => selectDate(event.target.value)}
          />
          <label className="csv-upload-button">
            Upload Schedule
            <input type="file" accept=".csv,.xls,.xlsx,text/csv" aria-label="Upload schedule file" onChange={handleUpload} />
          </label>
          <button className="btn-primary" type="button" disabled={!csvName} onClick={onOpenEvents}>
            Add Event
          </button>
          <button className="remove-csv-button" type="button" disabled={!csvName} onClick={onCsvRemove}>
            Remove CSV
          </button>
        </div>
      </div>

      {csvName && (
        <div className="calendar-summary">
          <button className={`calendar-warning-badge conflict${displayedConflictCount === 0 ? ' empty' : ''}`} type="button" onClick={() => setWarningDrawer('conflicts')}>⚠ {displayedConflictCount > 99 ? '99+' : displayedConflictCount} {displayedConflictCount === 1 ? 'Conflict' : 'Conflicts'}</button>
          <button className={`calendar-warning-badge tba${visibleTbaSubjects.length === 0 ? ' empty' : ''}`} type="button" onClick={() => setWarningDrawer('tba')}>? {visibleTbaSubjects.length > 99 ? '99+' : visibleTbaSubjects.length} TBA</button>
        </div>
      )}
      {uploadError && <p className="msg-error">{uploadError}</p>}

      {csvName && displayedRooms.length > 0 && <div className="calendar-view-room-row"><span aria-hidden="true" />{viewMode === 'weekly' ? <div className="weekly-room-navigation"><button type="button" disabled={displayedRooms.length < 2} onClick={() => moveWeeklyRoom(-1)} aria-label="Previous room">‹</button><div className="weekly-room-picker" ref={roomPickerRef}><button className="weekly-room-trigger" type="button" aria-haspopup="listbox" aria-expanded={roomPickerOpen} title="Choose room" onClick={() => setRoomPickerOpen(current => !current)}><span>{weeklyRoom}</span><span aria-hidden="true">{roomPickerOpen ? '▴' : '▾'}</span></button>{roomPickerOpen && <div className="weekly-room-menu" role="listbox" aria-label="Choose room">{displayedRooms.map(room => <button className={room === weeklyRoom ? 'selected' : ''} type="button" role="option" aria-selected={room === weeklyRoom} key={room} onClick={() => { setSelectedWeeklyRoom(room); setRoomPickerOpen(false) }}><span aria-hidden="true">{room === weeklyRoom ? '✓' : ''}</span><span>{room}</span></button>)}</div>}</div><button type="button" disabled={displayedRooms.length < 2} onClick={() => moveWeeklyRoom(1)} aria-label="Next room">›</button></div> : <span aria-hidden="true" />}<div className="calendar-view-actions"><fieldset className="calendar-view-controls" aria-label="Schedule view"><label><input type="checkbox" checked={viewMode === 'daily'} onChange={() => { setViewMode('daily'); setRoomPickerOpen(false) }} />Daily</label><label><input type="checkbox" checked={viewMode === 'weekly'} onChange={() => setViewMode('weekly')} />Weekly</label></fieldset><button className={`schedule-filter-button${selectedTeachers.size > 0 || selectedRooms.size > 0 ? ' active' : ''}`} type="button" aria-label="Filter schedule" onClick={openFilters}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg></button></div></div>}

      <div className="timetable-scroll">
        {!csvName ? (
          <div className="timetable-empty">No CSV file uploaded</div>
        ) : displayedRooms.length === 0 ? (
          <div className="timetable-empty">No rooms available</div>
        ) : viewMode === 'weekly' ? (
          <div className="weekly-timetable" style={weeklyTimetableStyle}>
            <div className="weekly-header"><div className="timetable-corner">Time</div>{weekDates.map((date, index) => <div className="room-header" key={toDateInputValue(date)}><strong>{WEEKDAY_LABELS[index]}</strong><small>{date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></div>)}</div>
            <div className="timeline-body">
              <div className="time-axis">{guideMinutes.map(minute => <span className={`time-axis-label${minute === rangeStart ? ' first' : ''}${minute === rangeEnd ? ' last' : ''}`} key={minute} style={{ top: positionForMinute(minute) }}>{formatTime(minute)}</span>)}</div>
              <div className="weekly-day-lanes">{weekDates.map((date, dayIndex) => <div className="room-lane" key={toDateInputValue(date)}>{guideMinutes.map(minute => <span className="time-guide" key={minute} style={{ top: positionForMinute(minute) }} />)}{weeklyEvents[dayIndex].map(event => {
                const assistant = assistantForEvent(event, date)
                const openCard = () => {
                  if (event.source === 'admin') {
                    setSelectedCalendarEvent(event)
                    setConfirmCardDelete(false)
                    setAssistantAssignmentOpen(false)
                  } else if (assistant) openAbsenceFlow(event, date)
                  else if (!assistant) openUnassignedDuty(event, date)
                }
                return <article className={`calendar-event ${event.source}${event.id.startsWith('booking_') ? ' booking' : ''}${weeklyConflictingEventIds.has(event.id) ? ' conflict' : ''}${assistant?.isReliever ? ' has-reliever' : ''}${assistant?.isPending ? ' reliever-pending' : ''}${focusedEventKey === calendarEventKey(date, event) ? ' focus-highlight' : ''}`} data-calendar-event-key={calendarEventKey(date, event)} key={calendarEventKey(date, event)} style={{ top: positionForMinute(event.startMinutes), height: Math.max(positionForMinute(event.endMinutes) - positionForMinute(event.startMinutes), 28) }} title={`${event.courseCode} ${event.subject}\n${formatTime(event.startMinutes)}–${formatTime(event.endMinutes)}`} role="button" tabIndex={0} onClick={openCard} onKeyDown={keyEvent => { if (keyEvent.key === 'Enter' || keyEvent.key === ' ') { keyEvent.preventDefault(); openCard() } }}><strong>{event.courseCode || event.subject}</strong>{scheduleIdentifier(event) && <span>{scheduleIdentifier(event)}</span>}{instructorName(event) && <small className="calendar-instructor-name">{instructorName(event)}</small>}{assistant?.isPending ? <small className="calendar-assistant-name pending">Absent: {assistant.absentName}<br />SA: Reliever needed</small> : assistant ? <small className="calendar-assistant-name" title={assistant.fullName}>SA: {assistant.shortName}{assistant.isReliever && <b>RELIEVER</b>}</small> : assistantData.result && <small className="calendar-assistant-name pending">SA: None</small>}{event.source === 'admin' && <em className="calendar-edit-hint">click to edit</em>}</article>
              })}</div>)}</div>
            </div>
          </div>
        ) : (
          <div className="adaptive-timetable" style={timetableStyle}>
          <div className="adaptive-header">
            <div className="timetable-corner">Time</div>
            {displayedRooms.map(room => <div className="room-header" key={room}>{room}</div>)}
          </div>

          <div className="timeline-body">
            <div className="time-axis">
              {guideMinutes.map(minute => (
                <span
                  className={`time-axis-label${minute === rangeStart ? ' first' : ''}${minute === rangeEnd ? ' last' : ''}`}
                  key={minute}
                  style={{ top: positionForMinute(minute) }}
                >
                  {formatTime(minute)}
                </span>
              ))}
            </div>

            <div className="room-lanes">
              {displayedRooms.map(room => (
                <div className="room-lane" key={room}>
                  {guideMinutes.map(minute => (
                    <span
                      className="time-guide"
                      key={minute}
                      style={{ top: positionForMinute(minute) }}
                    />
                  ))}
                  {visibleEvents
                    .filter(event => event.room === room)
                    .map(event => {
                      const assistant = assistantForEvent(event, selectedDate)
                      const openCard = () => {
                        if (event.source === 'admin') {
                          setSelectedCalendarEvent(event)
                          setConfirmCardDelete(false)
                          setAssistantAssignmentOpen(false)
                        } else if (assistant) openAbsenceFlow(event, selectedDate)
                        else if (!assistant) openUnassignedDuty(event, selectedDate)
                      }
                      return <article
                        className={`calendar-event ${event.source}${event.id.startsWith('booking_') ? ' booking' : ''}${conflictingEventIds.has(event.id) ? ' conflict' : ''}${assistant?.isReliever ? ' has-reliever' : ''}${assistant?.isPending ? ' reliever-pending' : ''}${focusedEventKey === calendarEventKey(selectedDate, event) ? ' focus-highlight' : ''}`}
                        data-calendar-event-key={calendarEventKey(selectedDate, event)}
                        key={event.id}
                        style={{
                          top: positionForMinute(event.startMinutes),
                          height: Math.max(
                            positionForMinute(event.endMinutes) - positionForMinute(event.startMinutes),
                            28,
                          ),
                        }}
                        title={`${event.courseCode} ${event.subject}\n${formatTime(event.startMinutes)}–${formatTime(event.endMinutes)}`}
                        role="button"
                        tabIndex={0}
                        onClick={openCard}
                        onKeyDown={keyEvent => { if (keyEvent.key === 'Enter' || keyEvent.key === ' ') { keyEvent.preventDefault(); openCard() } }}
                      >
                        <strong>{event.courseCode || event.subject}</strong>
                        {scheduleIdentifier(event) && <span>{scheduleIdentifier(event)}</span>}
                        {instructorName(event) && <small className="calendar-instructor-name">{instructorName(event)}</small>}
                        {assistant?.isPending ? <small className="calendar-assistant-name pending">Absent: {assistant.absentName}<br />SA: Reliever needed</small> : assistant ? <small className="calendar-assistant-name" title={assistant.fullName}>SA: {assistant.shortName}{assistant.isReliever && <b>RELIEVER</b>}</small> : assistantData.result && <small className="calendar-assistant-name pending">SA: None</small>}
                        {event.source === 'admin' && <em className="calendar-edit-hint">click to edit</em>}
                      </article>
                    })}
                </div>
              ))}
            </div>
          </div>
          </div>
        )}
      </div>
      {csvName && displayedConflictCount > 0 && (
        <div className="schedule-warning-toggle">
          <button
            className="conflict-color-button"
            type="button"
            onClick={() => setShowConflictColors(current => !current)}
          >
            {showConflictColors ? 'Hide Conflict Colors' : 'Show Conflict Colors'}
          </button>
        </div>
      )}

      {unassignedDuty && (
        <div className="calendar-event-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setUnassignedDuty(null) }}>
          <section className="reliever-dialog" role="dialog" aria-modal="true" aria-labelledby="assign-duty-dialog-title">
            <div className="calendar-event-dialog-heading"><div><h3 id="assign-duty-dialog-title">Assign Student Assistant</h3><small>{unassignedDuty.event.courseCode || unassignedDuty.event.subject} · {formatTime(unassignedDuty.event.startMinutes)}–{formatTime(unassignedDuty.event.endMinutes)}</small></div><button type="button" aria-label="Close" onClick={() => setUnassignedDuty(null)}>×</button></div>
            <div className="reliever-proposal-list"><section className="reliever-proposal">
              {unassignedDuty.candidates.length === 0 ? <p className="reliever-none">No one available</p> : <label className="reliever-select">
                <span>Student Assistant</span>
                <select value={selectedDutyAssistantId} onChange={event => setSelectedDutyAssistantId(event.target.value)}>
                  {unassignedDuty.candidates.map((candidate, index) => <option value={candidate.assistant.id} key={candidate.assistant.id}>{abbreviatedAssistantName(candidate.assistant.label)}{candidate.weeklyMinutesAfter === unassignedDuty.event.endMinutes - unassignedDuty.event.startMinutes ? ' — 0 duty hours' : ''}{index === 0 ? ' — Recommended' : ''}</option>)}
                </select>
                <small>Available</small>
              </label>}
            </section></div>
            <div className="calendar-event-dialog-actions"><button className="btn-secondary" type="button" onClick={() => setUnassignedDuty(null)}>Cancel</button><button className="btn-primary" type="button" disabled={!selectedDutyAssistantId} onClick={assignRegularDuty}>Assign</button></div>
          </section>
        </div>
      )}

      {absenceDuty && relieverStep && (
        <div className="calendar-event-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) closeRelieverFlow() }}>
          <section className="reliever-dialog" role="dialog" aria-modal="true" aria-labelledby="reliever-dialog-title">
            {relieverStep === 'report' && <>
              <div className="calendar-event-dialog-heading"><div><h3 id="reliever-dialog-title">Find Reliever</h3><small>{absenceDuty.assignment.courseCode} · {formatTime(absenceDuty.assignment.startMinutes)}–{formatTime(absenceDuty.assignment.endMinutes)}</small></div><button type="button" aria-label="Close" onClick={closeRelieverFlow}>×</button></div>
              {relieverMessage && <p className="reliever-none" role="status">{relieverMessage}</p>}
              <div className="calendar-event-dialog-actions"><button className="btn-secondary" type="button" onClick={closeRelieverFlow}>Cancel</button><button className="btn-primary" type="button" onClick={findRelievers}>Find Reliever</button></div>
            </>}

            {relieverStep === 'assigned' && activeReliever?.replacementAssistantId && <>
              <div className="calendar-event-dialog-heading"><div><h3 id="reliever-dialog-title">Assigned Reliever</h3><small>{absenceDuty.assignment.courseCode} · {formatTime(absenceDuty.assignment.startMinutes)}–{formatTime(absenceDuty.assignment.endMinutes)}</small></div><button type="button" aria-label="Close" onClick={closeRelieverFlow}>×</button></div>
              <p>{abbreviatedAssistantName(activeReliever.replacementAssistantLabel ?? '')} is covering this duty.</p>
              <div className="calendar-event-dialog-actions"><button className="btn-danger" type="button" onClick={removeReliever}>Remove Reliever</button><button className="btn-primary" type="button" onClick={changeReliever}>Change Reliever</button></div>
            </>}

            {relieverStep === 'change' && <>
              <div className="calendar-event-dialog-heading"><div><h3 id="reliever-dialog-title">Change Reliever</h3><small>{absenceDuty.assignment.courseCode} · {formatTime(absenceDuty.assignment.startMinutes)}–{formatTime(absenceDuty.assignment.endMinutes)}</small></div><button type="button" aria-label="Close" onClick={closeRelieverFlow}>×</button></div>
              <div className="reliever-proposal-list"><section className="reliever-proposal">
                <label className="reliever-select"><span>Student Assistant</span><select value={selectedRelieverId} onChange={event => setSelectedRelieverId(event.target.value)}>{activeReliever?.replacementAssistantId && <option value={activeReliever.replacementAssistantId}>{abbreviatedAssistantName(activeReliever.replacementAssistantLabel ?? 'Current reliever')} — Assigned</option>}{changeRelieverCandidates.map((candidate, index) => <option value={candidate.assistant.id} key={candidate.assistant.id}>{abbreviatedAssistantName(candidate.assistant.label)}{index === 0 ? ' — Recommended' : ''}</option>)}</select></label>
                {changeRelieverCandidates.length === 0 && <p className="reliever-none">No other reliever available</p>}
              </section></div>
              <div className="calendar-event-dialog-actions"><button className="btn-secondary" type="button" onClick={() => setRelieverStep('assigned')}>Cancel</button><button className="btn-primary" type="button" disabled={!selectedRelieverId || selectedRelieverId === activeReliever?.replacementAssistantId} onClick={saveChangedReliever}>Save</button></div>
            </>}
          </section>
        </div>
      )}

      {selectedCalendarEvent && (
        <div className="calendar-event-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) { setSelectedCalendarEvent(null); setAssistantAssignmentOpen(false) } }}>
          <section className="calendar-event-dialog" role="dialog" aria-modal="true" aria-labelledby="calendar-event-dialog-title">
            {assistantAssignmentOpen ? <>
              <div className="calendar-event-dialog-heading"><h3 id="calendar-event-dialog-title">Add Student Assistant</h3><button type="button" onClick={() => setAssistantAssignmentOpen(false)}>Close</button></div>
              <div className="event-assistant-assignment">
                <label>Student Assistant<select value={selectedEventAssistantId} onChange={event => setSelectedEventAssistantId(event.target.value)}><option value="">Select a student assistant</option>{availableEventAssistants.map(assistant => <option value={assistant.id} key={assistant.id}>{abbreviatedAssistantName(assistant.label)}</option>)}</select></label>
                {assistantData.assistants.length === 0 && <p>No student assistants added.</p>}
                {assistantData.assistants.length > 0 && availableEventAssistants.length === 0 && <p>No student assistants are available at this date and time.</p>}
                <small>Assistants with a personal class, duty, reliever duty, or another event at the same time are not shown.</small>
              </div>
              <div className="calendar-event-dialog-actions">{selectedCalendarEvent.assistantId && <button className="btn-danger" type="button" onClick={removeEventAssistant}>Remove Assistant</button>}<button className="btn-secondary" type="button" onClick={() => setAssistantAssignmentOpen(false)}>Cancel</button><button className="btn-primary" type="button" disabled={!selectedEventAssistantAvailable} onClick={saveEventAssistant}>Save</button></div>
            </> : !confirmCardDelete ? <>
              <div className="calendar-event-dialog-heading"><h3 id="calendar-event-dialog-title">{selectedCalendarEvent.id.startsWith('booking_') ? 'Booking details' : 'Event details'}</h3><button type="button" onClick={() => { setSelectedCalendarEvent(null); setAssistantAssignmentOpen(false) }}>Close</button></div>
              <strong>{selectedCalendarEvent.courseCode}</strong>
              <dl><div><dt>Date</dt><dd>{selectedCalendarEvent.date}</dd></div><div><dt>Time</dt><dd>{formatTime(selectedCalendarEvent.startMinutes)}–{formatTime(selectedCalendarEvent.endMinutes)}</dd></div><div><dt>Room</dt><dd>{selectedCalendarEvent.room}</dd></div>{selectedCalendarEvent.assistantLabel && <div><dt>Assistant</dt><dd>{abbreviatedAssistantName(selectedCalendarEvent.assistantLabel)}</dd></div>}</dl>
              <div className="calendar-event-dialog-actions"><button className="btn-danger" type="button" onClick={() => setConfirmCardDelete(true)}>Delete</button><button className="btn-secondary" type="button" onClick={openAssistantAssignment}>Add Assistant</button><button className="btn-primary" type="button" onClick={() => openEventEditor(selectedCalendarEvent.id)}>Edit</button></div>
            </> : <>
              <div className="calendar-event-dialog-heading"><h3 id="calendar-event-dialog-title">Delete this card</h3></div>
              <p>Do you want to delete only this event card?</p>
              <div className="calendar-event-dialog-actions"><button className="btn-secondary" type="button" onClick={() => setConfirmCardDelete(false)}>No</button><button className="btn-danger" type="button" onClick={() => { onDeleteEvent(selectedCalendarEvent.id); setSelectedCalendarEvent(null); setConfirmCardDelete(false) }}>Yes</button></div>
            </>}
          </section>
        </div>
      )}
      {warningDrawer && <div className="calendar-warning-backdrop" role="presentation" onMouseDown={() => setWarningDrawer(null)}>
        <aside className={`calendar-warning-drawer ${warningDrawer}`} role="dialog" aria-modal="true" aria-labelledby="calendar-warning-title" onMouseDown={event => event.stopPropagation()}>
          <div className="calendar-warning-heading"><div><h3 id="calendar-warning-title">{warningDrawer === 'conflicts' ? 'Schedule Conflicts' : 'TBA Schedules'}</h3><small>{warningDrawer === 'conflicts' ? `${displayedConflictCount} ${displayedConflictCount === 1 ? 'conflict' : 'conflicts'}` : `${visibleTbaSubjects.length} schedules`}</small></div><button type="button" aria-label="Close warnings" onClick={() => setWarningDrawer(null)}>×</button></div>
          <div className="calendar-warning-content">
            {warningDrawer === 'conflicts' ? displayedConflictDays.length === 0 ? <p className="calendar-warning-empty">No schedule conflicts found.</p> : displayedConflictDays.map(day => <section className="calendar-conflict-day" key={toDateInputValue(day.date)}>
              <h4>{day.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</h4>
              {day.conflicts.map((conflict, index) => <button className="calendar-conflict-item" type="button" key={`${conflict.first.id}-${conflict.second.id}-${index}`} onClick={() => navigateToConflict(day.date, conflict.first)}>
                <strong>{conflict.first.room}</strong>
                <span>{conflictLabel(conflict.first)}</span>
                <small>{formatTime(conflict.first.startMinutes)}–{formatTime(conflict.first.endMinutes)}</small>
                <em>conflicts with</em>
                <span>{conflictLabel(conflict.second)}</span>
                <small>{formatTime(conflict.second.startMinutes)}–{formatTime(conflict.second.endMinutes)}</small>
                <small className="calendar-conflict-overlap">Overlap: {formatTime(conflict.overlapStart)}–{formatTime(conflict.overlapEnd)}</small>
              </button>)}
            </section>) : visibleTbaSubjects.length === 0 ? <p className="calendar-warning-empty">No TBA schedules found.</p> : <ul className="calendar-tba-list">{visibleTbaSubjects.map(subject => <li key={subject}>{subject}</li>)}</ul>}
          </div>
        </aside>
      </div>}
      {filterOpen && (
        <ScheduleFilter
          teachers={teachers}
          rooms={rooms}
          selectedTeachers={selectedTeachers}
          selectedRooms={selectedRooms}
          onApply={applyFilters}
          onClose={() => setFilterOpen(false)}
        />
      )}
    </section>
  )
}

function instructorName(event: CalendarEvent) {
  const lastName = event.lastName?.trim()
  const firstName = event.firstName?.trim()
  if (lastName && firstName) {
    const initial = Array.from(firstName).find(character => /\p{L}/u.test(character))
    return initial ? `${lastName}, ${initial.toLocaleUpperCase()}.` : lastName
  }

  const importedName = event.instructorLastName?.trim() ?? ''
  const [importedLastName, importedFirstName] = importedName.split(',').map(part => part.trim())
  if (!importedLastName || !importedFirstName) return importedName
  const initial = Array.from(importedFirstName).find(character => /\p{L}/u.test(character))
  return initial ? `${importedLastName}, ${initial.toLocaleUpperCase()}.` : importedLastName
}
