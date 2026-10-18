import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { ScheduleArchive, ArchiveRecord } from '../../storage/archiveTypes'
import { deleteArchiveLocally, listLocalArchives, renameConflictingArchive, syncArchives } from '../../storage/archiveStorage'
import { saveArchiveWithAction } from '../../storage/archiveWorkflow'
import './Archives.css'

export interface ArchiveSummary {
  rooms: number
  assistants: number
  events: number
  duties: number
}

interface ArchiveManagerProps {
  canSave: boolean
  defaultName: string
  schoolYear?: string
  semester?: string
  getSummary: () => ArchiveSummary
  capture: (details: Pick<ScheduleArchive, 'name' | 'schoolYear' | 'semester'>) => ScheduleArchive
  onView: (archive: ScheduleArchive) => void
  onClose: () => void
  onSaveAndClose: () => void
}

export function ArchiveManager({ canSave, defaultName, schoolYear = '', semester = '', getSummary, capture, onView, onClose, onSaveAndClose }: ArchiveManagerProps) {
  const [records, setRecords] = useState<ArchiveRecord[]>([])
  const [saveFormOpen, setSaveFormOpen] = useState(false)
  const [summary, setSummary] = useState<ArchiveSummary | null>(null)
  const [name, setName] = useState(defaultName.replace(/\.(csv|xlsx?)$/i, ''))
  const [year, setYear] = useState(schoolYear)
  const [term, setTerm] = useState(semester)
  const [deleting, setDeleting] = useState<ArchiveRecord | null>(null)
  const [renaming, setRenaming] = useState<ArchiveRecord | null>(null)
  const [replacementName, setReplacementName] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [syncUnavailable, setSyncUnavailable] = useState(false)
  const dialogRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    return () => previous?.focus()
  }, [])

  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      try {
        const local = await listLocalArchives()
        if (!cancelled) { setRecords(local); setLoading(false) }
        try {
          await syncArchives()
          const synced = await listLocalArchives()
          if (!cancelled) { setRecords(synced); setSyncUnavailable(false) }
        } catch { if (!cancelled) setSyncUnavailable(true) }
      } catch (failure) {
        if (!cancelled) { setError(failure instanceof Error ? failure.message : 'Could not open archives.'); setLoading(false) }
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 10000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [])

  const refreshLocal = async () => setRecords(await listLocalArchives())
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !canSave) return
    const currentSummary = getSummary()
    if (JSON.stringify(currentSummary) !== JSON.stringify(summary)) {
      setSummary(currentSummary)
      setError('The current schedule changed. Review the updated counts and save again.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await saveArchiveWithAction(capture({ name, schoolYear: year, semester: term }), onSaveAndClose)
      void syncArchives().catch(() => {})
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save the archive.') }
    finally { setBusy(false) }
  }
  const rename = async (event: FormEvent) => {
    event.preventDefault()
    if (!renaming || busy) return
    setBusy(true)
    setError('')
    try {
      await renameConflictingArchive(renaming.id, replacementName)
      await refreshLocal()
      setRenaming(null)
      void syncArchives().then(refreshLocal).catch(() => setSyncUnavailable(true))
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not rename the archive.') }
    finally { setBusy(false) }
  }
  const confirmDelete = async () => {
    if (!deleting || busy) return
    setBusy(true)
    setError('')
    try {
      await deleteArchiveLocally(deleting.id)
      await refreshLocal()
      setDeleting(null)
      void syncArchives().then(refreshLocal).catch(() => setSyncUnavailable(true))
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not delete the archive.') }
    finally { setBusy(false) }
  }
  const visible = records.filter(record => !record.deletedAt).sort((a, b) => b.archive.createdAt.localeCompare(a.archive.createdAt) || a.id.localeCompare(b.id))
  return (
    <div className="archive-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <section className="archive-dialog" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="archive-manager-title" onKeyDown={event => {
        if (event.key === 'Tab') {
          const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)') ?? [])]
          const first = controls[0]
          const last = controls.at(-1)
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) { event.preventDefault(); first?.focus() }
          return
        }
        if (event.key !== 'Escape' || busy) return
        if (renaming) setRenaming(null)
        else if (deleting) setDeleting(null)
        else if (saveFormOpen) setSaveFormOpen(false)
        else onClose()
      }}>
        <div className="archive-heading"><h2 id="archive-manager-title">Archives</h2><button type="button" aria-label="Close archives" disabled={busy} onClick={onClose}>×</button></div>
        {error && <p className="msg-error" role="alert">{error}</p>}
        {saveFormOpen ? (
          <form onSubmit={save} className="archive-save-form">
            <h3>Save Archive</h3>
            <p className="archive-context">{defaultName}</p>
            {summary && <p className="archive-context">{summary.rooms} rooms · {summary.assistants} assistants · {summary.events} events · {summary.duties} duty assignments</p>}
            <label>Archive name<input required maxLength={200} value={name} onChange={event => setName(event.target.value)} disabled={busy} /></label>
            <label>School year<input required maxLength={100} value={year} onChange={event => setYear(event.target.value)} disabled={busy} /></label>
            <label>Semester<select required value={term} onChange={event => setTerm(event.target.value)} disabled={busy}>
              <option value="">Select semester</option>
              {[...new Set([semester, 'First Semester', 'Second Semester', 'Summer'].filter(Boolean))].map(value => <option key={value} value={value}>{value}</option>)}
            </select></label>
            <div className="archive-actions">
              <button className="btn-secondary" type="button" disabled={busy} onClick={() => setSaveFormOpen(false)}>Cancel</button>
              <button className="btn-primary" disabled={busy || !canSave} type="submit">{busy ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        ) : renaming ? (
          <form onSubmit={rename} className="archive-save-form">
            <h3>Rename archive</h3>
            <p>This name is already used on another device. Your archive is saved locally and can still be viewed. Choose a different name to sync it.</p>
            <label>Archive name<input required maxLength={200} value={replacementName} onChange={event => setReplacementName(event.target.value)} disabled={busy} /></label>
            <div className="archive-actions"><button className="btn-secondary" type="button" disabled={busy} onClick={() => setRenaming(null)}>Cancel</button><button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></div>
          </form>
        ) : deleting ? (
          <div><h3>Delete archive?</h3><p>{deleting.archive.name}</p><p>This removes the saved archive from this device and, after sync, other devices. Your current schedule is not deleted.</p><div className="archive-actions"><button className="btn-secondary" disabled={busy} type="button" onClick={() => setDeleting(null)}>Cancel</button><button className="btn-danger" disabled={busy} type="button" onClick={() => void confirmDelete()}>{busy ? 'Deleting…' : 'Delete'}</button></div></div>
        ) : (
          <>
            <button className="btn-primary" type="button" disabled={!canSave} onClick={() => { setError(''); setSummary(getSummary()); setSaveFormOpen(true) }}>Save Current Schedule</button>
            {syncUnavailable && <p className="archive-context" role="status">Cloud sync is unavailable. Local archives remain available on this device.</p>}
            {loading && <p>Opening archives…</p>}
            {!loading && visible.length === 0 && <p>No archives yet.</p>}
            <div className="archive-list">{visible.map(record => (
              <article className="archive-list-item" key={record.id}>
                <div><strong>{record.archive.name}</strong><p>{record.archive.schoolYear} · {record.archive.semester}</p><small>Saved {new Date(record.archive.createdAt).toLocaleString()} · {record.pending ? 'On this device · Sync pending' : 'Synced'}</small>{record.nameConflict && <p className="msg-error" role="status">Name already used. Rename to sync.</p>}</div>
                <div className="archive-actions"><button className="btn-secondary" type="button" onClick={() => {
                  if (record.archive.schemaVersion !== 1) { setError('This archive needs a newer version of the app.'); return }
                  onView(record.archive)
                }}>View</button>{record.nameConflict && <button className="btn-secondary" type="button" onClick={() => { setError(''); setReplacementName(record.archive.name); setRenaming(record) }}>Rename</button>}<button className="btn-danger" type="button" onClick={() => { setError(''); setDeleting(record) }}>Delete</button></div>
              </article>
            ))}</div>
          </>
        )}
      </section>
    </div>
  )
}
