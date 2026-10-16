import { useState } from 'react'
import type { ScheduleArchive } from '../../storage/archiveTypes'
import type { Tab } from '../../types'
import { ScheduleCalendar } from '../schedule/ScheduleCalendar'
import { ArchivedAssistantPanel } from './ArchivedAssistantPanel'
import './Archives.css'
import { ThemeToggle } from '../app/ThemeToggle'

export function ArchivePreview({ archive, onExit }: { archive: ScheduleArchive, onExit: () => void }) {
  const [tab, setTab] = useState<Tab>(archive.view.tab)
  const [focus, setFocus] = useState<{eventId:string,date:string,requestId:number,consumed:boolean} | null>(null)
  return (
    <div className="app-shell">
      <div className="archive-banner"><span>Viewing archive: <strong>{archive.name}</strong> · {archive.schoolYear} · {archive.semester} · Read-only</span><button className="btn-secondary" type="button" onClick={onExit}>Exit Archive</button></div>
      <nav className="tab-nav" aria-label="Archived schedule tabs">
        <button className={`tab-btn${tab === 'schedule' ? ' active' : ''}`} type="button" onClick={() => setTab('schedule')}>Schedule</button>
        <button className={`tab-btn${tab === 'student-assistant' ? ' active' : ''}`} type="button" onClick={() => setTab('student-assistant')}>Student Assistant</button>
        <ThemeToggle />
      </nav>
      <main className="app-main">
        <div hidden={tab !== 'schedule'}>
          <ScheduleCalendar csvEvents={archive.schedule.events} adminEvents={archive.adminEvents} csvName={archive.schedule.name}
            rooms={archive.schedule.rooms} times={archive.schedule.times} tbaSubjects={archive.schedule.tbaSubjects}
            readOnly archivedAssistantData={archive.assistantData} initialDate={archive.view.scheduleDate}
            onCsvUpload={async () => {}} onCsvRemove={() => {}} onOpenEvents={() => {}} onEditEvent={() => {}} onDeleteEvent={() => {}} onAssignAssistant={() => {}}
            focusRequest={focus} onFocusHandled={requestId => setFocus(current => current?.requestId === requestId ? {...current,consumed:true} : current)} />
        </div>
        <div hidden={tab !== 'student-assistant'}>
          <ArchivedAssistantPanel archive={archive} onViewDuty={(eventId, date) => { setFocus({eventId,date,requestId:Date.now(),consumed:false}); setTab('schedule') }} />
        </div>
      </main>
    </div>
  )
}
