import type { CSSProperties } from 'react'
import type { DutyAssignment } from '../../api/studentAssistantApi'
import type { UploadedAssistant } from '../../types'
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

