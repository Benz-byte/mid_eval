import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadSharedAdminEvents, subscribeToSharedAdminEvents } from '../../api/adminEventApi'
import { isCloudConfigured, loadSharedSchedule, subscribeToSharedSchedule } from '../../api/scheduleApi'
import { readScheduleFile } from '../../api/scheduleParser'
import { parseInputTime } from '../../formatters/timeFormatter'
import { createExamPeriodEvents, examPeriodPrefix, isExamPeriod } from '../../formatters/examPeriod'
import { eventsForSchedule } from '../../formatters/eventSchedule'
import { ADMIN_STORAGE_KEY, loadAdminEvents, saveAdminEventsLocally } from '../../storage/adminEventStorage'
import {
  flushPendingAdminSync,
  flushPendingScheduleSync,
  hasPendingScheduleSync,
  mergePendingAdminEvents,
  queueAdminDelete,
  queueAdminUpsert,
  queueScheduleSync,
} from '../../storage/localFirstSync'
import { ACTIVE_TAB_STORAGE_KEY, loadActiveTab } from '../../storage/preferenceStorage'
import { CSV_STORAGE_KEY, loadCsvSchedule, saveCsvScheduleLocally } from '../../storage/scheduleStorage'
import { activateLocalAssistantSchedule, loadLocalAssistantData } from '../../storage/studentAssistantStorage'
import { createScheduleArchive, type ArchiveView, type ScheduleArchive } from '../../storage/archiveTypes'
import { syncArchives } from '../../storage/archiveStorage'
import { loadScheduleDate } from '../../storage/preferenceStorage'
import { startOfWeek, toDateInputValue } from '../../formatters/dateFormatter'
import { ArchiveManager } from '../archives/ArchiveManager'
import { ArchivePreview } from '../archives/ArchivePreview'
import type { AdminEventForm, BookingDateSchedule, BookingEditScope, CalendarEvent, RoomBookingForm, Tab } from '../../types'
import { AdminEventsPanel } from '../admin-events/AdminEventsPanel'
import { ScheduleCalendar } from '../schedule/ScheduleCalendar'
import { StudentAssistantPanel } from '../student-assistants/StudentAssistantPanel'
import './App.css'
import { ThemeToggle } from './ThemeToggle'
import '../schedule/ScheduleCalendar.css'
import '../admin-events/AdminEventsPanel.css'
import '../student-assistants/StudentAssistant.css'

function filenameScheduleKey(fileName: string) {
  const normalizedName = fileName.trim().toLocaleLowerCase()
  return normalizedName ? `filename:${normalizedName}` : ''
}

export default function App() {
  const savedCsvSchedule = useMemo(() => loadCsvSchedule(), [])
  const [activeTab, setActiveTab] = useState<Tab>(loadActiveTab)
  const [archivesOpen, setArchivesOpen] = useState(false)
  const [viewingArchive, setViewingArchive] = useState<ScheduleArchive | null>(null)
  const archiveViewRef = useRef<ArchiveView>({
    scheduleDate: toDateInputValue(loadScheduleDate()), assistantWeekStart: toDateInputValue(startOfWeek(new Date())),
    selectedAssistantId: '', tab: activeTab,
  })
  const rememberScheduleDate = useCallback((date: string) => { archiveViewRef.current.scheduleDate = date }, [])
  const rememberAssistantView = useCallback((view: { assistantWeekStart: string, selectedAssistantId: string }) => {
    Object.assign(archiveViewRef.current, view)
  }, [])
  const [csvEvents, setCsvEvents] = useState<CalendarEvent[]>(savedCsvSchedule.events)
  const [csvName, setCsvName] = useState(savedCsvSchedule.name)
  const [csvRooms, setCsvRooms] = useState(savedCsvSchedule.rooms)
  const [csvTimes, setCsvTimes] = useState(savedCsvSchedule.times)
  const [csvFingerprint, setCsvFingerprint] = useState(
    savedCsvSchedule.fingerprint || filenameScheduleKey(savedCsvSchedule.name),
  )
  const [tbaSubjects, setTbaSubjects] = useState(savedCsvSchedule.tbaSubjects)
  const [scheduleMetadata, setScheduleMetadata] = useState(savedCsvSchedule.metadata)
  const [adminEvents, setAdminEvents] = useState<CalendarEvent[]>(loadAdminEvents)
  const [eventsPanelOpen, setEventsPanelOpen] = useState(false)
  const [examDatePreview, setExamDatePreview] = useState<string[]>([])
  const [eventEditRequest, setEventEditRequest] = useState<{ eventId: string, scope?: BookingEditScope } | null>(null)
  const [scheduleFocusRequest, setScheduleFocusRequest] = useState<{ eventId: string, date: string, requestId: number, consumed: boolean } | null>(null)
  const [, setStorageStatus] = useState('Opening interface…')
  const [, setStorageStatusClass] = useState('api-connecting')
  const scheduleRevisionRef = useRef(0)
  const adminRevisionRef = useRef(0)

  useEffect(() => {
    const synchronize = () => { void syncArchives().catch(() => {}) }
    synchronize()
    const timer = window.setInterval(synchronize, 30000)
    window.addEventListener('online', synchronize)
    return () => { window.clearInterval(timer); window.removeEventListener('online', synchronize) }
  }, [])

  useEffect(() => {
    localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(adminEvents))
  }, [adminEvents])

  useEffect(() => {
    localStorage.setItem(CSV_STORAGE_KEY, JSON.stringify({ events: csvEvents, name: csvName, rooms: csvRooms, times: csvTimes, fingerprint: csvFingerprint, tbaSubjects, metadata: scheduleMetadata }))
  }, [csvEvents, csvFingerprint, csvName, csvRooms, csvTimes, tbaSubjects, scheduleMetadata])

  useEffect(() => {
    localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, activeTab)
  }, [activeTab])

  useEffect(() => {
    let cancelled = false

    const loadDatabaseSchedule = async () => {
      if (!isCloudConfigured) {
        setStorageStatus('Local schedule')
        setStorageStatusClass('api-connecting')
        return
      }

      const revision = scheduleRevisionRef.current
      try {
        await flushPendingScheduleSync()
        if (hasPendingScheduleSync()) return
        const schedule = await loadSharedSchedule<CalendarEvent>()
        if (cancelled || hasPendingScheduleSync() || revision !== scheduleRevisionRef.current) return

        if (schedule) {
          const importedRooms = schedule.rooms?.length ? schedule.rooms : schedule.csvEvents.map(event => event.room)
          setCsvEvents(schedule.csvEvents)
          setCsvName(schedule.csvName)
          setCsvRooms(importedRooms)
          setCsvTimes(schedule.times ?? [])
          const scheduleKey = schedule.fingerprint || filenameScheduleKey(schedule.csvName)
          setCsvFingerprint(scheduleKey)
          activateLocalAssistantSchedule(scheduleKey, false)
          const local = loadCsvSchedule()
          const sameSchedule = local.fingerprint === scheduleKey
          const importedTba = schedule.tbaSubjects ?? (sameSchedule ? local.tbaSubjects : [])
          const metadata = schedule.metadata ?? (sameSchedule ? local.metadata : undefined)
          setTbaSubjects(importedTba)
          setScheduleMetadata(metadata)
          saveCsvScheduleLocally({ events: schedule.csvEvents, name: schedule.csvName, rooms: importedRooms, times: schedule.times ?? [], fingerprint: scheduleKey, tbaSubjects: importedTba, metadata })
          setStorageStatus('Database schedule loaded')
          setStorageStatusClass('api-online')
        } else {
          setStorageStatus('No database schedule')
          setStorageStatusClass('api-connecting')
        }
      } catch (error) {
        console.warn('Could not load the database schedule; the interface remains available.', error)
        setStorageStatus('Database unavailable')
        setStorageStatusClass('api-offline')
      }
    }

    void loadDatabaseSchedule()
    const unsubscribe = subscribeToSharedSchedule(() => {
      void loadDatabaseSchedule()
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!isCloudConfigured) return
    let cancelled = false

    const refreshAdminEvents = async () => {
      const revision = adminRevisionRef.current
      try {
        await flushPendingAdminSync()
        const events = await loadSharedAdminEvents()
        if (!cancelled && revision === adminRevisionRef.current) {
          const merged = mergePendingAdminEvents(events)
          saveAdminEventsLocally(merged)
          setAdminEvents(merged)
        }
      } catch (error) {
        console.warn('Could not load shared events; local events remain available.', error)
      }
    }

    void refreshAdminEvents()
    const unsubscribe = subscribeToSharedAdminEvents(() => {
      void refreshAdminEvents()
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  const rooms = useMemo(() => {
    const uniqueRooms = new Map<string, string>()
    ;[...csvRooms, ...csvEvents.map(event => event.room)].forEach(room => {
      const displayName = room.trim()
      if (displayName) uniqueRooms.set(displayName.toLocaleLowerCase(), uniqueRooms.get(displayName.toLocaleLowerCase()) ?? displayName)
    })
    return [...uniqueRooms.values()]
  }, [csvEvents, csvRooms])

  const availableAdminEvents = useMemo(
    () => eventsForSchedule(adminEvents, csvFingerprint, rooms),
    [adminEvents, rooms, csvFingerprint],
  )

  const calendarAdminEvents = useMemo(() => eventsPanelOpen && examDatePreview.length > 0
    ? [...availableAdminEvents, ...createExamPeriodEvents(csvFingerprint, 'Exam date', examDatePreview)]
    : availableAdminEvents, [availableAdminEvents, csvFingerprint, eventsPanelOpen, examDatePreview])

  const uploadCsv = async (file: File) => {
    const [parsed, digest] = await Promise.all([
      readScheduleFile(file, 'auto'),
      crypto.subtle.digest('SHA-256', await file.arrayBuffer()),
    ])
    const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
    if (parsed.events.length === 0 && parsed.rooms.length === 0 && parsed.times.length === 0 && parsed.tbaSubjects.length === 0) throw new Error('No class rows, TBA schedules, rooms, or times were found in this schedule file.')
    setCsvEvents(parsed.events)
    setCsvName(file.name)
    setCsvRooms(parsed.rooms)
    setCsvTimes(parsed.times)
    setCsvFingerprint(fingerprint)
    setTbaSubjects(parsed.tbaSubjects)
    setScheduleMetadata(parsed.metadata)
    saveCsvScheduleLocally({ events: parsed.events, name: file.name, rooms: parsed.rooms, times: parsed.times, fingerprint, tbaSubjects: parsed.tbaSubjects, metadata: parsed.metadata })
    activateLocalAssistantSchedule(fingerprint, true)
    scheduleRevisionRef.current += 1
    queueScheduleSync({ csvEvents: parsed.events, csvName: file.name, rooms: parsed.rooms, times: parsed.times, fingerprint, tbaSubjects: parsed.tbaSubjects, metadata: parsed.metadata })
  }

  const removeCsv = () => {
    setCsvEvents([])
    setCsvName('')
    setCsvRooms([])
    setCsvTimes([])
    setCsvFingerprint('')
    setTbaSubjects([])
    setScheduleMetadata(undefined)
    saveCsvScheduleLocally({ events: [], name: '', rooms: [], times: [], fingerprint: '', tbaSubjects: [] })
    activateLocalAssistantSchedule('')
    scheduleRevisionRef.current += 1
    queueScheduleSync({ csvEvents: [], csvName: '', rooms: [], times: [], fingerprint: '', tbaSubjects: [], metadata: {} })
  }

  const saveAdminEvent = (form: AdminEventForm, editingId: string | null) => {
    if (!csvFingerprint) throw new Error('Upload a schedule before adding events.')
    const calendarEvent: CalendarEvent = {
      ...adminEvents.find(event => event.id === editingId),
      scheduleKey: csvFingerprint,
      id: editingId ?? `admin-${crypto.randomUUID()}`,
      source: 'admin',
      courseCode: form.title.trim(),
      description: form.description?.trim() ?? '',
      subject: '',
      date: form.date,
      startMinutes: parseInputTime(form.startTime),
      endMinutes: parseInputTime(form.endTime),
      classType: 'EVENT',
      section: '',
      room: form.room.trim(),
      studentCount: '',
      instructorLastName: '',
    }

    adminRevisionRef.current += 1
    queueAdminUpsert(calendarEvent)
    setAdminEvents(current => {
      const next = editingId
        ? current.map(event => event.id === editingId ? calendarEvent : event)
        : [...current, calendarEvent]
      saveAdminEventsLocally(next)
      return next
    })
  }

  const saveRoomBooking = (form: RoomBookingForm, schedules: BookingDateSchedule[]) => {
    if (!csvFingerprint) throw new Error('Upload a schedule before adding events.')
    const seriesId = `${form.examPeriod ? examPeriodPrefix(csvFingerprint) : ''}${crypto.randomUUID()}`
    const bookingEvents: CalendarEvent[] = schedules.flatMap(({ date, rooms, timeRanges }) => rooms.flatMap((room, roomIndex) => timeRanges.map((range, timeIndex) => ({
      id: `booking_${seriesId}_${roomIndex}_${timeIndex}_${date}`,
      source: 'admin',
      scheduleKey: csvFingerprint,
      courseCode: form.title.trim(),
      description: form.description?.trim() ?? '',
      subject: '',
      date,
      startMinutes: parseInputTime(range.startTime),
      endMinutes: parseInputTime(range.endTime),
      classType: 'BOOKING',
      section: '',
      room: room.trim(),
      studentCount: '',
      instructorLastName: '',
    }))))

    adminRevisionRef.current += 1
    bookingEvents.forEach(queueAdminUpsert)
    setAdminEvents(current => {
      const next = [...current, ...bookingEvents]
      saveAdminEventsLocally(next)
      return next
    })
  }

  const deleteAdminEvent = (id: string) => {
    adminRevisionRef.current += 1
    queueAdminDelete(id)
    setAdminEvents(current => {
      const next = current.filter(event => event.id !== id)
      saveAdminEventsLocally(next)
      return next
    })
  }

  const assignEventAssistant = (id: string, assistantId?: string, assistantLabel?: string) => {
    const event = adminEvents.find(value => value.id === id)
    if (!event) return
    const updated = { ...event, assistantId, assistantLabel }
    adminRevisionRef.current += 1
    queueAdminUpsert(updated)
    setAdminEvents(current => {
      const next = current.map(value => value.id === id ? updated : value)
      saveAdminEventsLocally(next)
      return next
    })
  }

  const deleteAdminEvents = (ids: string[]) => {
    const idsToDelete = new Set(ids)
    adminRevisionRef.current += 1
    ids.forEach(queueAdminDelete)
    setAdminEvents(current => {
      const next = current.filter(event => !idsToDelete.has(event.id))
      saveAdminEventsLocally(next)
      return next
    })
  }

  const updateRoomBooking = (ids: string[], form: RoomBookingForm, schedules: BookingDateSchedule[]) => {
    deleteAdminEvents(ids)
    saveRoomBooking(form, schedules)
  }

  return (
    <>
    <div className={`app-shell${viewingArchive ? ' is-archive-hidden' : ''}`}>
      <nav className="tab-nav">
        {([
          ['schedule', 'Schedule'],
          ['student-assistant', 'Student Assistant'],
        ] as const).map(([key, label]) => (
          <button
            className={`tab-btn${activeTab === key ? ' active' : ''}`}
            type="button"
            key={key}
            onClick={() => setActiveTab(key)}
          >
            {label}
          </button>
        ))}
        <ThemeToggle />
      </nav>

      <main className="app-main">
        {activeTab === 'schedule' && (
          <ScheduleCalendar
            key={`${csvFingerprint}:${csvName}:${csvEvents.length}:${csvRooms.join('|')}:${csvEvents[0]?.id ?? ''}`}
            csvEvents={csvEvents}
            adminEvents={calendarAdminEvents}
            csvName={csvName}
            tbaSubjects={tbaSubjects}
            rooms={rooms}
            times={csvTimes}
            onViewDateChange={rememberScheduleDate}
            onArchives={() => setArchivesOpen(true)}
            onCsvUpload={uploadCsv}
            onCsvRemove={removeCsv}
            onOpenEvents={() => { setEventEditRequest(null); setEventsPanelOpen(true) }}
            onEditEvent={(eventId, scope) => { setEventEditRequest({ eventId, scope }); setEventsPanelOpen(true) }}
            onDeleteEvent={deleteAdminEvent}
            onAssignAssistant={assignEventAssistant}
            focusRequest={scheduleFocusRequest}
            onFocusHandled={requestId => setScheduleFocusRequest(current => current?.requestId === requestId ? { ...current, consumed: true } : current)}
          />
        )}
        <div hidden={activeTab !== 'student-assistant'}>
          <StudentAssistantPanel
            isActive={activeTab === 'student-assistant'}
            onViewStateChange={rememberAssistantView}
            mainSchedule={csvEvents}
            mainScheduleName={csvName}
            mainScheduleKey={csvFingerprint}
            adminEvents={calendarAdminEvents}
            onViewDuty={(eventId, date) => {
              setScheduleFocusRequest({ eventId, date, requestId: Date.now(), consumed: false })
              setActiveTab('schedule')
            }}
          />
        </div>
      </main>

      {archivesOpen && <ArchiveManager
        canSave={Boolean(csvName)} defaultName={csvName} schoolYear={scheduleMetadata?.schoolYear} semester={scheduleMetadata?.semester}
        getSummary={() => {
          const data = loadLocalAssistantData()
          const result = data.assistants.length ? data.resultsBySchedule[csvFingerprint] ?? (data.activeScheduleKey === csvFingerprint ? data.result : null) : null
          return { rooms: rooms.length, assistants: data.assistants.length,
            events: availableAdminEvents.filter(event => !isExamPeriod(event)).length, duties: result?.assignments?.length ?? 0 }
        }}
        capture={details => createScheduleArchive(details, {
          events: csvEvents, name: csvName, rooms, times: csvTimes, fingerprint: csvFingerprint, tbaSubjects, metadata: scheduleMetadata,
        }, availableAdminEvents, loadLocalAssistantData(), { ...archiveViewRef.current, tab: activeTab })}
        onView={archive => { setArchivesOpen(false); setViewingArchive(archive) }} onClose={() => setArchivesOpen(false)}
        onSaveAndClose={() => {
          removeCsv()
          setActiveTab('schedule')
          setEventsPanelOpen(false)
          setExamDatePreview([])
          setEventEditRequest(null)
          setScheduleFocusRequest(null)
          setArchivesOpen(false)
        }}
      />}

      {eventsPanelOpen && (
        <div
          className="event-drawer-backdrop"
          role="presentation"
          onMouseDown={event => {
            if (event.target === event.currentTarget) setEventsPanelOpen(false)
          }}
        >
          <aside className="event-drawer" role="dialog" aria-modal="true" aria-label="Add and manage events">
            <div className="event-drawer-toolbar">
              <strong>{eventEditRequest ? 'Move Event' : 'Add Event'}</strong>
              <button
                type="button"
                className="event-drawer-close"
                onClick={() => setEventsPanelOpen(false)}
                aria-label="Close event panel"
              >
                ×
              </button>
            </div>
            <AdminEventsPanel
              onExamDatesChange={setExamDatePreview}
              canCreateExamPeriod={Boolean(csvFingerprint)}
              events={availableAdminEvents}
              csvEvents={csvEvents}
              rooms={rooms}
              onSave={saveAdminEvent}
              onBook={saveRoomBooking}
              onUpdateBooking={updateRoomBooking}
              onDeleteMany={deleteAdminEvents}
              editRequest={eventEditRequest}
              onClose={() => { setEventsPanelOpen(false); setEventEditRequest(null) }}
            />
          </aside>
        </div>
      )}
    </div>
    {viewingArchive && <ArchivePreview key={viewingArchive.id} archive={viewingArchive} onExit={() => setViewingArchive(null)} />}
    </>
  )
}
