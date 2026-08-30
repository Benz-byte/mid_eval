import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ChangeEvent } from 'react'
import type { BookingEditScope, CalendarEvent, ScheduleConflict, UploadedAssistant } from '../../types'
import type { DutyAssignment, RelieverAssignment, StudentAssistantResult } from '../../api/studentAssistantApi'
import { matchesSelectedDay, toDateInputValue } from '../../formatters/dateFormatter'
import { formatTime } from '../../formatters/timeFormatter'
import { SCHEDULE_DATE_STORAGE_KEY, loadScheduleDate } from '../../storage/preferenceStorage'
import { loadLocalAssistantData, saveLocalAssistantData } from '../../storage/studentAssistantStorage'
import { ScheduleFilter, type ScheduleFilterOption } from './ScheduleFilter'

const DEFAULT_START = 7 * 60
const DEFAULT_END = 21 * 60
const TIME_ROW_HEIGHT = 48
const WEEKDAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const DATE_DAY_CODES = ['Su', 'M', 'T', 'W', 'Th', 'F', 'S']

type AbsenceScope = 'duty' | 'day'

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

interface RelieverProposal {
  duty: DutyContext
  candidates: RelieverCandidate[]
  selectedAssistantId: string
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

function hoursLabel(minutes: number) {
  return `${(minutes / 60).toFixed(1).replace(/\.0$/, '')} hours`
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
  onCsvUpload,
  onCsvRemove,
  onOpenEvents,
  onEditEvent,
  onDeleteEvent,
  onAssignAssistant,
}: {
  csvEvents: CalendarEvent[]
  adminEvents: CalendarEvent[]
  csvName: string
  tbaSubjects: string[]
  rooms: string[]
  onCsvUpload: (file: File) => Promise<void>
  onCsvRemove: () => void
  onOpenEvents: () => void
  onEditEvent: (eventId: string, scope?: BookingEditScope) => void
  onDeleteEvent: (eventId: string) => void
  onAssignAssistant: (eventId: string, assistantId?: string, assistantLabel?: string) => void
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
  const [assistantData, setAssistantData] = useState(loadLocalAssistantData)
  const [absenceDuty, setAbsenceDuty] = useState<DutyContext | null>(null)
  const [absenceScope, setAbsenceScope] = useState<AbsenceScope>('duty')
  const [relieverProposals, setRelieverProposals] = useState<RelieverProposal[]>([])
  const [relieverStep, setRelieverStep] = useState<'report' | 'select' | 'confirm' | 'none-found' | null>(null)
  const roomPickerRef = useRef<HTMLDivElement>(null)
  const dutyAssignments = assistantData.result?.assignments ?? []
  const relieverAssignments = assistantData.result?.relieverAssignments ?? []
  const assignmentForEvent = (event: CalendarEvent, date: Date) => dutyAssignments.find(value =>
    value.classId === event.id && value.day === DATE_DAY_CODES[date.getDay()],
  ) ?? dutyAssignments.find(value => value.classId === event.id)
  const relieverForEvent = (event: CalendarEvent, date: Date) => relieverAssignments.find(value =>
    value.classId === event.id
    && value.day === DATE_DAY_CODES[date.getDay()]
    && value.date === toDateInputValue(date),
  )
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
    if (allEvents.length === 0) return { rangeStart: DEFAULT_START, rangeEnd: DEFAULT_END }
    const earliest = Math.min(...allEvents.map(event => event.startMinutes))
    const latest = Math.max(...allEvents.map(event => event.endMinutes))
    return {
      rangeStart: Math.floor(earliest / 30) * 30,
      rangeEnd: Math.ceil(latest / 30) * 30,
    }
  }, [allEvents])

  const guideMinutes = useMemo(() => {
    const values = new Set<number>()
    for (let minute = rangeStart; minute <= rangeEnd; minute += 30) values.add(minute)
    allEvents.forEach(event => {
      values.add(event.startMinutes)
      values.add(event.endMinutes)
    })
    return [...values].filter(value => value >= rangeStart && value <= rangeEnd).sort((a, b) => a - b)
  }, [allEvents, rangeEnd, rangeStart])

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
    setAbsenceScope('duty')
    setRelieverProposals([])
    setRelieverStep(null)
  }

  const openAbsenceFlow = (event: CalendarEvent, date: Date) => {
    const assignment = assignmentForEvent(event, date)
    if (!assignment) return
    const existingReliever = relieverForEvent(event, date)
    if (existingReliever?.replacementAssistantId) return
    setAbsenceDuty({ event, date: new Date(date), assignment })
    setAbsenceScope('duty')
    setRelieverProposals([])
    setRelieverStep('report')
  }

  const effectiveIntervalsFor = (
    assistantId: string,
    date: Date,
    reserved: Array<{ assistantId: string, date: Date, start: number, end: number }>,
  ) => {
    const day = DATE_DAY_CODES[date.getDay()]
    const dateKey = toDateInputValue(date)
    const replacedClassIds = new Set(relieverAssignments.filter(record =>
      record.date === dateKey && record.day === day && record.originalAssistantId === assistantId,
    ).map(record => record.classId))
    const intervals = dutyAssignments
      .filter(assignment => assignment.assistantId === assistantId && assignment.day === day && !replacedClassIds.has(assignment.classId))
      .map(assignment => ({ start: assignment.startMinutes, end: assignment.endMinutes }))
    relieverAssignments.filter(record =>
      record.date === dateKey && record.replacementAssistantId === assistantId,
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
  ) => {
    let minutes = dutyAssignments
      .filter(assignment => assignment.assistantId === assistantId)
      .reduce((total, assignment) => total + assignment.endMinutes - assignment.startMinutes, 0)
    relieverAssignments.forEach(record => {
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
  ): RelieverCandidate[] => {
    const duration = duty.assignment.endMinutes - duty.assignment.startMinutes
    return assistantData.assistants
      .filter(assistant => assistant.id !== duty.assignment.assistantId)
      .flatMap(assistant => {
        const hasPersonalClassConflict = assistant.events.some(event =>
          matchesSelectedDay(event.dayCode, duty.date)
          && overlaps(duty.assignment.startMinutes, duty.assignment.endMinutes, event.startMinutes, event.endMinutes),
        )
        if (hasPersonalClassConflict) return []
        const currentIntervals = effectiveIntervalsFor(assistant.id, duty.date, reserved)
        if (currentIntervals.some(interval => overlaps(
          duty.assignment.startMinutes,
          duty.assignment.endMinutes,
          interval.start,
          interval.end,
        ))) return []
        const currentWeeklyMinutes = effectiveWeeklyMinutes(assistant.id, duty.date, reserved)
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

  const recordsForProposals = (proposals: RelieverProposal[]): RelieverAssignment[] => proposals.map(proposal => {
    const selected = proposal.candidates.find(candidate => candidate.assistant.id === proposal.selectedAssistantId)
    return {
      date: toDateInputValue(proposal.duty.date),
      classId: proposal.duty.assignment.classId,
      day: proposal.duty.assignment.day,
      startMinutes: proposal.duty.assignment.startMinutes,
      endMinutes: proposal.duty.assignment.endMinutes,
      courseCode: proposal.duty.assignment.courseCode,
      room: proposal.duty.assignment.room,
      originalAssistantId: proposal.duty.assignment.assistantId,
      originalAssistantLabel: proposal.duty.assignment.assistantLabel,
      replacementAssistantId: selected?.assistant.id,
      replacementAssistantLabel: selected?.assistant.label,
    }
  })

  const persistRelieverRecords = (records: RelieverAssignment[]) => {
    if (!assistantData.result) return
    const replacementKeys = new Set(records.map(record => `${record.date}|${record.day}|${record.classId}`))
    const nextResult: StudentAssistantResult = {
      ...assistantData.result,
      relieverAssignments: [
        ...relieverAssignments.filter(record => !replacementKeys.has(`${record.date}|${record.day}|${record.classId}`)),
        ...records,
      ],
    }
    const nextData = { ...assistantData, result: nextResult }
    setAssistantData(nextData)
    saveLocalAssistantData(nextData)
  }

  const findRelievers = () => {
    if (!absenceDuty) return
    const targets = absenceScope === 'day'
      ? dutyAssignments
        .filter(assignment => assignment.assistantId === absenceDuty.assignment.assistantId && assignment.day === absenceDuty.assignment.day)
        .map(assignment => ({
          assignment,
          date: new Date(absenceDuty.date),
          event: csvEvents.find(event => event.id === assignment.classId) ?? absenceDuty.event,
        }))
      : [absenceDuty]
    const uniqueTargets = [...new Map(targets.map(target => [
      `${target.assignment.classId}|${target.assignment.startMinutes}|${target.assignment.endMinutes}`,
      target,
    ])).values()].sort((left, right) => left.assignment.startMinutes - right.assignment.startMinutes)
    const reserved: Array<{ assistantId: string, date: Date, start: number, end: number }> = []
    const proposals = uniqueTargets.map(duty => {
      const candidates = rankRelievers(duty, reserved)
      const selectedAssistantId = candidates[0]?.assistant.id ?? ''
      if (selectedAssistantId) reserved.push({
        assistantId: selectedAssistantId,
        date: duty.date,
        start: duty.assignment.startMinutes,
        end: duty.assignment.endMinutes,
      })
      return { duty, candidates, selectedAssistantId }
    })
    setRelieverProposals(proposals)
    if (proposals.every(proposal => proposal.candidates.length === 0)) {
      persistRelieverRecords(recordsForProposals(proposals))
      setRelieverStep('none-found')
    } else {
      setRelieverStep('select')
    }
  }

  const selectRelieverCandidate = (proposalIndex: number, assistantId: string) => {
    setRelieverProposals(current => {
      const reserved: Array<{ assistantId: string, date: Date, start: number, end: number }> = []
      return current.map((proposal, index) => {
        const candidates = index > proposalIndex ? rankRelievers(proposal.duty, reserved) : proposal.candidates
        const selectedAssistantId = index < proposalIndex
          ? proposal.selectedAssistantId
          : index === proposalIndex
            ? assistantId
            : candidates[0]?.assistant.id ?? ''
        if (selectedAssistantId) reserved.push({
          assistantId: selectedAssistantId,
          date: proposal.duty.date,
          start: proposal.duty.assignment.startMinutes,
          end: proposal.duty.assignment.endMinutes,
        })
        return { ...proposal, candidates, selectedAssistantId }
      })
    })
  }

  const confirmRelievers = () => {
    persistRelieverRecords(recordsForProposals(relieverProposals))
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
          <button
            className={`schedule-filter-button${selectedTeachers.size > 0 || selectedRooms.size > 0 ? ' active' : ''}`}
            type="button"
            disabled={!csvName}
            aria-label="Filter schedule"
            onClick={openFilters}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 6h16M7 12h10M10 18h4" />
            </svg>
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

      {csvName && displayedRooms.length > 0 && <div className="calendar-view-room-row"><span aria-hidden="true" />{viewMode === 'weekly' ? <div className="weekly-room-navigation"><button type="button" disabled={displayedRooms.length < 2} onClick={() => moveWeeklyRoom(-1)} aria-label="Previous room">‹</button><div className="weekly-room-picker" ref={roomPickerRef}><button className="weekly-room-trigger" type="button" aria-haspopup="listbox" aria-expanded={roomPickerOpen} title="Choose room" onClick={() => setRoomPickerOpen(current => !current)}><span>{weeklyRoom}</span><span aria-hidden="true">{roomPickerOpen ? '▴' : '▾'}</span></button>{roomPickerOpen && <div className="weekly-room-menu" role="listbox" aria-label="Choose room">{displayedRooms.map(room => <button className={room === weeklyRoom ? 'selected' : ''} type="button" role="option" aria-selected={room === weeklyRoom} key={room} onClick={() => { setSelectedWeeklyRoom(room); setRoomPickerOpen(false) }}><span aria-hidden="true">{room === weeklyRoom ? '✓' : ''}</span><span>{room}</span></button>)}</div>}</div><button type="button" disabled={displayedRooms.length < 2} onClick={() => moveWeeklyRoom(1)} aria-label="Next room">›</button></div> : <span aria-hidden="true" />}<fieldset className="calendar-view-controls" aria-label="Schedule view"><label><input type="checkbox" checked={viewMode === 'daily'} onChange={() => { setViewMode('daily'); setRoomPickerOpen(false) }} />Daily</label><label><input type="checkbox" checked={viewMode === 'weekly'} onChange={() => setViewMode('weekly')} />Weekly</label></fieldset></div>}

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
                const isInteractive = event.source === 'admin' || Boolean(assistant && !assistant.isReliever)
                const openCard = () => {
                  if (event.source === 'admin') {
                    setSelectedCalendarEvent(event)
                    setConfirmCardDelete(false)
                    setAssistantAssignmentOpen(false)
                  } else if (assistant && !assistant.isReliever) openAbsenceFlow(event, date)
                }
                return <article className={`calendar-event ${event.source}${event.id.startsWith('booking_') ? ' booking' : ''}${weeklyConflictingEventIds.has(event.id) ? ' conflict' : ''}${assistant?.isReliever ? ' has-reliever' : ''}${assistant?.isPending ? ' reliever-pending' : ''}`} data-calendar-event-key={calendarEventKey(date, event)} key={calendarEventKey(date, event)} style={{ top: positionForMinute(event.startMinutes), height: Math.max(positionForMinute(event.endMinutes) - positionForMinute(event.startMinutes), 28) }} title={`${event.courseCode} ${event.subject}\n${formatTime(event.startMinutes)}–${formatTime(event.endMinutes)}`} role={isInteractive ? 'button' : undefined} tabIndex={isInteractive ? 0 : undefined} onClick={openCard} onKeyDown={keyEvent => { if (isInteractive && (keyEvent.key === 'Enter' || keyEvent.key === ' ')) openCard() }}><strong>{event.courseCode || event.subject}</strong>{scheduleIdentifier(event) && <span>{scheduleIdentifier(event)}</span>}{instructorName(event) && <small className="calendar-instructor-name">{instructorName(event)}</small>}{assistant?.isPending ? <small className="calendar-assistant-name pending">Absent: {assistant.absentName}<br />SA: Reliever needed</small> : assistant && <small className="calendar-assistant-name" title={assistant.fullName}>SA: {assistant.shortName}{assistant.isReliever && <b>RELIEVER</b>}</small>}{event.source === 'admin' && <em className="calendar-edit-hint">click to edit</em>}</article>
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
                      const isInteractive = event.source === 'admin' || Boolean(assistant && !assistant.isReliever)
                      const openCard = () => {
                        if (event.source === 'admin') {
                          setSelectedCalendarEvent(event)
                          setConfirmCardDelete(false)
                          setAssistantAssignmentOpen(false)
                        } else if (assistant && !assistant.isReliever) openAbsenceFlow(event, selectedDate)
                      }
                      return <article
                        className={`calendar-event ${event.source}${event.id.startsWith('booking_') ? ' booking' : ''}${conflictingEventIds.has(event.id) ? ' conflict' : ''}${assistant?.isReliever ? ' has-reliever' : ''}${assistant?.isPending ? ' reliever-pending' : ''}`}
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
                        role={isInteractive ? 'button' : undefined}
                        tabIndex={isInteractive ? 0 : undefined}
                        onClick={openCard}
                        onKeyDown={keyEvent => { if (isInteractive && (keyEvent.key === 'Enter' || keyEvent.key === ' ')) openCard() }}
                      >
                        <strong>{event.courseCode || event.subject}</strong>
                        {scheduleIdentifier(event) && <span>{scheduleIdentifier(event)}</span>}
                        {instructorName(event) && <small className="calendar-instructor-name">{instructorName(event)}</small>}
                        {assistant?.isPending ? <small className="calendar-assistant-name pending">Absent: {assistant.absentName}<br />SA: Reliever needed</small> : assistant && <small className="calendar-assistant-name" title={assistant.fullName}>SA: {assistant.shortName}{assistant.isReliever && <b>RELIEVER</b>}</small>}
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

      {absenceDuty && relieverStep && (
        <div className="calendar-event-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && relieverStep !== 'none-found') closeRelieverFlow() }}>
          <section className="reliever-dialog" role="dialog" aria-modal="true" aria-labelledby="reliever-dialog-title">
            {relieverStep === 'report' && <>
              <div className="calendar-event-dialog-heading"><h3 id="reliever-dialog-title">Report Student Assistant Absence</h3><button type="button" aria-label="Close" onClick={closeRelieverFlow}>×</button></div>
              <dl className="reliever-duty-details">
                <div><dt>Student Assistant</dt><dd>{absenceDuty.assignment.assistantLabel}</dd></div>
                <div><dt>Student ID</dt><dd>{assistantData.assistants.find(assistant => assistant.id === absenceDuty.assignment.assistantId)?.studentId || 'ID number unavailable'}</dd></div>
                <div><dt>Duty</dt><dd>{absenceDuty.assignment.courseCode} · {formatTime(absenceDuty.assignment.startMinutes)}–{formatTime(absenceDuty.assignment.endMinutes)}</dd></div>
              </dl>
              <fieldset className="reliever-scope"><legend>Absence applies to</legend><label><input type="radio" name="absence-scope" checked={absenceScope === 'duty'} onChange={() => setAbsenceScope('duty')} />This duty only</label><label><input type="radio" name="absence-scope" checked={absenceScope === 'day'} onChange={() => setAbsenceScope('day')} />This day</label></fieldset>
              <div className="calendar-event-dialog-actions"><button className="btn-secondary" type="button" onClick={closeRelieverFlow}>Cancel</button><button className="btn-primary" type="button" onClick={findRelievers}>Find Reliever</button></div>
            </>}

            {relieverStep === 'select' && <>
              <div className="calendar-event-dialog-heading"><div><h3 id="reliever-dialog-title">Select Reliever</h3><small>{absenceScope === 'day' ? absenceDuty.date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : `${absenceDuty.assignment.courseCode} · ${formatTime(absenceDuty.assignment.startMinutes)}–${formatTime(absenceDuty.assignment.endMinutes)}`}</small></div><button type="button" aria-label="Close" onClick={closeRelieverFlow}>×</button></div>
              <div className="reliever-proposal-list">{relieverProposals.map((proposal, proposalIndex) => <section className="reliever-proposal" key={`${proposal.duty.assignment.classId}-${proposal.duty.assignment.startMinutes}`}>
                {relieverProposals.length > 1 && <h4>{proposal.duty.assignment.courseCode} · {formatTime(proposal.duty.assignment.startMinutes)}–{formatTime(proposal.duty.assignment.endMinutes)}</h4>}
                {proposal.candidates.length === 0 ? <p className="reliever-none">No eligible reliever</p> : <div className="reliever-candidates">{proposal.candidates.map((candidate, index) => <label className={candidate.assistant.id === proposal.selectedAssistantId ? 'selected' : ''} key={candidate.assistant.id}><input type="radio" name={`reliever-${proposalIndex}`} checked={candidate.assistant.id === proposal.selectedAssistantId} onChange={() => selectRelieverCandidate(proposalIndex, candidate.assistant.id)} /><span><strong>{abbreviatedAssistantName(candidate.assistant.label)}</strong>{index === 0 && <b>Recommended</b>}<small>Weekly workload: {hoursLabel(candidate.weeklyMinutesAfter)} · Daily workload: {hoursLabel(candidate.dailyMinutesAfter)}{candidate.weeklyMinutesAfter > 20 * 60 ? ` · Overtime: ${hoursLabel(candidate.weeklyMinutesAfter - 20 * 60)}` : ''}</small><small>Available · No conflicts</small></span></label>)}</div>}
              </section>)}</div>
              <div className="calendar-event-dialog-actions"><button className="btn-secondary" type="button" onClick={() => setRelieverStep('report')}>Back</button><button className="btn-primary" type="button" disabled={!relieverProposals.some(proposal => proposal.selectedAssistantId)} onClick={() => setRelieverStep('confirm')}>Assign Reliever</button></div>
            </>}

            {relieverStep === 'confirm' && <>
              <div className="calendar-event-dialog-heading"><h3 id="reliever-dialog-title">Confirm Reliever Assignment</h3><button type="button" aria-label="Close" onClick={closeRelieverFlow}>×</button></div>
              <p>{relieverProposals.filter(proposal => proposal.selectedAssistantId).length === 1 ? 'Assign the selected Student Assistant as the reliever?' : 'Assign the selected Student Assistants as relievers?'}</p>
              <div className="reliever-confirm-list">{relieverProposals.map(proposal => {
                const candidate = proposal.candidates.find(item => item.assistant.id === proposal.selectedAssistantId)
                return <div key={`${proposal.duty.assignment.classId}-${proposal.duty.assignment.startMinutes}`}><strong>{proposal.duty.assignment.courseCode}</strong><span>{absenceDuty.date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })} · {formatTime(proposal.duty.assignment.startMinutes)}–{formatTime(proposal.duty.assignment.endMinutes)} · {proposal.duty.assignment.room}</span><small>{candidate ? `${abbreviatedAssistantName(candidate.assistant.label)} replaces ${abbreviatedAssistantName(proposal.duty.assignment.assistantLabel)}` : 'No eligible reliever'}</small></div>
              })}</div>
              <div className="calendar-event-dialog-actions"><button className="btn-secondary" type="button" onClick={() => setRelieverStep('select')}>Cancel</button><button className="btn-primary" type="button" onClick={confirmRelievers}>Confirm Assignment</button></div>
            </>}

            {relieverStep === 'none-found' && <>
              <div className="calendar-event-dialog-heading"><h3 id="reliever-dialog-title">No Eligible Reliever</h3><button type="button" aria-label="Close" onClick={closeRelieverFlow}>×</button></div>
              <p>No Student Assistant is available for this duty without violating a scheduling constraint.</p>
              <div className="calendar-event-dialog-actions"><button className="btn-secondary" type="button" onClick={closeRelieverFlow}>Close</button></div>
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
