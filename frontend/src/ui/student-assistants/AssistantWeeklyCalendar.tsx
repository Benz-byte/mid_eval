import { useEffect, useState } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { DutyAssignment, RelieverAssignment } from '../../api/studentAssistantApi'
import type { CalendarEvent, UploadedAssistant } from '../../types'
import { toDateInputValue as dateKey } from '../../formatters/dateFormatter'
import { formatTime } from '../../formatters/timeFormatter'
import { isExamDate } from '../../formatters/examPeriod'

const DEFAULT_START = 7 * 60
const DEFAULT_END = 21 * 60

interface PreviewDetails {
  courseCode: string
  subject?: string
  room: string
  startMinutes: number
  endMinutes: number
  description?: string
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

export function AssistantWeeklyCalendar({
  assistant,
  assignments,
  eventAssignments,
  relieverAssignments,
  weekStart,
  examPeriods,
  zoom = 100,
  onViewDuty,
  onRemoveDuty,
  readOnly = false,
}: {
  assistant: UploadedAssistant
  assignments: DutyAssignment[]
  eventAssignments: CalendarEvent[]
  relieverAssignments: RelieverAssignment[]
  weekStart: Date
  examPeriods: CalendarEvent[]
  zoom?: number
  onViewDuty: (assignment: DutyAssignment, date: Date) => void
  onRemoveDuty: (assignment: DutyAssignment) => void
  readOnly?: boolean
}) {
  const [selectedDuty, setSelectedDuty] = useState<{ assignment: DutyAssignment, date: Date } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [previewDetails, setPreviewDetails] = useState<PreviewDetails | null>(null)
  const previewProps = (item: PreviewDetails) => readOnly ? {
    role: 'button', tabIndex: 0,
    onClick: () => setPreviewDetails(item),
    onKeyDown: (event: ReactKeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setPreviewDetails(item) }
    },
  } : {}
  const [viewportHeight, setViewportHeight] = useState(() => typeof window === 'undefined' ? 900 : window.innerHeight)

  useEffect(() => {
    const updateHeight = () => setViewportHeight(window.innerHeight)
    window.addEventListener('resize', updateHeight)
    return () => window.removeEventListener('resize', updateHeight)
  }, [])

  useEffect(() => {
    if (!selectedDuty && !previewDetails) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setSelectedDuty(null); setPreviewDetails(null) }
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [selectedDuty, previewDetails])
  const weekDates = WEEK_DAYS.map((_, index) => {
    const date = new Date(weekStart)
    date.setDate(date.getDate() + index)
    return date
  })
  const personalClasses = assistant.events.flatMap(event =>
    expandedDayCodes(event.dayCode).map(day => ({ ...event, day })),
  )
  const assignedEvents = eventAssignments.filter(event => event.assistantId === assistant.id)
  const allPeriods = [...personalClasses, ...assignments, ...assignedEvents, ...relieverAssignments]
  const rangeStart = allPeriods.length
    ? Math.floor(Math.min(...allPeriods.map(item => item.startMinutes)) / 60) * 60
    : DEFAULT_START
  const rangeEnd = allPeriods.length
    ? Math.ceil(Math.max(...allPeriods.map(item => item.endMinutes)) / 60) * 60
    : DEFAULT_END
  // Compact the time scale, not the text. Keep a readable minimum on short screens.
  const hours = Math.max((rangeEnd - rangeStart) / 60, 1)
  const pixelsPerHour = Math.max(40, Math.min(52, (viewportHeight - 290) / hours)) * zoom / 100
  const calendarHeight = Math.max(((rangeEnd - rangeStart) / 60) * pixelsPerHour, pixelsPerHour)
  const position = (minutes: number) => ((minutes - rangeStart) / 60) * pixelsPerHour
  const hourLabels: number[] = []
  for (let minute = rangeStart; minute <= rangeEnd; minute += 60) hourLabels.push(minute)

  return (
    <div className="sa-weekly-calendar">
      <div className="sa-week-header">
        <div className="sa-week-corner">Time</div>
        {WEEK_DAYS.map((day, index) => <div key={day.code}><strong>{day.label}</strong><small>{weekDates[index].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small>{isExamDate(examPeriods, dateKey(weekDates[index])) && <small>Exam period</small>}</div>)}
      </div>
      <div className="sa-week-body" style={{ '--sa-calendar-height': `${calendarHeight}px` } as CSSProperties}>
        <div className="sa-week-time-axis">
          {hourLabels.map(minute => (
            <span key={minute} style={{ top: position(minute) }}>{formatTime(minute)}</span>
          ))}
        </div>
        {WEEK_DAYS.map((day, dayIndex) => (
          <div className="sa-day-lane" key={day.code}>
            {hourLabels.map(minute => (
              <span className="sa-hour-line" key={minute} style={{ top: position(minute) }} />
            ))}
            {personalClasses.filter(item => item.day === day.code && !isExamDate(examPeriods, dateKey(weekDates[dayIndex]))).map(item => (
              <article
                className="sa-calendar-block personal"
                {...previewProps(item)}
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
            {assignments.filter(item => item.day === day.code && !isExamDate(examPeriods, dateKey(weekDates[dayIndex]))).map((item, index) => {
              const reliever = relieverAssignments.find(record =>
                record.originalAssistantId === assistant.id
                && record.classId === item.classId
                && record.day === item.day
                && record.date === dateKey(weekDates[dayIndex]),
              )
              return <article
                className={`sa-calendar-block ${reliever ? reliever.replacementAssistantId ? 'relieved' : 'reliever-pending' : 'duty'}`}
                key={`duty-${item.classId}-${item.startMinutes}-${index}`}
                style={{
                  top: position(item.startMinutes),
                  height: Math.max(position(item.endMinutes) - position(item.startMinutes), 28),
                }}
                title={reliever?.replacementAssistantLabel ? `Relieved by ${reliever.replacementAssistantLabel}` : reliever ? 'Reliever needed' : `Duty: ${item.courseCode || item.subject} in ${item.room}`}
                role="button"
                tabIndex={0}
                onClick={() => { setSelectedDuty({ assignment: item, date: weekDates[dayIndex] }); setConfirmRemove(false) }}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    setSelectedDuty({ assignment: item, date: weekDates[dayIndex] })
                    setConfirmRemove(false)
                  }
                }}
              >
                <small className="sa-block-label">{reliever ? reliever.replacementAssistantId ? 'Relieved' : 'Reliever Needed' : 'Duty'}</small>
                <strong>{item.courseCode || item.subject || 'Duty'}</strong>
                <span>Room: {item.room || 'TBA'}</span>
                {reliever?.replacementAssistantLabel && <span>Reliever: {reliever.replacementAssistantLabel}</span>}
                <small>{formatTime(item.startMinutes)}–{formatTime(item.endMinutes)}</small>
              </article>
            })}
            {relieverAssignments.filter(record =>
              record.replacementAssistantId === assistant.id
              && !isExamDate(examPeriods, dateKey(weekDates[dayIndex]))
              && record.date === dateKey(weekDates[dayIndex]),
            ).map(record => (
              <article
                className="sa-calendar-block reliever"
                {...previewProps(record)}
                key={`reliever-${record.date}-${record.classId}-${record.startMinutes}`}
                style={{
                  top: position(record.startMinutes),
                  height: Math.max(position(record.endMinutes) - position(record.startMinutes), 28),
                }}
                title={`Reliever duty: ${record.courseCode} in ${record.room}`}
              >
                <small className="sa-block-label">Reliever</small>
                <strong>{record.courseCode || 'Duty'}</strong>
                <span>Room: {record.room || 'TBA'}</span>
                <small>{formatTime(record.startMinutes)}–{formatTime(record.endMinutes)}</small>
              </article>
            ))}
            {assignedEvents.filter(item => item.date === dateKey(weekDates[dayIndex])).map(item => (
              <article
                className="sa-calendar-block event"
                {...previewProps(item)}
                key={`event-${item.id}`}
                style={{
                  top: position(item.startMinutes),
                  height: Math.max(position(item.endMinutes) - position(item.startMinutes), 28),
                }}
                title={`Event: ${item.courseCode || item.subject} in ${item.room}`}
              >
                <small className="sa-block-label">Event</small>
                <strong>{item.courseCode || item.subject || 'Event'}</strong>
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
        <span><i className="event" /> Assigned event</span>
        <span><i className="relieved" /> Relieved duty</span>
        <span><i className="reliever" /> Reliever duty</span>
      </div>
      {selectedDuty && <div className="sa-duty-action-backdrop" role="presentation" onMouseDown={() => setSelectedDuty(null)}>
        <section className="sa-duty-action-dialog" role="dialog" aria-modal="true" aria-labelledby="sa-duty-action-title" onMouseDown={event => event.stopPropagation()}>
          {confirmRemove && !readOnly ? <>
            <h3 id="sa-duty-action-title">Remove assignment?</h3>
            <p>This duty will remain in the schedule without an assigned student assistant.</p>
            <div className="sa-duty-action-buttons"><button className="btn-secondary" type="button" onClick={() => setConfirmRemove(false)}>Cancel</button><button className="sa-duty-remove-button" type="button" onClick={() => { onRemoveDuty(selectedDuty.assignment); setSelectedDuty(null) }}>Remove</button></div>
          </> : <>
            <h3 id="sa-duty-action-title">{selectedDuty.assignment.courseCode || selectedDuty.assignment.subject || 'Duty'}</h3>
            <p>{selectedDuty.date.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })} · {formatTime(selectedDuty.assignment.startMinutes)}–{formatTime(selectedDuty.assignment.endMinutes)} · {selectedDuty.assignment.room || 'TBA'}</p>
            <div className="sa-duty-action-buttons"><button className="sa-duty-view-button" type="button" onClick={() => { onViewDuty(selectedDuty.assignment, selectedDuty.date); setSelectedDuty(null) }}>View</button>{!readOnly && <button className="sa-duty-remove-button" type="button" onClick={() => setConfirmRemove(true)}>Remove</button>}</div>
          </>}
        </section>
      </div>}
      {previewDetails && <div className="sa-duty-action-backdrop" role="presentation" onMouseDown={() => setPreviewDetails(null)}>
        <section className="sa-duty-action-dialog" role="dialog" aria-modal="true" aria-label="Archived schedule details" onMouseDown={event => event.stopPropagation()}>
          <h3>{previewDetails.courseCode || previewDetails.subject}</h3>
          <p>{formatTime(previewDetails.startMinutes)}–{formatTime(previewDetails.endMinutes)} · {previewDetails.room || 'TBA'}</p>
          {previewDetails.description && <p className="calendar-event-description">{previewDetails.description}</p>}
          <div className="sa-duty-action-buttons"><button className="btn-secondary" type="button" onClick={() => setPreviewDetails(null)}>Close</button></div>
        </section>
      </div>}
    </div>
  )
}

