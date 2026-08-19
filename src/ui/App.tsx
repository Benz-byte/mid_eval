import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ChangeEvent, FormEvent } from 'react'
import * as XLSX from 'xlsx'
import {
  isCloudConfigured,
  loadSharedSchedule,
  saveSharedSchedule,
  subscribeToSharedSchedule,
} from '../api/scheduleRepository'
import {
  deleteSharedAdminEvent,
  loadSharedAdminEvents,
  saveSharedAdminEvent,
  subscribeToSharedAdminEvents,
} from '../api/adminEventRepository'
import {
  solveStudentAssistantSchedule,
  type DutyAssignment,
  type StudentAssistantResult,
} from '../api/studentAssistantSolver'
import {
  loadSharedStudentAssistantData,
  saveSharedStudentAssistantData,
  subscribeToSharedStudentAssistantData,
} from '../api/studentAssistantRepository'
import type {
  AdminEventForm,
  CalendarEvent,
  ScheduleConflict,
  ScheduleImportResult,
  Tab,
} from './shared/scheduleTypes'
import {
  conflictLabel,
  createEmptyAdminForm,
  formatTime,
  matchesSelectedDay,
  parseInputTime,
  toDateInputValue,
} from './shared/scheduleTime'
import {
  ACTIVE_TAB_STORAGE_KEY,
  ADMIN_STORAGE_KEY,
  CSV_STORAGE_KEY,
  SCHEDULE_DATE_STORAGE_KEY,
  loadActiveTab,
  loadAdminEvents,
  loadCsvSchedule,
  loadScheduleDate,
} from './shared/scheduleStorage'
import {
  ASSISTANT_STORAGE_KEY,
  loadLocalAssistantData,
  type UploadedAssistant,
} from './features/student-assistants/studentAssistantStorage'
import './App.css'

const DEFAULT_ROOMS = [
  'MT102', 'MTAVR1', 'MTAVR2',
  'MTCL1', 'MTCL2', 'MTCL3', 'MTCL4', 'MTCL5', 'MTCL6', 'MTCL7', 'MTCL8',
  'SHSCL1', 'SHSCL2',
]
const DEFAULT_START = 7 * 60
const DEFAULT_END = 21 * 60
const TIME_ROW_HEIGHT = 48

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    const next = text[index + 1]

    if (character === '"') {
      if (quoted && next === '"') {
        field += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      row.push(field)
      field = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index += 1
      row.push(field)
      if (row.some(value => value.trim() !== '')) rows.push(row)
      row = []
      field = ''
    } else {
      field += character
    }
  }

  row.push(field)
  if (row.some(value => value.trim() !== '')) rows.push(row)
  return rows
}

function parseCsvTime(value: string): number | null {
  const normalized = normalizeField(value).toUpperCase()
  const meridiem = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/)
  if (meridiem) {
    let hour = Number(meridiem[1])
    const minute = Number(meridiem[2] ?? 0)
    if (hour < 1 || hour > 12 || minute > 59) return null
    if (hour === 12) hour = 0
    if (meridiem[3] === 'PM') hour += 12
    return hour * 60 + minute
  }

  const digits = normalized.replace(/\D/g, '')
  if (!digits) return null

  const numeric = Number(digits)
  let hour = Math.floor(numeric / 100)
  let minute = numeric % 100

  hour += Math.floor(minute / 60)
  minute %= 60

  const result = hour * 60 + minute
  return result >= 0 && result <= 24 * 60 ? result : null
}


function normalizeField(value = '') {
  return value.replace(/\u00a0/g, ' ').trim()
}

type ScheduleField = 'course' | 'subject' | 'start' | 'end' | 'time' | 'day' | 'room'
  | 'instructor' | 'section' | 'classType' | 'students'
type ColumnMap = Partial<Record<ScheduleField, number>>

const HEADER_ALIASES: Record<ScheduleField, string[]> = {
  course: ['course', 'coursecode', 'courseno', 'subjectcode', 'codeanddescription'],
  subject: ['subject', 'description', 'coursetitle', 'title'],
  start: ['start', 'starttime', 'timefrom', 'from'],
  end: ['end', 'endtime', 'timeto', 'to'],
  time: ['time', 'schedule', 'classhours', 'hours'],
  day: ['day', 'days', 'weekday'],
  room: ['room', 'venue', 'classroom'],
  instructor: ['teacher', 'instructor', 'faculty', 'professor', 'name'],
  section: ['section', 'block', 'classsection'],
  classType: ['type', 'classtype', 'component', 'lecturelab'],
  students: ['students', 'studentcount', 'enrolled', 'classsize'],
}

function normalizedHeader(value: string) {
  return normalizeField(value).toLowerCase().replace(/[^a-z0-9]/g, '')
}

function headerField(value: string): ScheduleField | null {
  const header = normalizedHeader(value)
  if (!header) return null
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as [ScheduleField, string[]][]) {
    if (aliases.some(alias => header === alias || (alias.length >= 5 && header.includes(alias)))) return field
  }
  return null
}

function detectHeader(rows: string[][]): { rowIndex: number; columns: ColumnMap } | null {
  let best: { rowIndex: number; columns: ColumnMap; score: number } | null = null
  rows.slice(0, 50).forEach((row, rowIndex) => {
    const columns: ColumnMap = {}
    row.forEach((value, columnIndex) => {
      const field = headerField(value)
      if (field && columns[field] === undefined) columns[field] = columnIndex
    })
    const score = Object.keys(columns).length
    const hasTime = columns.time !== undefined || (columns.start !== undefined && columns.end !== undefined)
    if (score >= 3 && hasTime && (!best || score > best.score)) best = { rowIndex, columns, score }
  })
  return best
}

function normalizeDayCode(value: string): string | null {
  const compact = normalizeField(value).replace(/[\s,/-]+/g, '').toLowerCase()
  const names: Record<string, string> = {
    monday: 'M', mon: 'M', tuesday: 'T', tue: 'T', tues: 'T',
    wednesday: 'W', wed: 'W', thursday: 'Th', thu: 'Th', thurs: 'Th',
    friday: 'F', fri: 'F', saturday: 'S', sat: 'S', sunday: 'Su', sun: 'Su',
  }
  if (names[compact]) return names[compact]
  if (/^(?:m|t|w|th|f|s|su)+$/i.test(compact)) {
    return compact.replace(/th/gi, 'Th').replace(/su/gi, 'Su').replace(/[mtwfs]/gi, match => match.toUpperCase())
  }
  return null
}

function looksLikeClock(value: string) {
  const compact = normalizeField(value)
  if (!/^(?:\d{1,2}:?\d{2})(?:\s*[AP]M)?$/i.test(compact)) return false
  const minutes = parseCsvTime(compact)
  return minutes !== null && minutes <= 24 * 60
}

function inferColumns(rows: string[][]): ColumnMap {
  const width = Math.max(0, ...rows.map(row => row.length))
  const data = rows.filter(row => row.filter(value => normalizeField(value)).length >= 3)
  const values = (column: number) => data.map(row => normalizeField(row[column])).filter(Boolean)
  const ratio = (column: number, predicate: (value: string) => boolean) => {
    const candidates = values(column)
    return candidates.length ? candidates.filter(predicate).length / candidates.length : 0
  }
  const bestColumn = (predicate: (value: string) => boolean, excluded = new Set<number>()) => {
    let best = -1
    let bestScore = 0
    for (let column = 0; column < width; column += 1) {
      if (excluded.has(column)) continue
      const score = ratio(column, predicate)
      if (score > bestScore) [best, bestScore] = [column, score]
    }
    return bestScore >= 0.35 ? best : undefined
  }

  const columns: ColumnMap = {}
  columns.time = bestColumn(value => /^\s*\d{1,4}(?::\d{2})?\s*[-–—]\s*\d{1,4}(?::\d{2})?/i.test(value))
  columns.day = bestColumn(value => normalizeDayCode(value) !== null)
  columns.course = bestColumn(value => /[A-Za-z]{2,}\s*\d{2,}/.test(value))

  if (columns.time === undefined) {
    let bestPair: [number, number] | null = null
    let bestScore = 0
    for (let start = 0; start < width; start += 1) {
      for (let end = 0; end < width; end += 1) {
        if (start === end) continue
        const comparable = data.filter(row => looksLikeClock(row[start]) && looksLikeClock(row[end]))
        if (!comparable.length) continue
        const valid = comparable.filter(row => {
          const from = parseCsvTime(row[start]) ?? -1
          const to = parseCsvTime(row[end]) ?? -1
          return to > from && to - from <= 12 * 60
        }).length
        const score = valid / Math.max(comparable.length, data.length * 0.5)
        if (score > bestScore) [bestPair, bestScore] = [[start, end], score]
      }
    }
    if (bestPair && bestScore >= 0.35) [columns.start, columns.end] = bestPair
  }

  const excluded = new Set(Object.values(columns).filter((value): value is number => value !== undefined))
  columns.classType = bestColumn(value => /^(LEC|LAB|LECTURE|LABORATORY|SEM|PRACTICUM)$/i.test(value), excluded)
  if (columns.classType !== undefined) excluded.add(columns.classType)
  columns.instructor = bestColumn(value => /^[\p{L}.' -]+,\s*[\p{L}.' -]+$/u.test(value), excluded)
  if (columns.instructor !== undefined) excluded.add(columns.instructor)
  columns.section = bestColumn(value => /^(?:(?:BS|AB|BA|B)[A-Z]{1,8}\s*\d+(?:[-–]\d+)?|[A-Z0-9]+(?:-[A-Z0-9]+){2,})$/i.test(value), excluded)
  if (columns.section !== undefined) excluded.add(columns.section)
  columns.room = bestColumn(value => /^(?=.*[A-Z])(?=.*\d)[A-Z]{1,10}[A-Z0-9-]{1,12}$/i.test(value), excluded)
  return columns
}

function splitTimeRange(value: string): [number | null, number | null] {
  const [start, end] = normalizeField(value).split(/[-–—]/, 2)
  return [parseCsvTime(start ?? ''), parseCsvTime(end ?? '')]
}

function scheduleRowsToEvents(rows: string[][]): ScheduleImportResult {
  const normalizedRows = rows.map(row => row.map(value => normalizeField(value)))
  const header = detectHeader(normalizedRows)
  const inferred = inferColumns(header ? normalizedRows.slice(header.rowIndex + 1) : normalizedRows)
  const columns: ColumnMap = { ...inferred, ...(header?.columns ?? {}) }
  const hasTimes = columns.time !== undefined || (columns.start !== undefined && columns.end !== undefined)
  if (!hasTimes || columns.day === undefined || columns.room === undefined || (columns.course === undefined && columns.subject === undefined)) {
    return { events: [], tbaSubjects: [] }
  }

  const events: CalendarEvent[] = []
  const tbaSubjects = new Set<string>()
  let groupedSection = ''
  normalizedRows.slice((header?.rowIndex ?? -1) + 1).forEach((row, offset) => {
    const sectionLabelIndex = row.findIndex(value => normalizedHeader(value) === 'section')
    if (sectionLabelIndex >= 0) {
      groupedSection = [...row].reverse().find(value => value && normalizedHeader(value) !== 'section') ?? groupedSection
      return
    }

    let startMinutes: number | null
    let endMinutes: number | null
    if (columns.time !== undefined) {
      [startMinutes, endMinutes] = splitTimeRange(row[columns.time] ?? '')
    } else {
      startMinutes = parseCsvTime(row[columns.start!] ?? '')
      endMinutes = parseCsvTime(row[columns.end!] ?? '')
    }

    const rawDay = normalizeField(row[columns.day!] ?? '')
    const dayCode = normalizeDayCode(rawDay)
    const room = normalizeField(row[columns.room!] ?? '')
    let courseCode = normalizeField(row[columns.course ?? -1] ?? '')
    let classType = normalizeField(row[columns.classType ?? -1] ?? '')
    const embeddedType = courseCode.match(/^(.*?)\s+-\s+(LEC|LAB|LECTURE|LABORATORY|SEM|PRACTICUM)$/i)
    if (embeddedType) {
      courseCode = normalizeField(embeddedType[1])
      if (!classType) classType = normalizeField(embeddedType[2])
    }

    const isTba = rawDay.toUpperCase() === 'TBA' || room.toUpperCase() === 'TBA'
      || (startMinutes === 0 && endMinutes === 0)
    if (courseCode && isTba) {
      tbaSubjects.add(normalizeField(row[columns.subject ?? -1] ?? '') || courseCode)
      return
    }
    if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes || !dayCode) return
    if (!courseCode && columns.subject === undefined) return
    if (!room || room.toUpperCase() === 'TBA') return

    const index = offset + ((header?.rowIndex ?? -1) + 1)
    events.push({
      id: `import-${index}-${courseCode}-${dayCode}-${startMinutes}`,
      source: 'csv',
      courseCode,
      subject: normalizeField(row[columns.subject ?? -1] ?? ''),
      startMinutes,
      endMinutes,
      dayCode,
      classType,
      section: normalizeField(row[columns.section ?? -1] ?? '') || groupedSection,
      room,
      studentCount: normalizeField(row[columns.students ?? -1] ?? ''),
      instructorLastName: normalizeField(row[columns.instructor ?? -1] ?? ''),
    })
  })
  return { events, tbaSubjects: [...tbaSubjects] }
}

async function readScheduleFile(file: File): Promise<ScheduleImportResult> {
  if (/\.csv$/i.test(file.name)) {
    return scheduleRowsToEvents(parseCsv(await file.text()))
  }

  if (/\.xlsx?$/i.test(file.name)) {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    return workbook.SheetNames.reduce<ScheduleImportResult>((result, sheetName) => {
      const rows = XLSX.utils.sheet_to_json<(string | number | boolean)[]>(workbook.Sheets[sheetName], {
        header: 1,
        raw: false,
        defval: '',
      })
      const parsed = scheduleRowsToEvents(rows.map(row => row.map(value => String(value))))
      result.events.push(...parsed.events)
      parsed.tbaSubjects.forEach(subject => {
        if (!result.tbaSubjects.includes(subject)) result.tbaSubjects.push(subject)
      })
      return result
    }, { events: [], tbaSubjects: [] })
  }

  throw new Error('Choose a CSV, XLS, or XLSX schedule file.')
}


function ScheduleCalendar({
  csvEvents,
  adminEvents,
  csvName,
  tbaSubjects,
  rooms,
  onCsvUpload,
  onCsvRemove,
  onOpenEvents,
}: {
  csvEvents: CalendarEvent[]
  adminEvents: CalendarEvent[]
  csvName: string
  tbaSubjects: string[]
  rooms: string[]
  onCsvUpload: (file: File) => Promise<void>
  onCsvRemove: () => void
  onOpenEvents: () => void
}) {
  const [selectedDate, setSelectedDate] = useState(loadScheduleDate)
  const [uploadError, setUploadError] = useState('')
  const [isFullView, setIsFullView] = useState(false)
  const [fullViewZoom, setFullViewZoom] = useState(1)
  const [showConflictColors, setShowConflictColors] = useState(true)
  const selectedDateKey = toDateInputValue(selectedDate)

  useEffect(() => {
    localStorage.setItem(SCHEDULE_DATE_STORAGE_KEY, selectedDateKey)
  }, [selectedDateKey])

  const allEvents = useMemo(() => [...csvEvents, ...adminEvents], [csvEvents, adminEvents])
  const visibleEvents = useMemo(
    () => allEvents.filter(event =>
      event.source === 'csv'
        ? matchesSelectedDay(event.dayCode, selectedDate)
        : event.date === selectedDateKey,
    ),
    [allEvents, selectedDate, selectedDateKey],
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

  const rowHeight = isFullView
    ? Math.max(18, Math.floor((window.innerHeight - 130) / Math.max(guideMinutes.length - 1, 1)))
    : TIME_ROW_HEIGHT
  const positionForMinute = (minute: number) => {
    const index = guideMinutes.indexOf(minute)
    return Math.max(index, 0) * rowHeight
  }
  const timelineHeight = Math.max((guideMinutes.length - 1) * rowHeight, rowHeight)
  const timetableStyle = {
    '--room-count': rooms.length,
    '--timeline-height': `${timelineHeight}px`,
    '--timetable-width': `${96 + rooms.length * 145}px`,
  } as CSSProperties

  const moveDate = (days: number) => {
    setSelectedDate(current => {
      const next = new Date(current)
      next.setDate(next.getDate() + days)
      return next
    })
  }

  const selectDate = (value: string) => {
    if (!value) return
    const [year, month, day] = value.split('-').map(Number)
    setSelectedDate(new Date(year, month - 1, day))
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

  return (
    <section
      className={`schedule-calendar${isFullView ? ' calendar-full-view' : ''}${showConflictColors ? '' : ' hide-conflict-colors'}`}
      style={{ '--full-view-zoom': fullViewZoom } as CSSProperties}
    >
      <div className="calendar-toolbar">
        <div className="calendar-nav">
          <button type="button" onClick={() => moveDate(-1)} aria-label="Previous date">←</button>
          <button type="button" onClick={() => setSelectedDate(new Date())}>Today</button>
          <button type="button" onClick={() => moveDate(1)} aria-label="Next date">→</button>
        </div>

        <h2>
          {selectedDate.toLocaleDateString(undefined, {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </h2>

        <div className="calendar-actions">
          <button
            className="full-view-button"
            type="button"
            onClick={() => setIsFullView(current => !current)}
          >
            {isFullView ? 'Exit Full View' : 'Full View'}
          </button>
          {isFullView && (
            <div className="full-view-zoom" aria-label="Full view zoom controls">
              <button
                type="button"
                aria-label="Zoom out"
                disabled={fullViewZoom <= 0.6}
                onClick={() => setFullViewZoom(current => Math.max(0.6, current - 0.1))}
              >−</button>
              <button type="button" aria-label="Reset zoom" onClick={() => setFullViewZoom(1)}>
                {Math.round(fullViewZoom * 100)}%
              </button>
              <button
                type="button"
                aria-label="Zoom in"
                disabled={fullViewZoom >= 1.4}
                onClick={() => setFullViewZoom(current => Math.min(1.4, current + 0.1))}
              >+</button>
            </div>
          )}
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
          <button className="btn-primary" type="button" onClick={onOpenEvents}>
            Add / Manage Events
          </button>
          {csvName && (
            <button className="remove-csv-button" type="button" onClick={onCsvRemove}>
              Remove CSV
            </button>
          )}
        </div>
      </div>

      <div className="calendar-summary">
        <span>{csvName || 'No CSV uploaded'}</span>
      </div>
      {uploadError && <p className="msg-error">{uploadError}</p>}
      {showConflictColors && (conflicts.length > 0 || tbaSubjects.length > 0) && (
        <div className="schedule-notices">
          {conflicts.length > 0 && (
            <section className="conflict-panel" aria-label="Schedule conflicts">
              <h3>Conflict - {selectedDate.toLocaleDateString(undefined, { weekday: 'long' })}</h3>
              <ul>
                {conflictGroups.map(group => (
                  <li key={group.room}>
                    {group.room}
                    <ul>
                      {group.events.map(event => (
                        <li key={event.id}>
                          {conflictLabel(event)}, {formatTime(event.startMinutes)}–{formatTime(event.endMinutes)}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {tbaSubjects.length > 0 && (
            <section className="tba-panel" aria-label="TBA schedules">
              <h3>TBA Schedules</h3>
              <ul>
                {tbaSubjects.map(subject => <li key={subject}>{subject}</li>)}
              </ul>
            </section>
          )}
        </div>
      )}

      <div className="timetable-scroll">
        <div className="adaptive-timetable" style={timetableStyle}>
          <div className="adaptive-header">
            <div className="timetable-corner">Time</div>
            {rooms.map(room => <div className="room-header" key={room}>{room}</div>)}
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
              {rooms.map(room => (
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
                    .map(event => (
                      <article
                        className={`calendar-event ${event.source}${conflictingEventIds.has(event.id) ? ' conflict' : ''}`}
                        key={event.id}
                        style={{
                          top: positionForMinute(event.startMinutes),
                          height: Math.max(
                            positionForMinute(event.endMinutes) - positionForMinute(event.startMinutes),
                            28,
                          ),
                        }}
                        title={`${event.courseCode} ${event.subject}\n${formatTime(event.startMinutes)}–${formatTime(event.endMinutes)}`}
                      >
                        <div className="full-view-event-details">
                          <b>{event.subject || event.courseCode}</b>
                          {event.section && <span>{event.section}</span>}
                          {event.instructorLastName && <span>{event.instructorLastName}</span>}
                        </div>
                        <strong>{event.courseCode || event.subject}</strong>
                        {event.courseCode && event.subject && <span>{event.subject}</span>}
                        <small>
                          {formatTime(event.startMinutes)}–{formatTime(event.endMinutes)}
                          {event.instructorLastName && ` · ${event.instructorLastName}`}
                        </small>
                        <small>
                          {[event.section, event.classType, event.studentCount && `${event.studentCount} students`]
                            .filter(Boolean)
                            .join(' · ')}
                        </small>
                      </article>
                    ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {(conflicts.length > 0 || tbaSubjects.length > 0) && (
        <div className="schedule-warning-toggle">
          <button
            className="conflict-color-button"
            type="button"
            onClick={() => setShowConflictColors(current => !current)}
          >
            {showConflictColors ? 'Hide Conflict and TBA' : 'Show Conflict and TBA'}
          </button>
        </div>
      )}
    </section>
  )
}

function AdminEventsPanel({
  events,
  csvEvents,
  rooms,
  onSave,
  onDelete,
}: {
  events: CalendarEvent[]
  csvEvents: CalendarEvent[]
  rooms: string[]
  onSave: (form: AdminEventForm, editingId: string | null) => void
  onDelete: (id: string) => void
}) {
  const [form, setForm] = useState<AdminEventForm>(() => createEmptyAdminForm())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const requestedStart = parseInputTime(form.startTime)
  const requestedEnd = parseInputTime(form.endTime)
  const hasValidTimeRange = requestedEnd > requestedStart

  const availableRooms = useMemo(() => {
    if (!hasValidTimeRange) return []
    const requestedDate = new Date(`${form.date}T12:00:00`)

    return rooms.filter(room => !room.toUpperCase().startsWith('SHS')).filter(room => {
      const hasCsvConflict = csvEvents.some(event =>
        event.room === room &&
        matchesSelectedDay(event.dayCode, requestedDate) &&
        event.startMinutes < requestedEnd &&
        event.endMinutes > requestedStart,
      )
      const hasAdminConflict = events.some(event =>
        event.id !== editingId &&
        event.room === room &&
        event.date === form.date &&
        event.startMinutes < requestedEnd &&
        event.endMinutes > requestedStart,
      )
      return !hasCsvConflict && !hasAdminConflict
    })
  }, [
    csvEvents,
    editingId,
    events,
    form.date,
    hasValidTimeRange,
    requestedEnd,
    requestedStart,
    rooms,
  ])

  const updateField = (field: keyof AdminEventForm, value: string) => {
    setForm(current => ({
      ...current,
      [field]: value,
      ...(field === 'date' || field === 'startTime' || field === 'endTime' ? { room: '' } : {}),
    }))
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (parseInputTime(form.endTime) <= parseInputTime(form.startTime)) {
      setError('End time must be later than start time.')
      return
    }
    if (!form.room || !availableRooms.includes(form.room)) {
      setError('Select one of the available rooms.')
      return
    }
    onSave(form, editingId)
    setEditingId(null)
    setForm(createEmptyAdminForm(form.date))
  }

  const startEditing = (event: CalendarEvent) => {
    setEditingId(event.id)
    setForm({
      title: event.courseCode,
      date: event.date ?? toDateInputValue(new Date()),
      room: event.room,
      startTime: `${String(Math.floor(event.startMinutes / 60)).padStart(2, '0')}:${String(event.startMinutes % 60).padStart(2, '0')}`,
      endTime: `${String(Math.floor(event.endMinutes / 60)).padStart(2, '0')}:${String(event.endMinutes % 60).padStart(2, '0')}`,
    })
  }

  return (
    <section className="event-panel">
      <div className="event-panel-heading">
        <div>
          <h2>{editingId ? 'Edit Event' : 'Add Event'}</h2>
          <p>Enter the event time, choose a vacant room, and save.</p>
        </div>
      </div>

      {error && <p className="msg-error">{error}</p>}
      <form className="event-form" onSubmit={submit}>
        <label>Event name<input required value={form.title} onChange={event => updateField('title', event.target.value)} /></label>
        <label>Date<input required type="date" value={form.date} onChange={event => updateField('date', event.target.value)} /></label>
        <label>Start<input required type="time" value={form.startTime} onChange={event => updateField('startTime', event.target.value)} /></label>
        <label>End<input required type="time" value={form.endTime} onChange={event => updateField('endTime', event.target.value)} /></label>

        <fieldset className="vacant-room-picker">
          <legend>Vacant rooms</legend>
          {!hasValidTimeRange && <p>Choose an end time later than the start time.</p>}
          {hasValidTimeRange && availableRooms.length === 0 && <p>No rooms are vacant for the complete time period.</p>}
          {availableRooms.map(room => (
            <button
              className={form.room === room ? 'selected' : ''}
              type="button"
              key={room}
              onClick={() => updateField('room', room)}
            >
              {room}
            </button>
          ))}
        </fieldset>

        <div className="event-form-actions">
          <button className="btn-primary" type="submit">{editingId ? 'Save Changes' : 'Save Event'}</button>
          {editingId && (
            <button
              className="btn-secondary"
              type="button"
              onClick={() => {
                setEditingId(null)
                setForm(createEmptyAdminForm(form.date))
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="admin-event-list">
        <h3>Admin Events</h3>
        {events.length === 0 && <p className="empty-state">No admin events yet.</p>}
        {events.map(event => (
          <article className="admin-event-card" key={event.id}>
            <div>
              <strong>{event.courseCode}</strong>
              <span>{event.date} · {event.room} · {formatTime(event.startMinutes)}–{formatTime(event.endMinutes)}</span>
              {event.instructorLastName && <small>Instructor: {event.instructorLastName}</small>}
            </div>
            <div>
              <button type="button" className="btn-secondary" onClick={() => startEditing(event)}>Edit</button>
              <button type="button" className="btn-danger" onClick={() => onDelete(event.id)}>Delete</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

const DAY_SORT: Record<string, number> = {
  M: 0, T: 1, W: 2, Th: 3, F: 4, S: 5, Su: 6,
}
const WEEK_DAYS = [
  { code: 'M', label: 'Monday' },
  { code: 'T', label: 'Tuesday' },
  { code: 'W', label: 'Wednesday' },
  { code: 'Th', label: 'Thursday' },
  { code: 'F', label: 'Friday' },
  { code: 'S', label: 'Saturday' },
  { code: 'Su', label: 'Sunday' },
] as const

function expandedDayCodes(dayCode = '') {
  if (dayCode === 'MW') return ['M', 'W']
  if (dayCode === 'TTh') return ['T', 'Th']
  return [dayCode]
}

function AssistantWeeklyCalendar({
  assistant,
  assignments,
}: {
  assistant: UploadedAssistant
  assignments: DutyAssignment[]
}) {
  const personalClasses = assistant.events.flatMap(event =>
    expandedDayCodes(event.dayCode).map(day => ({ ...event, day })),
  )
  const allPeriods = [...personalClasses, ...assignments]
  const rangeStart = allPeriods.length
    ? Math.floor(Math.min(...allPeriods.map(item => item.startMinutes)) / 60) * 60
    : DEFAULT_START
  const rangeEnd = allPeriods.length
    ? Math.ceil(Math.max(...allPeriods.map(item => item.endMinutes)) / 60) * 60
    : DEFAULT_END
  const pixelsPerHour = 64
  const calendarHeight = Math.max(((rangeEnd - rangeStart) / 60) * pixelsPerHour, pixelsPerHour)
  const position = (minutes: number) => ((minutes - rangeStart) / 60) * pixelsPerHour
  const hourLabels: number[] = []
  for (let minute = rangeStart; minute <= rangeEnd; minute += 60) hourLabels.push(minute)

  return (
    <div className="sa-weekly-calendar">
      <div className="sa-week-header">
        <div className="sa-week-corner">Time</div>
        {WEEK_DAYS.map(day => <div key={day.code}>{day.label}</div>)}
      </div>
      <div className="sa-week-body" style={{ '--sa-calendar-height': `${calendarHeight}px` } as CSSProperties}>
        <div className="sa-week-time-axis">
          {hourLabels.map(minute => (
            <span key={minute} style={{ top: position(minute) }}>{formatTime(minute)}</span>
          ))}
        </div>
        {WEEK_DAYS.map(day => (
          <div className="sa-day-lane" key={day.code}>
            {hourLabels.map(minute => (
              <span className="sa-hour-line" key={minute} style={{ top: position(minute) }} />
            ))}
            {personalClasses.filter(item => item.day === day.code).map(item => (
              <article
                className="sa-calendar-block personal"
                key={`personal-${item.id}-${day.code}`}
                style={{
                  top: position(item.startMinutes),
                  height: Math.max(position(item.endMinutes) - position(item.startMinutes), 28),
                }}
                title={`Personal class: ${item.courseCode || item.subject}`}
              >
                <small className="sa-block-label">Personal Class</small>
                <strong>{item.courseCode || item.subject || 'Personal class'}</strong>
                <span>Room: {item.room || 'TBA'}</span>
                <small>{formatTime(item.startMinutes)}–{formatTime(item.endMinutes)}</small>
              </article>
            ))}
            {assignments.filter(item => item.day === day.code).map((item, index) => (
              <article
                className="sa-calendar-block duty"
                key={`duty-${item.classId}-${item.startMinutes}-${index}`}
                style={{
                  top: position(item.startMinutes),
                  height: Math.max(position(item.endMinutes) - position(item.startMinutes), 28),
                }}
                title={`Duty: ${item.courseCode || item.subject} in ${item.room}`}
              >
                <small className="sa-block-label">Duty</small>
                <strong>{item.courseCode || item.subject || 'Duty'}</strong>
                <span>Room: {item.room || 'TBA'}</span>
                <small>{formatTime(item.startMinutes)}–{formatTime(item.endMinutes)}</small>
              </article>
            ))}
          </div>
        ))}
      </div>
      <div className="sa-calendar-legend">
        <span><i className="personal" /> Personal class</span>
        <span><i className="duty" /> Assigned duty</span>
      </div>
    </div>
  )
}

function StudentAssistantPanel({
  mainSchedule,
  mainScheduleName,
}: {
  mainSchedule: CalendarEvent[]
  mainScheduleName: string
}) {
  const localAssistantData = useMemo(() => loadLocalAssistantData(), [])
  const [assistants, setAssistants] = useState<UploadedAssistant[]>(localAssistantData.assistants)
  const [result, setResult] = useState<StudentAssistantResult | null>(localAssistantData.result)
  const [error, setError] = useState('')
  const [solving, setSolving] = useState(false)
  const [selectedAssistantId, setSelectedAssistantId] = useState('')
  const [, setSyncMessage] = useState('Loading saved assistants…')

  useEffect(() => {
    let cancelled = false

    const refresh = async () => {
      try {
        const saved = await loadSharedStudentAssistantData<
          UploadedAssistant,
          StudentAssistantResult
        >()
        if (cancelled) return
        if (saved) {
          setAssistants(saved.assistants)
          setResult(saved.solverResult)
          localStorage.setItem(ASSISTANT_STORAGE_KEY, JSON.stringify({
            assistants: saved.assistants,
            result: saved.solverResult,
          }))
          setSyncMessage('Student assistant data synchronized')
        } else {
          setSyncMessage(isCloudConfigured ? 'No saved assistant schedule' : 'Local session only')
        }
      } catch (syncError) {
        console.warn('Could not load student assistant data.', syncError)
        if (!cancelled) setSyncMessage('Assistant database unavailable')
      }
    }

    void refresh()
    const unsubscribe = subscribeToSharedStudentAssistantData(() => {
      void refresh()
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const saveAssistantData = (
    nextAssistants: UploadedAssistant[],
    nextResult: StudentAssistantResult | null,
  ) => {
    localStorage.setItem(ASSISTANT_STORAGE_KEY, JSON.stringify({
      assistants: nextAssistants,
      result: nextResult,
    }))
    setSyncMessage(isCloudConfigured ? 'Saving assistant data…' : 'Local session only')
    void saveSharedStudentAssistantData({
      assistants: nextAssistants,
      solverResult: nextResult,
    }).then(() => {
      setSyncMessage(isCloudConfigured ? 'Student assistant data synchronized' : 'Local session only')
    }).catch(syncError => {
      console.warn('Could not save student assistant data.', syncError)
      setSyncMessage('Assistant database unavailable')
    })
  }

  const uploadAssistants = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return

    setError('')
    const additions: UploadedAssistant[] = []
    for (const file of files) {
      const { events } = await readScheduleFile(file)
      if (events.length === 0) {
        setError(`${file.name} has no valid schedule rows and was not added.`)
        continue
      }
      additions.push({
        id: crypto.randomUUID(),
        label: file.name.replace(/\.(csv|xlsx?)$/i, ''),
        fileName: file.name,
        events,
      })
    }
    const nextAssistants = [...assistants, ...additions]
    setAssistants(nextAssistants)
    setResult(null)
    saveAssistantData(nextAssistants, null)
  }

  const runSolver = async () => {
    setError('')
    setResult(null)
    setSolving(true)
    try {
      const response = await solveStudentAssistantSchedule(
        mainSchedule,
        assistants.map(assistant => ({
          id: assistant.id,
          label: assistant.label.trim() || assistant.fileName,
          schedule: assistant.events,
        })),
      )
      setResult(response)
      saveAssistantData(assistants, response)
    } catch (solverError) {
      console.error(solverError)
      setError('Could not reach the scheduler. Make sure the Flask service started with the app.')
    } finally {
      setSolving(false)
    }
  }

  const assignments = [...(result?.assignments ?? [])].sort((left, right) =>
    (DAY_SORT[left.day] ?? 99) - (DAY_SORT[right.day] ?? 99)
    || left.startMinutes - right.startMinutes
    || left.room.localeCompare(right.room),
  )
  const effectiveSelectedAssistantId = assistants.some(
    assistant => assistant.id === selectedAssistantId,
  )
    ? selectedAssistantId
    : assistants[0]?.id ?? ''
  const selectedAssistant = assistants.find(
    assistant => assistant.id === effectiveSelectedAssistantId,
  )
  const selectedAssignments = assignments.filter(
    assignment => assignment.assistantId === effectiveSelectedAssistantId,
  )
  const visibleDiagnostics = (result?.diagnostics ?? []).filter(
    message => !message.includes('classes remain unassigned because test coverage is optional'),
  )

  return (
    <section className="sa-panel">
      <div className="section-heading">
        <div>
          <h2>Student Assistant Scheduler</h2>
        </div>
      </div>

      <div className={`sa-main-status ${mainSchedule.length > 0 ? 'ready' : ''}`}>
        <strong>Main class schedule</strong>
        <span>
          {mainSchedule.length > 0
            ? `${mainScheduleName || 'Imported schedule'} · ${mainSchedule.length} class rows`
            : 'Upload the main class schedule in the Schedule tab first.'}
        </span>
      </div>
      <div className="sa-upload">
        <label className="btn-primary">
          Add assistant schedules
          <input type="file" accept=".csv,.xls,.xlsx,text/csv" multiple onChange={uploadAssistants} hidden />
        </label>
        <span>{assistants.length} assistant{assistants.length === 1 ? '' : 's'} added</span>
      </div>

      <div className="sa-file-list">
        {assistants.length === 0 && (
          <p className="empty-state">Add one schedule file per student assistant. The filename is used as the assistant label.</p>
        )}
        {assistants.map(assistant => (
          <article className="sa-file-card" key={assistant.id}>
            <div>
              <input
                aria-label={`Name for ${assistant.fileName}`}
                value={assistant.label}
                onChange={event => {
                  const nextAssistants = assistants.map(item =>
                    item.id === assistant.id ? { ...item, label: event.target.value } : item,
                  )
                  setAssistants(nextAssistants)
                  setResult(null)
                  saveAssistantData(nextAssistants, null)
                }}
              />
              <small>{assistant.fileName}</small>
            </div>
            <button
              className="btn-danger"
              type="button"
              onClick={() => {
                const nextAssistants = assistants.filter(item => item.id !== assistant.id)
                setAssistants(nextAssistants)
                setResult(null)
                saveAssistantData(nextAssistants, null)
              }}
            >
              Remove
            </button>
          </article>
        ))}
      </div>

      {error && <p className="form-error">{error}</p>}
      <button
        className="btn-primary sa-solve"
        type="button"
        disabled={solving || mainSchedule.length === 0 || assistants.length === 0}
        onClick={() => void runSolver()}
      >
        {solving ? 'Creating schedule…' : 'Create optimized schedule'}
      </button>

      {result && (
        <div className="sa-results">
          <div className={`sa-result-status ${result.status.toLowerCase()}`}>
            <strong>{result.status === 'OPTIMAL' || result.status === 'FEASIBLE'
              ? 'Schedule created'
              : 'No valid schedule found'}</strong>
          </div>

          {visibleDiagnostics.length > 0 && (
            <ul className="sa-diagnostics">
              {visibleDiagnostics.map(message => <li key={message}>{message}</li>)}
            </ul>
          )}

          {selectedAssistant && (
            <div className="sa-calendar-section">
              <div className="sa-calendar-switcher">
                <div>
                  <h3>Weekly Schedule</h3>
                  <p>Switch assistants to view personal classes and assigned duties.</p>
                </div>
                <label>
                  Student assistant
                  <select
                    value={effectiveSelectedAssistantId}
                    onChange={event => setSelectedAssistantId(event.target.value)}
                  >
                    {assistants.map(assistant => (
                      <option value={assistant.id} key={assistant.id}>
                        {assistant.label || assistant.fileName}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <AssistantWeeklyCalendar
                assistant={selectedAssistant}
                assignments={selectedAssignments}
              />
            </div>
          )}

        </div>
      )}
    </section>
  )
}

export default function App() {
  const savedCsvSchedule = useMemo(() => loadCsvSchedule(), [])
  const [activeTab, setActiveTab] = useState<Tab>(loadActiveTab)
  const [csvEvents, setCsvEvents] = useState<CalendarEvent[]>(savedCsvSchedule.events)
  const [csvName, setCsvName] = useState(savedCsvSchedule.name)
  const [tbaSubjects, setTbaSubjects] = useState(savedCsvSchedule.tbaSubjects)
  const [adminEvents, setAdminEvents] = useState<CalendarEvent[]>(loadAdminEvents)
  const [eventsPanelOpen, setEventsPanelOpen] = useState(false)
  const [, setStorageStatus] = useState('Opening interface…')
  const [, setStorageStatusClass] = useState('api-connecting')

  useEffect(() => {
    localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(adminEvents))
  }, [adminEvents])

  useEffect(() => {
    localStorage.setItem(CSV_STORAGE_KEY, JSON.stringify({ events: csvEvents, name: csvName, tbaSubjects }))
  }, [csvEvents, csvName, tbaSubjects])

  useEffect(() => {
    localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTab)
  }, [activeTab])

  useEffect(() => {
    let cancelled = false

    const loadDatabaseSchedule = async () => {
      if (!isCloudConfigured) {
        setStorageStatus('Local schedule')
        setStorageStatusClass('api-connecting')
        return
      }

      try {
        const schedule = await loadSharedSchedule<CalendarEvent>()
        if (cancelled) return

        if (schedule) {
          setCsvEvents(schedule.csvEvents)
          setCsvName(schedule.csvName)
          setStorageStatus('Database schedule loaded')
          setStorageStatusClass('api-online')
        } else {
          setStorageStatus('No database schedule')
          setStorageStatusClass('api-connecting')
        }
      } catch (error) {
        console.warn('Could not load the database schedule; the interface remains available.', error)
        setStorageStatus('Database unavailable')
        setStorageStatusClass('api-offline')
      }
    }

    void loadDatabaseSchedule()
    const unsubscribe = subscribeToSharedSchedule(() => {
      void loadDatabaseSchedule()
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!isCloudConfigured) return
    let cancelled = false

    const refreshAdminEvents = async () => {
      try {
        const events = await loadSharedAdminEvents()
        if (!cancelled) setAdminEvents(events)
      } catch (error) {
        console.warn('Could not load shared events; local events remain available.', error)
      }
    }

    void refreshAdminEvents()
    const unsubscribe = subscribeToSharedAdminEvents(() => {
      void refreshAdminEvents()
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const rooms = useMemo(() => {
    const importedRooms = [...new Set(csvEvents.map(event => event.room))]
    const adminRooms = adminEvents.map(event => event.room)
    const combined = [...new Set([...importedRooms, ...adminRooms])].filter(Boolean)
    return combined.length > 0 ? combined : DEFAULT_ROOMS
  }, [adminEvents, csvEvents])

  const uploadCsv = async (file: File) => {
    const parsed = await readScheduleFile(file)
    if (parsed.events.length === 0) throw new Error('No valid class rows were found in this schedule file.')
    setCsvEvents(parsed.events)
    setCsvName(file.name)
    setTbaSubjects(parsed.tbaSubjects)

    try {
      await saveSharedSchedule({ csvEvents: parsed.events, csvName: file.name })
      if (isCloudConfigured) {
        setStorageStatus('Database schedule loaded')
        setStorageStatusClass('api-online')
      }
    } catch (error) {
      console.warn('Could not synchronize the CSV schedule; the local copy remains available.', error)
      setStorageStatus('Database unavailable')
      setStorageStatusClass('api-offline')
    }
  }

  const removeCsv = () => {
    setCsvEvents([])
    setCsvName('')
    setTbaSubjects([])

    void saveSharedSchedule({ csvEvents: [], csvName: '' }).catch(error => {
      console.warn('Could not synchronize CSV removal; the local copy was still removed.', error)
      setStorageStatus('Database unavailable')
      setStorageStatusClass('api-offline')
    })
  }

  const saveAdminEvent = (form: AdminEventForm, editingId: string | null) => {
    const calendarEvent: CalendarEvent = {
      id: editingId ?? `admin-${crypto.randomUUID()}`,
      source: 'admin',
      courseCode: form.title.trim(),
      subject: '',
      date: form.date,
      startMinutes: parseInputTime(form.startTime),
      endMinutes: parseInputTime(form.endTime),
      classType: 'EVENT',
      section: '',
      room: form.room.trim(),
      studentCount: '',
      instructorLastName: '',
    }

    setAdminEvents(current =>
      editingId
        ? current.map(event => event.id === editingId ? calendarEvent : event)
        : [...current, calendarEvent],
    )

    void saveSharedAdminEvent(calendarEvent).catch(error => {
      console.warn('Could not synchronize the event; the local copy remains available.', error)
    })
  }

  const deleteAdminEvent = (id: string) => {
    setAdminEvents(current => current.filter(event => event.id !== id))
    void deleteSharedAdminEvent(id).catch(error => {
      console.warn('Could not synchronize the deletion.', error)
    })
  }

  return (
    <div className="app-shell">
      <nav className="tab-nav">
        {([
          ['schedule', 'Schedule'],
          ['student-assistant', 'Student Assistant'],
        ] as const).map(([key, label]) => (
          <button
            className={`tab-btn${activeTab === key ? ' active' : ''}`}
            type="button"
            key={key}
            onClick={() => setActiveTab(key)}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className="app-main">
        {activeTab === 'schedule' && (
          <ScheduleCalendar
            csvEvents={csvEvents}
            adminEvents={adminEvents}
            csvName={csvName}
            tbaSubjects={tbaSubjects}
            rooms={rooms}
            onCsvUpload={uploadCsv}
            onCsvRemove={removeCsv}
            onOpenEvents={() => setEventsPanelOpen(true)}
          />
        )}
        {activeTab === 'student-assistant' && (
          <StudentAssistantPanel
            mainSchedule={csvEvents}
            mainScheduleName={csvName}
          />
        )}
      </main>

      {eventsPanelOpen && (
        <div
          className="event-drawer-backdrop"
          role="presentation"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setEventsPanelOpen(false)
          }}
        >
          <aside className="event-drawer" role="dialog" aria-modal="true" aria-label="Add and manage events">
            <div className="event-drawer-toolbar">
              <strong>Schedule Events</strong>
              <button
                type="button"
                className="event-drawer-close"
                onClick={() => setEventsPanelOpen(false)}
                aria-label="Close event panel"
              >
                ×
              </button>
            </div>
            <AdminEventsPanel
              events={adminEvents}
              csvEvents={csvEvents}
              rooms={rooms}
              onSave={saveAdminEvent}
              onDelete={deleteAdminEvent}
            />
          </aside>
        </div>
      )}
    </div>
  )
}
