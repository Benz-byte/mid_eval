import type { DutyAssignment, RelieverAssignment } from '../api/studentAssistantApi'
import type { CalendarEvent } from '../types'
import { isExamDate, isExamPeriod } from './examPeriod'

export interface WeeklyWorkload {
  id: string
  name: string
  dutyMinutes: number
  eventMinutes: number
  relieverMinutes: number
  totalMinutes: number
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function weeklyWorkloads(
  students: Array<{ id: string, name: string }>, duties: DutyAssignment[],
  events: CalendarEvent[], relievers: RelieverAssignment[], weekStart: Date,
): WeeklyWorkload[] {
  const end = new Date(weekStart)
  end.setDate(end.getDate() + 7)
  const startKey = dateKey(weekStart)
  const endKey = dateKey(end)
  const rows = new Map(students.map(student => [student.id, {
    ...student, dutyMinutes: 0, eventMinutes: 0, relieverMinutes: 0, totalMinutes: 0,
  }]))
  const weekRelievers = relievers.filter(record => record.date >= startKey && record.date < endKey
    && !isExamDate(events, record.date))
  for (const duty of duties) {
    const row = rows.get(duty.assistantId)
    const day = ['M', 'T', 'W', 'Th', 'F', 'S', 'Su'].indexOf(duty.day)
    if (!row || day < 0) continue
    const date = new Date(weekStart)
    date.setDate(date.getDate() + day)
    const key = dateKey(date)
    if (isExamDate(events, key)) continue
    // Subtract only time actually covered; merge coverage to avoid counting it twice.
    const covered = weekRelievers.filter(record => record.date === key && record.day === duty.day
      && record.classId === duty.classId && record.originalAssistantId === duty.assistantId
      && Boolean(record.replacementAssistantId))
      .map(record => [Math.max(duty.startMinutes, record.startMinutes), Math.min(duty.endMinutes, record.endMinutes)])
      .filter(([start, finish]) => finish > start).sort((a, b) => a[0] - b[0])
    let coveredMinutes = 0
    let coveredEnd = duty.startMinutes
    for (const [start, finish] of covered) {
      coveredMinutes += Math.max(0, finish - Math.max(start, coveredEnd))
      coveredEnd = Math.max(coveredEnd, finish)
    }
    row.dutyMinutes += Math.max(0, duty.endMinutes - duty.startMinutes - coveredMinutes)
  }
  for (const event of events) {
    if (isExamPeriod(event) || !event.date || event.date < startKey || event.date >= endKey) continue
    const row = rows.get(event.assistantId ?? '')
    if (row) row.eventMinutes += Math.max(0, event.endMinutes - event.startMinutes)
  }
  for (const record of weekRelievers) {
    const row = rows.get(record.replacementAssistantId ?? '')
    if (row) row.relieverMinutes += Math.max(0, record.endMinutes - record.startMinutes)
  }
  return [...rows.values()].map(row => ({ ...row,
    totalMinutes: row.dutyMinutes + row.eventMinutes + row.relieverMinutes,
  }))
}

export function sortWeeklyWorkloads(rows: WeeklyWorkload[], ascending = false) {
  return [...rows].sort((a, b) => (ascending ? a.totalMinutes - b.totalMinutes : b.totalMinutes - a.totalMinutes)
    || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}
