import type { SchedulingSettings, StudentAssistantResult } from '../api/studentAssistantApi'
import type { CalendarEvent, UploadedAssistant } from '../types'
import { dateFromInputValue, matchesSelectedDay } from './dateFormatter'
import { formatTime } from './timeFormatter'
import { isExamDate } from './examPeriod'

export interface AssistantEditConflict {
  key: string
  kind: 'Duty' | 'Event' | 'Reliever duty'
  label: string
}

export interface AssistantEditPlan {
  result: StudentAssistantResult | null
  unassignedEventIds: string[]
  conflicts: AssistantEditConflict[]
}

/** Only revalidate availability when the uploaded personal schedule changes. */
export function planAssistantEdit(
  result: StudentAssistantResult | null,
  updated: UploadedAssistant,
  assistants: UploadedAssistant[],
  mainSchedule: CalendarEvent[],
  events: CalendarEvent[],
  settings: SchedulingSettings,
  scheduleChanged: boolean,
): AssistantEditPlan {
  const conflicts: AssistantEditConflict[] = []
  const overlapsClass = (start: number, end: number, day?: string, date?: string) => scheduleChanged && updated.events.some(personal => {
    if (start >= personal.endMinutes || personal.startMinutes >= end) return false
    if (date) return personal.date ? personal.date === date : matchesSelectedDay(personal.dayCode, dateFromInputValue(date))
    if (personal.date) return matchesSelectedDay(day, dateFromInputValue(personal.date))
    const days = new Set(day?.match(/Th|Su|M|T|W|F|S/g) ?? [])
    return (personal.dayCode?.match(/Th|Su|M|T|W|F|S/g) ?? []).some(code => days.has(code))
  })
  const label = (course: string, when: string, start: number, end: number, room: string) =>
    `${course} · ${when} · ${formatTime(start)}–${formatTime(end)} · ${room}`
  const removedDutyKeys = new Set<string>()
  const dutyKey = (duty: { classId: string, day: string, startMinutes: number, endMinutes: number }) =>
    `${duty.classId}|${duty.day}|${duty.startMinutes}|${duty.endMinutes}`
  const assignments = (result?.assignments ?? []).filter(duty => {
    if (duty.assistantId !== updated.id || !overlapsClass(duty.startMinutes, duty.endMinutes, duty.day)) return true
    conflicts.push({ key: `duty:${duty.classId}:${duty.day}`, kind: 'Duty',
      label: label(duty.courseCode, duty.day, duty.startMinutes, duty.endMinutes, duty.room) })
    removedDutyKeys.add(dutyKey(duty))
    return false
  }).map(duty => duty.assistantId === updated.id ? { ...duty, assistantLabel: updated.label } : duty)
  const relievers = (result?.relieverAssignments ?? []).filter(record => {
    const originalRemoved = record.originalAssistantId === updated.id && removedDutyKeys.has(dutyKey(record))
    const replacementConflict = record.replacementAssistantId === updated.id && !isExamDate(events, record.date)
      && overlapsClass(record.startMinutes, record.endMinutes, undefined, record.date)
    if (!originalRemoved && !replacementConflict) return true
    const coverage = originalRemoved ? ` · covering the removed duty${record.replacementAssistantLabel ? ` (${record.replacementAssistantLabel})` : ''}` : ''
    conflicts.push({ key: `${originalRemoved ? 'reliever-original' : 'reliever'}:${record.classId}:${record.date}`, kind: 'Reliever duty',
      label: label(record.courseCode, record.date, record.startMinutes, record.endMinutes, record.room) + coverage })
    return false
  }).map(record => ({ ...record,
    originalAssistantLabel: record.originalAssistantId === updated.id ? updated.label : record.originalAssistantLabel,
    replacementAssistantLabel: record.replacementAssistantId === updated.id ? updated.label : record.replacementAssistantLabel,
  }))
  const unassignedEventIds = events.filter(event => {
    if (event.assistantId !== updated.id || !event.date || isExamDate(events, event.date)
      || !overlapsClass(event.startMinutes, event.endMinutes, undefined, event.date)) return false
    conflicts.push({ key: `event:${event.id}`, kind: 'Event',
      label: label(event.courseCode, event.date, event.startMinutes, event.endMinutes, event.room) })
    return true
  }).map(event => event.id)
  const assignedClassIds = new Set(assignments.map(duty => duty.classId))
  const minutes = assignments.filter(duty => duty.assistantId === updated.id)
    .reduce((sum, duty) => sum + duty.endMinutes - duty.startMinutes, 0)
  const nextResult = result ? { ...result, assignments, relieverAssignments: relievers,
    status: assignments.length !== (result.assignments?.length ?? 0) && result.status === 'OPTIMAL' ? 'FEASIBLE' as const : result.status,
    assistantTotals: result.assistantTotals?.map(total => total.assistantId === updated.id
      ? { ...total, assistantLabel: updated.label, hours: minutes / 60, remainingHours: (settings.maximumWeeklyDutyMinutes - minutes) / 60 }
      : total),
    summary: result.summary ? { ...result.summary, assistantCount: assistants.length, assignmentCount: assignments.length,
      assignedClassCount: assignedClassIds.size,
      unassignedClassCount: [...new Set(mainSchedule.map(event => event.id))].filter(id => !assignedClassIds.has(id)).length } : undefined,
  } : null
  return { result: nextResult, unassignedEventIds, conflicts }
}

/** Remove one assistant without regenerating or moving anyone else's duties. */
export function withoutAssistantAssignments(
  result: StudentAssistantResult | null,
  assistantId: string,
  remainingAssistants: UploadedAssistant[],
  mainSchedule: CalendarEvent[],
  settings: SchedulingSettings,
): StudentAssistantResult | null {
  if (!result) return null
  const assignments = (result.assignments ?? []).filter(duty => duty.assistantId !== assistantId)
  const assignedClassIds = new Set(assignments.map(duty => duty.classId))
  const classIds = new Set(mainSchedule.map(event => event.id))
  const optimizedIds = result.optimizedAssistantIds ?? result.assistantTotals?.map(total => total.assistantId) ?? []
  return {
    ...result,
    status: result.status === 'OPTIMAL' ? 'FEASIBLE' : result.status,
    assignments,
    optimizedAssistantIds: optimizedIds.filter(id => id !== assistantId),
    relieverAssignments: (result.relieverAssignments ?? []).filter(record =>
      record.originalAssistantId !== assistantId && record.replacementAssistantId !== assistantId),
    assistantTotals: remainingAssistants.map(assistant => {
      const minutes = assignments.filter(duty => duty.assistantId === assistant.id)
        .reduce((total, duty) => total + Math.max(0, duty.endMinutes - duty.startMinutes), 0)
      return { assistantId: assistant.id, assistantLabel: assistant.label, hours: minutes / 60,
        remainingHours: (settings.maximumWeeklyDutyMinutes - minutes) / 60 }
    }),
    summary: {
      ...result.summary,
      assistantCount: remainingAssistants.length,
      capacityHours: remainingAssistants.length * settings.maximumWeeklyDutyMinutes / 60,
      coverageHours: result.summary?.coverageHours ?? 0,
      assignmentCount: assignments.length,
      assignedClassCount: assignedClassIds.size,
      unassignedClassCount: [...classIds].filter(id => !assignedClassIds.has(id)).length,
    },
  }
}
