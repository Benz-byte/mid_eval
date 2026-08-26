import type { CSSProperties } from 'react'
import type { DutyAssignment, RelieverAssignment } from '../../api/studentAssistantApi'
import type { CalendarEvent, UploadedAssistant } from '../../types'
import { formatTime } from '../../formatters/timeFormatter'

const DEFAULT_START = 7 * 60
const DEFAULT_END = 21 * 60

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
}: {
  assistant: UploadedAssistant
  assignments: DutyAssignment[]
  eventAssignments: CalendarEvent[]
  relieverAssignments: RelieverAssignment[]
  weekStart: Date
}) {
  const weekDates = WEEK_DAYS.map((_, index) => {
    const date = new Date(weekStart)
    date.setDate(date.getDate() + index)
    return date
  })
  const dateKey = (date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }
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
  const pixelsPerHour = 64
  const calendarHeight = Math.max(((rangeEnd - rangeStart) / 60) * pixelsPerHour, pixelsPerHour)
  const position = (minutes: number) => ((minutes - rangeStart) / 60) * pixelsPerHour
  const hourLabels: number[] = []
  for (let minute = rangeStart; minute <= rangeEnd; minute += 60) hourLabels.push(minute)

  return (
    <div className="sa-weekly-calendar">
      <div className="sa-week-header">
        <div className="sa-week-corner">Time</div>
        {WEEK_DAYS.map((day, index) => <div key={day.code}><strong>{day.label}</strong><small>{weekDates[index].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small></div>)}
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
            {assignments.filter(item => item.day === day.code).map((item, index) => {
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
              && record.date === dateKey(weekDates[dayIndex]),
            ).map(record => (
              <article
                className="sa-calendar-block reliever"
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
    </div>
  )
}

