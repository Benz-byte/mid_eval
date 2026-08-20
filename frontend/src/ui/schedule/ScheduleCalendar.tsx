import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ChangeEvent } from 'react'
import type { CalendarEvent, ScheduleConflict } from '../../types/schedule'
import { matchesSelectedDay, toDateInputValue } from '../../formatters/dateFormatter'
import { formatTime } from '../../formatters/timeFormatter'
import { SCHEDULE_DATE_STORAGE_KEY, loadScheduleDate } from '../../storage/preferenceStorage'
import { ScheduleFilter, type ScheduleFilterOption } from './ScheduleFilter'

const DEFAULT_START = 7 * 60
const DEFAULT_END = 21 * 60
const TIME_ROW_HEIGHT = 48

function scheduleIdentifier(event: CalendarEvent) {
  if (event.stubCode) return event.stubCode
  return /^\d{2}-[A-Z]\d{3}-\d{2}$/i.test(event.section) ? '' : event.section
}

function conflictLabel(event: CalendarEvent) {
  const courseCode = event.courseCode || event.subject || 'Untitled class'
  const stubCode = scheduleIdentifier(event)
  return stubCode ? `${courseCode}(${stubCode})` : courseCode
}

function teacherKey(event: CalendarEvent) {
  return [event.lastName, event.firstName, event.middleName]
    .filter(Boolean)
    .join('|')
    .toLocaleLowerCase()
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
  const [filterOpen, setFilterOpen] = useState(false)
  const [selectedTeachers, setSelectedTeachers] = useState<Set<string>>(() => new Set())
  const [selectedRooms, setSelectedRooms] = useState<Set<string>>(() => new Set())
  const selectedDateKey = toDateInputValue(selectedDate)
  const visibleTbaSubjects = useMemo(
    () => tbaSubjects.filter(subject => !/^0{1,4}\s*[-–—]\s*0{1,4}$/.test(subject.trim())),
    [tbaSubjects],
  )

  useEffect(() => {
    localStorage.setItem(SCHEDULE_DATE_STORAGE_KEY, selectedDateKey)
  }, [selectedDateKey])

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

  const allEvents = useMemo(() => [...csvEvents, ...adminEvents], [csvEvents, adminEvents])
  const visibleEvents = useMemo(() => allEvents.filter(event => {
    const matchesDate = event.source === 'csv'
      ? matchesSelectedDay(event.dayCode, selectedDate)
      : event.date === selectedDateKey
    if (!matchesDate) return false
    if (selectedRooms.size > 0 && !selectedRooms.has(event.room)) return false
    if (event.source === 'csv' && selectedTeachers.size > 0 && !selectedTeachers.has(teacherKey(event))) return false
    return true
  }), [allEvents, selectedDate, selectedDateKey, selectedRooms, selectedTeachers])
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
    '--room-count': displayedRooms.length,
    '--timeline-height': `${timelineHeight}px`,
    '--timetable-width': `${96 + displayedRooms.length * 145}px`,
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
          <button
            className={`schedule-filter-button${selectedTeachers.size > 0 || selectedRooms.size > 0 ? ' active' : ''}`}
            type="button"
            aria-label="Filter schedule"
            onClick={openFilters}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 6h16M7 12h10M10 18h4" />
            </svg>
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
      {showConflictColors && (conflicts.length > 0 || visibleTbaSubjects.length > 0) && (
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
          {visibleTbaSubjects.length > 0 && (
            <section className="tba-panel" aria-label="TBA schedules">
              <h3>TBA Schedules</h3>
              <ul>
                {visibleTbaSubjects.map(subject => <li key={subject}>{subject}</li>)}
              </ul>
            </section>
          )}
        </div>
      )}

      <div className="timetable-scroll">
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
                          <b>{event.courseCode || event.subject}</b>
                          {scheduleIdentifier(event) && <span>{scheduleIdentifier(event)}</span>}
                          {instructorName(event) && <span>{instructorName(event)}</span>}
                        </div>
                        <strong>{event.courseCode || event.subject}</strong>
                        {scheduleIdentifier(event) && <span>{scheduleIdentifier(event)}</span>}
                        {instructorName(event) && <small>{instructorName(event)}</small>}
                      </article>
                    ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {(conflicts.length > 0 || visibleTbaSubjects.length > 0) && (
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
  const officialName = [event.lastName, event.firstName, event.middleName].filter(Boolean).join(', ')
  return officialName || event.instructorLastName || ''
}
