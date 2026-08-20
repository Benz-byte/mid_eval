import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent } from 'react'
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
import type { CalendarEvent } from '../../types/schedule'
import type { UploadedAssistant } from '../../types/studentAssistant'
import { AssistantWeeklyCalendar } from './AssistantWeeklyCalendar'

const DAY_SORT: Record<string, number> = {
  M: 0, T: 1, W: 2, Th: 3, F: 4, S: 5, Su: 6,
}

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

  const uploadAssistants = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return

    setError('')
    const additions: UploadedAssistant[] = []
    for (const file of files) {
      const { events } = await readScheduleFile(file)
      if (events.length === 0) {
        setError(`${file.name} has no valid schedule rows and was not added.`)
        continue
      }
      additions.push({
        id: crypto.randomUUID(),
        label: file.name.replace(/\.(csv|xlsx?)$/i, ''),
        fileName: file.name,
        events,
      })
    }
    const nextAssistants = [...assistants, ...additions]
    setAssistants(nextAssistants)
    setResult(null)
    saveAssistantData(nextAssistants, null)
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
  const visibleDiagnostics = (result?.diagnostics ?? []).filter(
    message => !message.includes('classes remain unassigned because test coverage is optional'),
  )

  return (
    <section className="sa-panel">
      <div className="section-heading">
        <div>
          <h2>Student Assistant Scheduler</h2>
        </div>
      </div>

      <div className={`sa-main-status ${mainSchedule.length > 0 ? 'ready' : ''}`}>
        <strong>Main class schedule</strong>
        <span>
          {mainSchedule.length > 0
            ? `${mainScheduleName || 'Imported schedule'} · ${mainSchedule.length} class rows`
            : 'Upload the main class schedule in the Schedule tab first.'}
        </span>
      </div>
      <div className="sa-upload">
        <label className="btn-primary">
          Add assistant schedules
          <input type="file" accept=".csv,.xls,.xlsx,text/csv" multiple onChange={uploadAssistants} hidden />
        </label>
        <span>{assistants.length} assistant{assistants.length === 1 ? '' : 's'} added</span>
      </div>

      <div className="sa-file-list">
        {assistants.length === 0 && (
          <p className="empty-state">Add one schedule file per student assistant. The filename is used as the assistant label.</p>
        )}
        {assistants.map(assistant => (
          <article className="sa-file-card" key={assistant.id}>
            <div>
              <input
                aria-label={`Name for ${assistant.fileName}`}
                value={assistant.label}
                onChange={event => {
                  const nextAssistants = assistants.map(item =>
                    item.id === assistant.id ? { ...item, label: event.target.value } : item,
                  )
                  setAssistants(nextAssistants)
                  setResult(null)
                  saveAssistantData(nextAssistants, null)
                }}
              />
              <small>{assistant.fileName}</small>
            </div>
            <button
              className="btn-danger"
              type="button"
              onClick={() => {
                const nextAssistants = assistants.filter(item => item.id !== assistant.id)
                setAssistants(nextAssistants)
                setResult(null)
                saveAssistantData(nextAssistants, null)
              }}
            >
              Remove
            </button>
          </article>
        ))}
      </div>

      {error && <p className="form-error">{error}</p>}
      <button
        className="btn-primary sa-solve"
        type="button"
        disabled={solving || mainSchedule.length === 0 || assistants.length === 0}
        onClick={() => void runSolver()}
      >
        {solving ? 'Creating schedule…' : 'Create optimized schedule'}
      </button>

      {result && (
        <div className="sa-results">
          <div className={`sa-result-status ${result.status.toLowerCase()}`}>
            <strong>{result.status === 'OPTIMAL' || result.status === 'FEASIBLE'
              ? 'Schedule created'
              : 'No valid schedule found'}</strong>
          </div>

          {visibleDiagnostics.length > 0 && (
            <ul className="sa-diagnostics">
              {visibleDiagnostics.map(message => <li key={message}>{message}</li>)}
            </ul>
          )}

          {selectedAssistant && (
            <div className="sa-calendar-section">
              <div className="sa-calendar-switcher">
                <div>
                  <h3>Weekly Schedule</h3>
                  <p>Switch assistants to view personal classes and assigned duties.</p>
                </div>
                <label>
                  Student assistant
                  <select
                    value={effectiveSelectedAssistantId}
                    onChange={event => setSelectedAssistantId(event.target.value)}
                  >
                    {assistants.map(assistant => (
                      <option value={assistant.id} key={assistant.id}>
                        {assistant.label || assistant.fileName}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <AssistantWeeklyCalendar
                assistant={selectedAssistant}
                assignments={selectedAssignments}
              />
            </div>
          )}

        </div>
      )}
    </section>
  )
}

