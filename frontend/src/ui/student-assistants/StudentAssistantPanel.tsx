import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  DEFAULT_SCHEDULING_SETTINGS,
  DUTY_GAP_OPTIONS,
  loadSharedStudentAssistantData,
  normalizeSchedulingSettings,
  solveStudentAssistantSchedule,
  subscribeToSharedStudentAssistantData,
  type SchedulingSettings,
  type StudentAssistantResult,
} from '../../api/studentAssistantApi'
import { readScheduleFile } from '../../api/scheduleParser'
import { flushPendingAssistantSync, hasPendingAssistantSync } from '../../storage/localFirstSync'
import { loadLocalAssistantData, saveLocalAssistantData } from '../../storage/studentAssistantStorage'
import type { CalendarEvent, UploadedAssistant } from '../../types'
import { AssistantWeeklyCalendar } from './AssistantWeeklyCalendar'

const DAY_SORT: Record<string, number> = {
  M: 0, T: 1, W: 2, Th: 3, F: 4, S: 5, Su: 6,
}

function assistantDisplayName(assistant: UploadedAssistant) {
  if (assistant.lastName && assistant.firstName) {
    return `${assistant.lastName}, ${Array.from(assistant.firstName.trim())[0]?.toLocaleUpperCase() ?? ''}.`
  }
  return assistant.label || assistant.fileName
}

function startOfWeek(date: Date) {
  const start = new Date(date)
  const day = start.getDay()
  start.setDate(start.getDate() - (day === 0 ? 6 : day - 1))
  start.setHours(0, 0, 0, 0)
  return start
}

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function weekRangeLabel(weekStart: Date) {
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)
  const sameYear = weekStart.getFullYear() === weekEnd.getFullYear()
  const sameMonth = sameYear && weekStart.getMonth() === weekEnd.getMonth()
  if (sameMonth) {
    return `${weekStart.toLocaleDateString(undefined, { month: 'long' })} ${weekStart.getDate()}–${weekEnd.getDate()}, ${weekStart.getFullYear()}`
  }
  return `${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}–${weekEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
}

function workloadHoursLabel(minutes: number) {
  const hours = minutes / 60
  return `${hours.toFixed(1).replace(/\.0$/, '')} ${hours === 1 ? 'hour' : 'hours'}`
}

const EMPTY_PROFILE = { lastName: '', firstName: '', middleName: '' }
function dutyGapLabel(minutes: number) {
  if (minutes === 0) return 'No required gap'
  if (minutes < 60) return `${minutes} minutes`
  const hours = minutes / 60
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`
}

export function StudentAssistantPanel({
  mainSchedule,
  mainScheduleName,
  adminEvents,
}: {
  mainSchedule: CalendarEvent[]
  mainScheduleName: string
  adminEvents: CalendarEvent[]
}) {
  const localAssistantData = useMemo(() => loadLocalAssistantData(), [])
  const [assistants, setAssistants] = useState<UploadedAssistant[]>(localAssistantData.assistants)
  const [result, setResult] = useState<StudentAssistantResult | null>(localAssistantData.result)
  const [settings, setSettings] = useState<SchedulingSettings>(localAssistantData.settings)
  const [error, setError] = useState('')
  const [solving, setSolving] = useState(false)
  const [selectedAssistantId, setSelectedAssistantId] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [assistantSearch, setAssistantSearch] = useState('')
  const [addProfileOpen, setAddProfileOpen] = useState(false)
  const [profileForm, setProfileForm] = useState(EMPTY_PROFILE)
  const [profileFile, setProfileFile] = useState<File | null>(null)
  const [profileError, setProfileError] = useState('')
  const [editingAssistant, setEditingAssistant] = useState<UploadedAssistant | null>(null)
  const [editForm, setEditForm] = useState(EMPTY_PROFILE)
  const [editFile, setEditFile] = useState<File | null>(null)
  const [keepCurrentSchedule, setKeepCurrentSchedule] = useState(true)
  const [editError, setEditError] = useState('')
  const [deletingAssistant, setDeletingAssistant] = useState<UploadedAssistant | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [weeklySummaryOpen, setWeeklySummaryOpen] = useState(false)
  const [draftDutyGapMinutes, setDraftDutyGapMinutes] = useState(
    localAssistantData.settings.minimumGapAfterThreeHourDutyMinutes,
  )
  const [viewedWeekStart, setViewedWeekStart] = useState(() => startOfWeek(new Date()))
  const assistantRevisionRef = useRef(0)
  useEffect(() => {
    let cancelled = false

    const refresh = async () => {
      const revision = assistantRevisionRef.current
      try {
        await flushPendingAssistantSync()
        if (hasPendingAssistantSync()) return
        const saved = await loadSharedStudentAssistantData<
          UploadedAssistant,
          StudentAssistantResult
        >()
        if (cancelled || hasPendingAssistantSync() || revision !== assistantRevisionRef.current) return
        if (saved) {
          const nextSettings = normalizeSchedulingSettings(
            saved.schedulingSettings ?? DEFAULT_SCHEDULING_SETTINGS,
          )
          setAssistants(saved.assistants)
          setResult(saved.solverResult)
          setSettings(nextSettings)
          setDraftDutyGapMinutes(nextSettings.minimumGapAfterThreeHourDutyMinutes)
          saveLocalAssistantData({
            assistants: saved.assistants,
            result: saved.solverResult,
            settings: nextSettings,
          }, false)
        }
      } catch (syncError) {
        console.warn('Could not load student assistant data.', syncError)
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
    nextSettings: SchedulingSettings = settings,
  ) => {
    assistantRevisionRef.current += 1
    saveLocalAssistantData({
      assistants: nextAssistants,
      result: nextResult,
      settings: nextSettings,
    })
  }

  const openSchedulingSettings = () => {
    setDraftDutyGapMinutes(settings.minimumGapAfterThreeHourDutyMinutes)
    setSidebarOpen(false)
    setSettingsOpen(true)
  }

  const saveSchedulingSettings = (event: FormEvent) => {
    event.preventDefault()
    const nextSettings = {
      minimumGapAfterThreeHourDutyMinutes: draftDutyGapMinutes,
    }
    setSettings(nextSettings)
    saveAssistantData(assistants, result, nextSettings)
    setSettingsOpen(false)
  }

  const closeAddProfile = () => {
    setAddProfileOpen(false)
    setProfileForm(EMPTY_PROFILE)
    setProfileFile(null)
    setProfileError('')
  }

  const closeEditProfile = () => {
    setEditingAssistant(null)
    setEditForm(EMPTY_PROFILE)
    setEditFile(null)
    setKeepCurrentSchedule(true)
    setEditError('')
  }

  const openEditProfile = (assistant: UploadedAssistant) => {
    setEditingAssistant(assistant)
    setEditForm({
      lastName: assistant.lastName ?? '',
      firstName: assistant.firstName ?? '',
      middleName: assistant.middleName ?? '',
    })
    setEditFile(null)
    setKeepCurrentSchedule(true)
    setEditError('')
  }

  useEffect(() => {
    if (!sidebarOpen && !addProfileOpen && !editingAssistant && !deletingAssistant && !settingsOpen && !weeklySummaryOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (deletingAssistant) setDeletingAssistant(null)
      else if (editingAssistant) closeEditProfile()
      else if (addProfileOpen) closeAddProfile()
      else if (settingsOpen) setSettingsOpen(false)
      else if (weeklySummaryOpen) setWeeklySummaryOpen(false)
      else setSidebarOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [addProfileOpen, deletingAssistant, editingAssistant, settingsOpen, sidebarOpen, weeklySummaryOpen])

  const addStudentAssistant = async (event: FormEvent) => {
    event.preventDefault()
    setProfileError('')
    const lastName = profileForm.lastName.trim()
    const firstName = profileForm.firstName.trim()
    const middleName = profileForm.middleName.trim()
    if (!lastName || !firstName || !profileFile) {
      setProfileError('Enter the student’s first and last name and choose a class schedule file.')
      return
    }
    try {
      const parsed = await readScheduleFile(profileFile, 'assistant')
      const studentId = parsed.studentId?.trim() ?? ''
      if (!studentId) {
        setProfileError('Student ID could not be found in the uploaded schedule.')
        return
      }
      if (assistants.some(assistant => assistant.studentId?.trim().toLocaleLowerCase() === studentId.toLocaleLowerCase())) {
        setProfileError(`Student ID ${studentId} has already been added.`)
        return
      }
      if (parsed.events.length === 0) {
        setProfileError('The uploaded file has no valid schedule rows.')
        return
      }
      const assistant: UploadedAssistant = {
        id: crypto.randomUUID(),
        label: [lastName, firstName, middleName].filter(Boolean).join(', '),
        fileName: profileFile.name,
        events: parsed.events,
        studentId,
        lastName,
        firstName,
        middleName: middleName || undefined,
      }
      const nextAssistants = [...assistants, assistant]
      setAssistants(nextAssistants)
      setSelectedAssistantId(assistant.id)
      setResult(null)
      saveAssistantData(nextAssistants, null)
      closeAddProfile()
    } catch (uploadFailure) {
      setProfileError(uploadFailure instanceof Error ? uploadFailure.message : 'Could not read the class schedule file.')
    }
  }

  const saveEditedAssistant = async (event: FormEvent) => {
    event.preventDefault()
    if (!editingAssistant) return
    setEditError('')
    const lastName = editForm.lastName.trim()
    const firstName = editForm.firstName.trim()
    const middleName = editForm.middleName.trim()
    if (!lastName || !firstName) {
      setEditError('Enter the student’s first and last name.')
      return
    }
    if (!keepCurrentSchedule && !editFile) {
      setEditError('Upload a class schedule file before saving.')
      return
    }

    try {
      let fileName = editingAssistant.fileName
      let events = editingAssistant.events
      let studentId = editingAssistant.studentId
      if (editFile) {
        const parsed = await readScheduleFile(editFile, 'assistant')
        const uploadedStudentId = parsed.studentId?.trim() ?? ''
        if (!uploadedStudentId) {
          setEditError('Student ID could not be found in the uploaded schedule.')
          return
        }
        if (editingAssistant.studentId && uploadedStudentId.toLocaleLowerCase() !== editingAssistant.studentId.trim().toLocaleLowerCase()) {
          setEditError(`The uploaded schedule belongs to student ID ${uploadedStudentId}, not ${editingAssistant.studentId}.`)
          return
        }
        if (assistants.some(assistant => assistant.id !== editingAssistant.id && assistant.studentId?.trim().toLocaleLowerCase() === uploadedStudentId.toLocaleLowerCase())) {
          setEditError(`Student ID ${uploadedStudentId} has already been added.`)
          return
        }
        if (parsed.events.length === 0) {
          setEditError('The uploaded file has no valid schedule rows.')
          return
        }
        fileName = editFile.name
        events = parsed.events
        studentId = uploadedStudentId
      }

      const updated: UploadedAssistant = {
        ...editingAssistant,
        label: [lastName, firstName, middleName].filter(Boolean).join(', '),
        fileName,
        events,
        studentId,
        lastName,
        firstName,
        middleName: middleName || undefined,
      }
      const nextAssistants = assistants.map(assistant => assistant.id === updated.id ? updated : assistant)
      setAssistants(nextAssistants)
      setResult(null)
      saveAssistantData(nextAssistants, null)
      closeEditProfile()
    } catch (uploadFailure) {
      setEditError(uploadFailure instanceof Error ? uploadFailure.message : 'Could not read the class schedule file.')
    }
  }

  const deleteStudentAssistant = () => {
    if (!deletingAssistant) return
    const removedIndex = assistants.findIndex(assistant => assistant.id === deletingAssistant.id)
    const nextAssistants = assistants.filter(assistant => assistant.id !== deletingAssistant.id)
    const nextSelection = nextAssistants[Math.min(Math.max(removedIndex, 0), nextAssistants.length - 1)]?.id ?? ''
    setAssistants(nextAssistants)
    setSelectedAssistantId(nextSelection)
    setResult(null)
    saveAssistantData(nextAssistants, null)
    setDeletingAssistant(null)
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
        settings,
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
  const selectedEventAssignments = useMemo(() => {
    const weekEnd = new Date(viewedWeekStart)
    weekEnd.setDate(weekEnd.getDate() + 7)
    const startKey = dateKey(viewedWeekStart)
    const endKey = dateKey(weekEnd)
    return adminEvents.filter(event =>
      event.assistantId === effectiveSelectedAssistantId
      && Boolean(event.date)
      && event.date! >= startKey
      && event.date! < endKey,
    )
  }, [adminEvents, effectiveSelectedAssistantId, viewedWeekStart])
  const selectedRelieverAssignments = useMemo(() => {
    const weekEnd = new Date(viewedWeekStart)
    weekEnd.setDate(weekEnd.getDate() + 7)
    const startKey = dateKey(viewedWeekStart)
    const endKey = dateKey(weekEnd)
    return (result?.relieverAssignments ?? []).filter(record =>
      record.date >= startKey
      && record.date < endKey
      && (record.originalAssistantId === effectiveSelectedAssistantId
        || record.replacementAssistantId === effectiveSelectedAssistantId),
    )
  }, [effectiveSelectedAssistantId, result?.relieverAssignments, viewedWeekStart])
  const performedRelieverAssignments = selectedRelieverAssignments.filter(
    record => record.replacementAssistantId === effectiveSelectedAssistantId,
  )
  const regularDutyMinutes = selectedAssignments.reduce(
    (total, assignment) => total + Math.max(0, assignment.endMinutes - assignment.startMinutes),
    0,
  )
  const eventOvertimeMinutes = selectedEventAssignments.reduce(
    (total, event) => total + Math.max(0, event.endMinutes - event.startMinutes),
    0,
  )
  const relieverOvertimeMinutes = performedRelieverAssignments.reduce(
    (total, record) => total + Math.max(0, record.endMinutes - record.startMinutes),
    0,
  )
  const totalWorkloadMinutes = regularDutyMinutes + eventOvertimeMinutes + relieverOvertimeMinutes
  const moveViewedWeek = (offset: number) => {
    setViewedWeekStart(current => {
      const next = new Date(current)
      next.setDate(next.getDate() + offset * 7)
      return next
    })
  }
  const filteredAssistants = useMemo(() => {
    const query = assistantSearch.trim().toLocaleLowerCase()
    if (!query) return assistants
    return assistants.filter(assistant => [
      assistantDisplayName(assistant),
      assistant.label,
      assistant.studentId ?? '',
      assistant.lastName ?? '',
      assistant.firstName ?? '',
      assistant.middleName ?? '',
    ].join(' ').toLocaleLowerCase().includes(query))
  }, [assistantSearch, assistants])
  const visibleDiagnostics = (result?.diagnostics ?? []).filter(
    message => !message.includes('classes remain unassigned because test coverage is optional'),
  )

  return (
    <section className="sa-panel">
      <header className="sa-schedule-toolbar">
        <button className="sa-menu-button" type="button" aria-label="Open student assistants" onClick={() => setSidebarOpen(true)}>☰</button>
        <div className="sa-selected-heading">
          <h2>{selectedAssistant ? assistantDisplayName(selectedAssistant) : 'Student Assistant Scheduler'}</h2>
          <span>{selectedAssistant?.studentId || (assistants.length > 0 ? 'ID number unavailable' : 'No student assistant added')}</span>
        </div>
        <div className="sa-toolbar-actions">
          <span className={mainSchedule.length > 0 ? 'ready' : ''}>{mainSchedule.length > 0 ? mainScheduleName || 'Main schedule uploaded' : 'No main schedule uploaded'}</span>
          <button className="btn-primary" type="button" disabled={solving || mainSchedule.length === 0 || assistants.length === 0} onClick={() => void runSolver()}>{solving ? 'Creating schedule…' : 'Create optimized schedule'}</button>
        </div>
      </header>

      {error && <p className="form-error">{error}</p>}
      {result && <div className={`sa-result-status ${result.status.toLowerCase()}`}><strong>{result.status === 'OPTIMAL' || result.status === 'FEASIBLE' ? 'Schedule created' : 'No valid schedule found'}</strong></div>}
      {visibleDiagnostics.length > 0 && <ul className="sa-diagnostics">{visibleDiagnostics.map(message => <li key={message}>{message}</li>)}</ul>}

      {selectedAssistant ? (
        <div className="sa-calendar-section">
          <div className="sa-calendar-switcher">
            <button className="sa-weekly-summary-button" type="button" onClick={() => setWeeklySummaryOpen(true)}>Weekly Summary</button>
            <div className="sa-week-navigation"><button type="button" aria-label="Previous week" onClick={() => moveViewedWeek(-1)}>←</button><button type="button" onClick={() => setViewedWeekStart(startOfWeek(new Date()))}>This Week</button><button type="button" aria-label="Next week" onClick={() => moveViewedWeek(1)}>→</button><strong>{weekRangeLabel(viewedWeekStart)}</strong></div>
          </div>
          <AssistantWeeklyCalendar assistant={selectedAssistant} assignments={selectedAssignments} eventAssignments={selectedEventAssignments} relieverAssignments={selectedRelieverAssignments} weekStart={viewedWeekStart} />
        </div>
      ) : (
        <div className="sa-empty-schedule"><strong>No student assistant added</strong></div>
      )}

      {sidebarOpen && <div className="sa-sidebar-backdrop" role="presentation" onMouseDown={() => setSidebarOpen(false)}><aside className="sa-sidebar" aria-label="Student assistants" onMouseDown={event => event.stopPropagation()}>
        <button className="sa-sidebar-selected" type="button">
          <span><strong>{selectedAssistant ? assistantDisplayName(selectedAssistant) : 'Student Assistants'}</strong><small>{selectedAssistant ? selectedAssistant.studentId || 'ID number unavailable' : 'No student selected'}</small></span>
        </button>
        <button className="sa-add-assistant" type="button" onClick={() => { setSidebarOpen(false); setAddProfileOpen(true) }}><span>＋</span>Add Student Assistant</button>
        <h3>Student Assistants</h3>
        <div className="sa-assistant-search"><span aria-hidden="true">⌕</span><input type="search" aria-label="Search student assistants" placeholder="Search student assistants…" value={assistantSearch} onChange={event => setAssistantSearch(event.target.value)} />{assistantSearch && <button type="button" aria-label="Clear student assistant search" onClick={() => setAssistantSearch('')}>×</button>}</div>
        <div className="sa-sidebar-list">
          {assistants.length === 0 && <p>No student assistants added.</p>}
          {assistants.length > 0 && filteredAssistants.length === 0 && <p>No student assistants found.</p>}
          {filteredAssistants.map(assistant => <div className={`sa-sidebar-row${assistant.id === effectiveSelectedAssistantId ? ' selected' : ''}`} key={assistant.id}><button className="sa-student-select" type="button" onClick={() => { setSelectedAssistantId(assistant.id); setSidebarOpen(false) }}><span><strong>{assistantDisplayName(assistant)}</strong><small>{assistant.studentId || 'ID number unavailable'}</small></span></button><div className="sa-student-actions"><button type="button" aria-label={`Edit ${assistantDisplayName(assistant)}`} title="Edit student assistant" onClick={() => openEditProfile(assistant)}>✎</button><button className="delete" type="button" aria-label={`Delete ${assistantDisplayName(assistant)}`} title="Delete student assistant" onClick={() => setDeletingAssistant(assistant)}>×</button></div></div>)}
        </div>
        <button className="sa-sidebar-settings" type="button" onClick={openSchedulingSettings}><span aria-hidden="true">⚙</span><strong>Scheduling Settings</strong><b aria-hidden="true">›</b></button>
      </aside></div>}

      {settingsOpen && <div className="sa-profile-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}><form className="sa-profile-form sa-settings-form" onSubmit={saveSchedulingSettings} onMouseDown={event => event.stopPropagation()}>
        <div className="sa-profile-heading"><h3>Scheduling Settings</h3><button type="button" aria-label="Close" onClick={() => setSettingsOpen(false)}>×</button></div>
        <section className="sa-duty-break-setting">
          <h4>Break After Duty</h4>
          <p>After completing three continuous regular-duty hours, require a minimum gap before another regular duty.</p>
          <label>Minimum gap after three duty hours<select value={draftDutyGapMinutes} onChange={event => setDraftDutyGapMinutes(Number(event.target.value))}>{DUTY_GAP_OPTIONS.map(minutes => <option value={minutes} key={minutes}>{dutyGapLabel(minutes)}</option>)}</select></label>
        </section>
        <div className="sa-profile-actions"><button className="btn-secondary" type="button" onClick={() => setSettingsOpen(false)}>Cancel</button><button className="btn-primary" type="submit">Save</button></div>
      </form></div>}

      {weeklySummaryOpen && selectedAssistant && <div className="sa-profile-backdrop" role="presentation" onMouseDown={() => setWeeklySummaryOpen(false)}><section className="sa-weekly-summary-dialog" role="dialog" aria-modal="true" aria-labelledby="sa-weekly-summary-title" onMouseDown={event => event.stopPropagation()}>
        <div className="sa-profile-heading"><div><h3 id="sa-weekly-summary-title">Weekly Summary</h3><p>{assistantDisplayName(selectedAssistant)} · {selectedAssistant.studentId || 'ID number unavailable'}</p><small>{weekRangeLabel(viewedWeekStart)}</small></div><button type="button" aria-label="Close" onClick={() => setWeeklySummaryOpen(false)}>×</button></div>
        <dl className="sa-weekly-summary-totals">
          <div><dt>Regular duty scheduled</dt><dd>{workloadHoursLabel(regularDutyMinutes)}</dd></div>
          <div><dt>Event overtime</dt><dd>{workloadHoursLabel(eventOvertimeMinutes)}</dd></div>
          <div><dt>Reliever overtime</dt><dd>{workloadHoursLabel(relieverOvertimeMinutes)}</dd></div>
          <div className="total"><dt>Total workload</dt><dd>{workloadHoursLabel(totalWorkloadMinutes)}</dd></div>
        </dl>
        <div className="sa-profile-actions"><button className="btn-secondary" type="button" onClick={() => setWeeklySummaryOpen(false)}>Close</button></div>
      </section></div>}

      {addProfileOpen && <div className="sa-profile-backdrop" role="presentation" onMouseDown={closeAddProfile}><form className="sa-profile-form" onSubmit={addStudentAssistant} onMouseDown={event => event.stopPropagation()}>
        <div className="sa-profile-heading"><h3>Add Student Assistant</h3><button type="button" aria-label="Close" onClick={closeAddProfile}>×</button></div>
        {profileError && <p className="form-error">{profileError}</p>}
        <label>Last name *<input value={profileForm.lastName} onChange={event => setProfileForm(current => ({ ...current, lastName: event.target.value }))} /></label>
        <label>First name *<input value={profileForm.firstName} onChange={event => setProfileForm(current => ({ ...current, firstName: event.target.value }))} /></label>
        <label>Middle name<input value={profileForm.middleName} onChange={event => setProfileForm(current => ({ ...current, middleName: event.target.value }))} /></label>
        <label>Class schedule *<input type="file" accept=".csv,.xls,.xlsx,text/csv" onChange={event => setProfileFile(event.target.files?.[0] ?? null)} /></label>
        {profileFile && <small className="sa-selected-file">{profileFile.name}</small>}
        <div className="sa-profile-actions"><button className="btn-secondary" type="button" onClick={closeAddProfile}>Cancel</button><button className="btn-primary" type="submit">Add Student</button></div>
      </form></div>}

      {editingAssistant && <div className="sa-profile-backdrop" role="presentation" onMouseDown={closeEditProfile}><form className="sa-profile-form" onSubmit={saveEditedAssistant} onMouseDown={event => event.stopPropagation()}>
        <div className="sa-profile-heading"><h3>Edit Student Assistant</h3><button type="button" aria-label="Close" onClick={closeEditProfile}>×</button></div>
        {editError && <p className="form-error">{editError}</p>}
        <label>Last name *<input value={editForm.lastName} onChange={event => setEditForm(current => ({ ...current, lastName: event.target.value }))} /></label>
        <label>First name *<input value={editForm.firstName} onChange={event => setEditForm(current => ({ ...current, firstName: event.target.value }))} /></label>
        <label>Middle name<input value={editForm.middleName} onChange={event => setEditForm(current => ({ ...current, middleName: event.target.value }))} /></label>
        <div className="sa-edit-schedule"><span>Class schedule</span>{keepCurrentSchedule || editFile ? <div className="sa-file-chip"><span>{editFile?.name ?? editingAssistant.fileName}</span><button type="button" aria-label="Remove schedule file" onClick={() => { setEditFile(null); setKeepCurrentSchedule(false) }}>×</button></div> : <label className="sa-upload-schedule">Upload schedule<input type="file" accept=".csv,.xls,.xlsx,text/csv" onChange={event => { setEditFile(event.target.files?.[0] ?? null); setKeepCurrentSchedule(false) }} /></label>}</div>
        <div className="sa-profile-actions"><button className="btn-secondary" type="button" onClick={closeEditProfile}>Cancel</button><button className="btn-primary" type="submit">Save changes</button></div>
      </form></div>}

      {deletingAssistant && <div className="sa-profile-backdrop" role="presentation" onMouseDown={() => setDeletingAssistant(null)}><section className="sa-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="sa-delete-title" onMouseDown={event => event.stopPropagation()}><h3 id="sa-delete-title">Delete Student Assistant?</h3><p>Remove {assistantDisplayName(deletingAssistant)}{deletingAssistant.studentId ? ` (${deletingAssistant.studentId})` : ''}?</p><p>Their profile, class schedule, and duty assignments will be removed.</p><div className="sa-profile-actions"><button className="btn-secondary" type="button" onClick={() => setDeletingAssistant(null)}>Cancel</button><button className="sa-confirm-delete" type="button" onClick={deleteStudentAssistant}>Delete</button></div></section></div>}
    </section>
  )
}

