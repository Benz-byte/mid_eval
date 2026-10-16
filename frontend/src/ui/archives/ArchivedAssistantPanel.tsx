import { useState } from 'react'
import type { ScheduleArchive } from '../../storage/archiveTypes'
import { assistantDisplayName } from '../../formatters/assistantNameFormatter'
import { dateFromInputValue, startOfWeek, toDateInputValue, weekRangeLabel } from '../../formatters/dateFormatter'
import { isExamDate, isExamPeriod } from '../../formatters/examPeriod'
import { sortWeeklyWorkloads, weeklyWorkloads } from '../../formatters/weeklyWorkload'
import { AssistantWeeklyCalendar } from '../student-assistants/AssistantWeeklyCalendar'
import { WeeklyWorkloadSummary } from '../student-assistants/WeeklyWorkloadSummary'
import { CalendarZoomControls } from '../schedule/CalendarZoomControls'

export function ArchivedAssistantPanel({ archive, onViewDuty }: { archive: ScheduleArchive, onViewDuty: (id: string, date: string) => void }) {
  const data = archive.assistantData
  const [selectedId, setSelectedId] = useState(archive.view.selectedAssistantId || data.assistants[0]?.id || '')
  const [weekStart, setWeekStart] = useState(() => startOfWeek(dateFromInputValue(archive.view.assistantWeekStart)))
  const [zoom, setZoom] = useState(100)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [ascending, setAscending] = useState(false)
  const selected = data.assistants.find(assistant => assistant.id === selectedId) ?? data.assistants[0]
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 7)
  const startKey = toDateInputValue(weekStart)
  const endKey = toDateInputValue(weekEnd)
  const assignments = (data.result?.assignments ?? []).filter(assignment => assignment.assistantId === selected?.id)
  const events = archive.adminEvents.filter(event => !isExamPeriod(event) && event.assistantId === selected?.id
    && event.date && event.date >= startKey && event.date < endKey)
  const relievers = (data.result?.relieverAssignments ?? []).filter(record => record.date >= startKey && record.date < endKey
    && !isExamDate(archive.adminEvents, record.date)
    && (record.originalAssistantId === selected?.id || record.replacementAssistantId === selected?.id))
  const rows = sortWeeklyWorkloads(weeklyWorkloads(data.assistants.map(assistant => ({id:assistant.id,name:assistantDisplayName(assistant)})),
    data.result?.assignments ?? [], archive.adminEvents, data.result?.relieverAssignments ?? [], weekStart), ascending)
  const moveWeek = (offset: number) => setWeekStart(current => {
    const next = new Date(current)
    next.setDate(next.getDate() + offset * 7)
    return next
  })
  return (
    <section className="sa-panel">
      <div className="archive-assistant-heading">
        <div><h2>{selected ? assistantDisplayName(selected) : 'Student Assistants'}</h2><span>{selected?.studentId}</span></div>
        {data.assistants.length > 0 && <select className="archive-assistant-select" aria-label="Choose archived student assistant" value={selected?.id ?? ''} onChange={event => setSelectedId(event.target.value)}>{data.assistants.map(assistant => <option key={assistant.id} value={assistant.id}>{assistantDisplayName(assistant)}</option>)}</select>}
      </div>
      {selected ? <>
        <div className="sa-calendar-switcher">
          <CalendarZoomControls className="sa-calendar-zoom" value={zoom} onChange={setZoom} />
          <button className="sa-weekly-summary-button" type="button" onClick={() => setSummaryOpen(true)}>Weekly Summary</button>
          <div className="sa-week-navigation"><button type="button" aria-label="Previous week" onClick={() => moveWeek(-1)}>←</button><button type="button" onClick={() => setWeekStart(startOfWeek(new Date()))}>This Week</button><button type="button" aria-label="Next week" onClick={() => moveWeek(1)}>→</button><strong>{weekRangeLabel(weekStart)}</strong></div>
        </div>
        <AssistantWeeklyCalendar assistant={selected} assignments={assignments} eventAssignments={events} relieverAssignments={relievers}
          weekStart={weekStart} examPeriods={archive.adminEvents} zoom={zoom} readOnly
          onViewDuty={(assignment, date) => onViewDuty(assignment.classId, toDateInputValue(date))} onRemoveDuty={() => {}} />
      </> : <p>No student assistants in this archive.</p>}
      {summaryOpen && <WeeklyWorkloadSummary weekStart={weekStart} rows={rows} ascending={ascending} onSortChange={setAscending} onClose={() => setSummaryOpen(false)} />}
    </section>
  )
}
