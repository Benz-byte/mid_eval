import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ChangeEvent, FormEvent } from 'react'
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
import './App.css'

type Tab = 'schedule' | 'student-assistant'
type EventSource = 'csv' | 'admin'

interface CalendarEvent {
  id: string
  source: EventSource
  stubCode?: string
  courseCode: string
  subject: string
  startMinutes: number
  endMinutes: number
  dayCode?: string
  date?: string
  classType: string
  section: string
  room: string
  studentCount: string
  instructorLastName: string
}

interface AdminEventForm {
  title: string
  date: string
  room: string
  startTime: string
  endTime: string
}

const DEFAULT_ROOMS = [
  'MT102', 'MTAVR1', 'MTAVR2',
  'MTCL1', 'MTCL2', 'MTCL3', 'MTCL4', 'MTCL5', 'MTCL6', 'MTCL7', 'MTCL8',
  'SHSCL1', 'SHSCL2',
]
const DEFAULT_START = 7 * 60
const DEFAULT_END = 21 * 60
const TIME_ROW_HEIGHT = 48
const ADMIN_STORAGE_KEY = 'auto-scheduler-admin-events'
const CSV_STORAGE_KEY = 'auto-scheduler-imported-schedule'
const ACTIVE_TAB_STORAGE_KEY = 'auto-scheduler-active-tab'
const SCHEDULE_DATE_STORAGE_KEY = 'auto-scheduler-selected-date'

function toDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function createEmptyAdminForm(date = toDateInputValue(new Date())): AdminEventForm {
  return {
    title: '',
    date,
    room: '',
    startTime: '07:00',
    endTime: '08:00',
  }
}

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
  const digits = value.replace(/\D/g, '')
  if (!digits) return null

  const numeric = Number(digits)
  let hour = Math.floor(numeric / 100)
  let minute = numeric % 100

  hour += Math.floor(minute / 60)
  minute %= 60

  const result = hour * 60 + minute
  return result >= 0 && result <= 24 * 60 ? result : null
}

function parseInputTime(value: string): number {
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
}

function formatTime(minutes: number) {
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  const period = hour >= 12 ? 'PM' : 'AM'
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${period}`
}

function normalizeField(value = '') {
  return value.replace(/\u00a0/g, ' ').trim()
}

function csvRowsToEvents(rows: string[][]): CalendarEvent[] {
  const events: CalendarEvent[] = []

  rows.forEach((columns, index) => {
    if (columns.length < 14) return

    const startMinutes = parseCsvTime(columns[4])
    const endMinutes = parseCsvTime(columns[5])
    if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) return

    const room = normalizeField(columns[9])
    const dayCode = normalizeField(columns[6])
    if (!room || !dayCode) return

    events.push({
      id: `csv-${index}-${normalizeField(columns[1])}`,
      source: 'csv',
      stubCode: normalizeField(columns[1]),
      courseCode: normalizeField(columns[2]),
      subject: normalizeField(columns[3]),
      startMinutes,
      endMinutes,
      dayCode,
      classType: normalizeField(columns[7]),
      section: normalizeField(columns[8]),
      room,
      studentCount: normalizeField(columns[10]),
      instructorLastName: normalizeField(columns[11]),
    })
  })

  return events
}

function matchesSelectedDay(dayCode: string | undefined, date: Date) {
  if (!dayCode) return false
  const selectedCode = ['Su', 'M', 'T', 'W', 'Th', 'F', 'S'][date.getDay()]
  if (dayCode === 'MW') return selectedCode === 'M' || selectedCode === 'W'
  if (dayCode === 'TTh') return selectedCode === 'T' || selectedCode === 'Th'
  return dayCode === selectedCode
}

function loadAdminEvents(): CalendarEvent[] {
  try {
    const saved = localStorage.getItem(ADMIN_STORAGE_KEY)
    return saved ? JSON.parse(saved) as CalendarEvent[] : []
  } catch {
    return []
  }
}

function loadCsvSchedule(): { events: CalendarEvent[]; name: string } {
  try {
    const saved = localStorage.getItem(CSV_STORAGE_KEY)
    if (!saved) return { events: [], name: '' }

    const parsed = JSON.parse(saved) as { events?: CalendarEvent[]; name?: string }
    return {
      events: Array.isArray(parsed.events) ? parsed.events : [],
      name: typeof parsed.name === 'string' ? parsed.name : '',
    }
  } catch {
    return { events: [], name: '' }
  }
}

function loadActiveTab(): Tab {
  const saved = localStorage.getItem(ACTIVE_TAB_STORAGE_KEY)
  return saved === 'schedule' || saved === 'student-assistant'
    ? saved
    : 'schedule'
}

function loadScheduleDate(): Date {
  const saved = localStorage.getItem(SCHEDULE_DATE_STORAGE_KEY)
  if (!saved) return new Date()

  const parsed = new Date(`${saved}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

function ScheduleCalendar({
  csvEvents,
  adminEvents,
  csvName,
  rooms,
  onCsvUpload,
  onCsvRemove,
  onOpenEvents,
}: {
  csvEvents: CalendarEvent[]
  adminEvents: CalendarEvent[]
  csvName: string
  rooms: string[]
  onCsvUpload: (file: File) => Promise<void>
  onCsvRemove: () => void
  onOpenEvents: () => void
}) {
  const [selectedDate, setSelectedDate] = useState(loadScheduleDate)
  const [uploadError, setUploadError] = useState('')
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

  const positionForMinute = (minute: number) => {
    const index = guideMinutes.indexOf(minute)
    return Math.max(index, 0) * TIME_ROW_HEIGHT
  }
  const timelineHeight = Math.max((guideMinutes.length - 1) * TIME_ROW_HEIGHT, TIME_ROW_HEIGHT)
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
      setUploadError(error instanceof Error ? error.message : 'Unable to read the CSV file.')
    } finally {
      event.target.value = ''
    }
  }

  return (
    <section className="schedule-calendar">
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
          <input
            type="date"
            aria-label="Choose schedule date"
            value={selectedDateKey}
            onChange={event => selectDate(event.target.value)}
          />
          <label className="csv-upload-button">
            Upload CSV
            <input type="file" accept=".csv,text/csv" aria-label="Upload schedule CSV" onChange={handleUpload} />
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
                        className={`calendar-event ${event.source}`}
                        key={event.id}
                        style={{
                          top: positionForMinute(event.startMinutes),
                          height: Math.max(
                            positionForMinute(event.endMinutes) - positionForMinute(event.startMinutes),
                            28,
                          ),
                        }}
                        title={`${event.courseCode} ${event.subject}\n${event.stubCode ? `Stub: ${event.stubCode}\n` : ''}${formatTime(event.startMinutes)}–${formatTime(event.endMinutes)}`}
                      >
                        <strong>{event.courseCode || event.subject}</strong>
                        {event.courseCode && event.subject && <span>{event.subject}</span>}
                        {event.stubCode && <small>Stub: {event.stubCode}</small>}
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

interface UploadedAssistant {
  id: string
  label: string
  fileName: string
  events: CalendarEvent[]
}

const ASSISTANT_STORAGE_KEY = 'auto-scheduler-student-assistants'

function loadLocalAssistantData(): {
  assistants: UploadedAssistant[]
  result: StudentAssistantResult | null
} {
  try {
    const saved = localStorage.getItem(ASSISTANT_STORAGE_KEY)
    if (!saved) return { assistants: [], result: null }
    const parsed = JSON.parse(saved) as {
      assistants?: UploadedAssistant[]
      result?: StudentAssistantResult | null
    }
    return {
      assistants: Array.isArray(parsed.assistants) ? parsed.assistants : [],
      result: parsed.result ?? null,
    }
  } catch {
    return { assistants: [], result: null }
  }
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
                <span>{item.room}</span>
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
  const [syncMessage, setSyncMessage] = useState('Loading saved assistants…')

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
      const events = csvRowsToEvents(parseCsv(await file.text()))
      if (events.length === 0) {
        setError(`${file.name} has no valid schedule rows and was not added.`)
        continue
      }
      additions.push({
        id: crypto.randomUUID(),
        label: file.name.replace(/\.csv$/i, ''),
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

  return (
    <section className="sa-panel">
      <div className="section-heading">
        <div>
          <h2>Student Assistant Scheduler</h2>
          <p>Creates 20 weekly duty hours per assistant. Classes may remain unassigned while testing.</p>
        </div>
      </div>

      <div className={`sa-main-status ${mainSchedule.length > 0 ? 'ready' : ''}`}>
        <strong>Main class schedule</strong>
        <span>
          {mainSchedule.length > 0
            ? `${mainScheduleName || 'Imported schedule'} · ${mainSchedule.length} CSV rows`
            : 'Upload the main class schedule in the Schedule tab first.'}
        </span>
      </div>
      <p className="sa-sync-message">{syncMessage}</p>

      <div className="sa-upload">
        <label className="btn-primary">
          Add assistant schedule CSVs
          <input type="file" accept=".csv,text/csv" multiple onChange={uploadAssistants} hidden />
        </label>
        <span>{assistants.length} assistant{assistants.length === 1 ? '' : 's'} added</span>
      </div>

      <div className="sa-file-list">
        {assistants.length === 0 && (
          <p className="empty-state">Add one CSV per student assistant. The filename is used as the assistant label.</p>
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
              <small>{assistant.fileName} · {assistant.events.length} class rows</small>
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
            {result.summary && (
              <span>
                {result.summary.assistantCount} assistants · {result.summary.assignedClassCount ?? 0} classes assigned
                {typeof result.summary.unassignedClassCount === 'number'
                  ? ` · ${result.summary.unassignedClassCount} unassigned`
                  : ''}
              </span>
            )}
          </div>

          {result.diagnostics.length > 0 && (
            <ul className="sa-diagnostics">
              {result.diagnostics.map(message => <li key={message}>{message}</li>)}
            </ul>
          )}

          {(result.assistantTotals?.length ?? 0) > 0 && (
            <div className="sa-total-grid">
              {result.assistantTotals?.map(total => (
                <div key={total.assistantId}>
                  <strong>{total.assistantLabel}</strong>
                  <span>{total.hours} hours/week</span>
                </div>
              ))}
            </div>
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
  const [adminEvents, setAdminEvents] = useState<CalendarEvent[]>(loadAdminEvents)
  const [eventsPanelOpen, setEventsPanelOpen] = useState(false)
  const [, setStorageStatus] = useState('Opening interface…')
  const [, setStorageStatusClass] = useState('api-connecting')

  useEffect(() => {
    localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(adminEvents))
  }, [adminEvents])

  useEffect(() => {
    localStorage.setItem(CSV_STORAGE_KEY, JSON.stringify({ events: csvEvents, name: csvName }))
  }, [csvEvents, csvName])

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
    const text = await file.text()
    const parsed = csvRowsToEvents(parseCsv(text))
    if (parsed.length === 0) throw new Error('No valid schedule rows were found in this CSV.')
    setCsvEvents(parsed)
    setCsvName(file.name)

    try {
      await saveSharedSchedule({ csvEvents: parsed, csvName: file.name })
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
