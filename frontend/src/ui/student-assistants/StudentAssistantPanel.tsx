import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { isCloudConfigured } from '../../api/scheduleApi'
import {
  loadSharedStudentAssistantData,
  saveSharedStudentAssistantData,
  solveStudentAssistantSchedule,
  subscribeToSharedStudentAssistantData,
  type StudentAssistantResult,
} from '../../api/studentAssistantApi'
import { readScheduleFile } from '../../api/scheduleParser'
import { ASSISTANT_STORAGE_KEY, loadLocalAssistantData } from '../../storage/studentAssistantStorage'
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

const EMPTY_PROFILE = { lastName: '', firstName: '', middleName: '' }

export function StudentAssistantPanel({
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
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [addProfileOpen, setAddProfileOpen] = useState(false)
  const [profileForm, setProfileForm] = useState(EMPTY_PROFILE)
  const [profileFile, setProfileFile] = useState<File | null>(null)
  const [profileError, setProfileError] = useState('')
  const [, setSyncMessage] = useState('Loading saved assistants…')

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

  const closeAddProfile = () => {
    setAddProfileOpen(false)
    setProfileForm(EMPTY_PROFILE)
    setProfileFile(null)
    setProfileError('')
  }

  useEffect(() => {
    if (!sidebarOpen && !addProfileOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (addProfileOpen) closeAddProfile()
      else setSidebarOpen(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [addProfileOpen, sidebarOpen])

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
  const selectedAssistantTotal = result?.assistantTotals?.find(
    total => total.assistantId === effectiveSelectedAssistantId,
  )
  const selectedAssignedHours = selectedAssistantTotal?.hours ?? 0
  const selectedRemainingHours = selectedAssistantTotal?.remainingHours
    ?? Math.max(0, 20 - selectedAssignedHours)
  const visibleDiagnostics = (result?.diagnostics ?? []).filter(
    message => !message.includes('classes remain unassigned because test coverage is optional'),
  )

  return (
    <section className="sa-panel">
      <header className="sa-schedule-toolbar">
        <button className="sa-menu-button" type="button" aria-label="Open student assistants" onClick={() => setSidebarOpen(true)}>☰</button>
        <div className="sa-selected-heading">
          <h2>{selectedAssistant ? assistantDisplayName(selectedAssistant) : 'Student Assistant Scheduler'}</h2>
          <span>{selectedAssistant?.studentId || (assistants.length > 0 ? 'Student ID unavailable' : 'No student assistants added')}</span>
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
            <div>
              <h3>Weekly Schedule</h3>
              <p>{selectedAssistantTotal ? `${selectedAssignedHours.toFixed(1).replace(/\.0$/, '')} hours assigned · ${selectedRemainingHours.toFixed(1).replace(/\.0$/, '')} hours remaining capacity` : 'Personal class schedule'}</p>
            </div>
          </div>
          <AssistantWeeklyCalendar assistant={selectedAssistant} assignments={selectedAssignments} />
        </div>
      ) : (
        <div className="sa-empty-schedule"><strong>No student assistants added</strong><button className="btn-primary" type="button" onClick={() => setAddProfileOpen(true)}>Add Student Assistant</button></div>
      )}

      {sidebarOpen && <div className="sa-sidebar-backdrop" role="presentation" onMouseDown={() => setSidebarOpen(false)}><aside className="sa-sidebar" aria-label="Student assistants" onMouseDown={event => event.stopPropagation()}>
        <button className="sa-sidebar-selected" type="button">
          <span className="sa-avatar">{selectedAssistant?.firstName?.[0]?.toLocaleUpperCase() ?? 'SA'}</span>
          <span><strong>{selectedAssistant ? assistantDisplayName(selectedAssistant) : 'Student Assistants'}</strong><small>{selectedAssistant?.studentId || 'No student selected'}</small></span>
          <b>⌄</b>
        </button>
        <button className="sa-add-assistant" type="button" onClick={() => { setSidebarOpen(false); setAddProfileOpen(true) }}><span>＋</span>Add Student Assistant</button>
        <h3>Student Assistants</h3>
        <div className="sa-sidebar-list">
          {assistants.length === 0 && <p>No student assistants added.</p>}
          {assistants.map(assistant => <button className={assistant.id === effectiveSelectedAssistantId ? 'selected' : ''} type="button" key={assistant.id} onClick={() => { setSelectedAssistantId(assistant.id); setSidebarOpen(false) }}><span className="sa-avatar">{assistant.firstName?.[0]?.toLocaleUpperCase() ?? assistant.label[0]?.toLocaleUpperCase() ?? 'SA'}</span><span><strong>{assistantDisplayName(assistant)}</strong><small>{assistant.studentId || 'Student ID unavailable'}</small></span></button>)}
        </div>
        <button className="sa-sidebar-settings" type="button"><span aria-hidden="true">⚙</span><strong>Scheduling Settings</strong><b aria-hidden="true">›</b></button>
      </aside></div>}

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
    </section>
  )
}

