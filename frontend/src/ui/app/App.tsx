import { useEffect, useMemo, useRef, useState } from 'react'
import { loadSharedAdminEvents, subscribeToSharedAdminEvents } from '../../api/adminEventApi'
import { isCloudConfigured, loadSharedSchedule, subscribeToSharedSchedule } from '../../api/scheduleApi'
import { readScheduleFile } from '../../api/scheduleParser'
import { parseInputTime } from '../../formatters/timeFormatter'
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
import type { AdminEventForm, BookingEditScope, CalendarEvent, RoomBookingForm, Tab } from '../../types'
import { AdminEventsPanel } from '../admin-events/AdminEventsPanel'
import type { BookingDateSchedule } from '../admin-events/AdminEventsPanel'
import { ScheduleCalendar } from '../schedule/ScheduleCalendar'
import { StudentAssistantPanel } from '../student-assistants/StudentAssistantPanel'
import './App.css'
import '../schedule/ScheduleCalendar.css'
import '../admin-events/AdminEventsPanel.css'
import '../student-assistants/StudentAssistant.css'

export default function App() {
  const savedCsvSchedule = useMemo(() => loadCsvSchedule(), [])
  const [activeTab, setActiveTab] = useState<Tab>(loadActiveTab)
  const [csvEvents, setCsvEvents] = useState<CalendarEvent[]>(savedCsvSchedule.events)
  const [csvName, setCsvName] = useState(savedCsvSchedule.name)
  const [tbaSubjects, setTbaSubjects] = useState(savedCsvSchedule.tbaSubjects)
  const [adminEvents, setAdminEvents] = useState<CalendarEvent[]>(loadAdminEvents)
  const [eventsPanelOpen, setEventsPanelOpen] = useState(false)
  const [eventEditRequest, setEventEditRequest] = useState<{ eventId: string, scope?: BookingEditScope } | null>(null)
  const [, setStorageStatus] = useState('Opening interface…')
  const [, setStorageStatusClass] = useState('api-connecting')
  const scheduleRevisionRef = useRef(0)
  const adminRevisionRef = useRef(0)

  useEffect(() => {
    localStorage.setItem(ADMIN_STORAGE_KEY, JSON.stringify(adminEvents))
  }, [adminEvents])

  useEffect(() => {
    localStorage.setItem(CSV_STORAGE_KEY, JSON.stringify({ events: csvEvents, name: csvName, tbaSubjects }))
  }, [csvEvents, csvName, tbaSubjects])

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
          setCsvEvents(schedule.csvEvents)
          setCsvName(schedule.csvName)
          const local = loadCsvSchedule()
          saveCsvScheduleLocally({ events: schedule.csvEvents, name: schedule.csvName, tbaSubjects: local.tbaSubjects })
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
    const importedRooms = [...new Set(csvEvents.map(event => event.room))]
    const adminRooms = adminEvents.map(event => event.room)
    const combined = [...new Set([...importedRooms, ...adminRooms])].filter(Boolean)
    return combined
  }, [adminEvents, csvEvents])

  const uploadCsv = async (file: File) => {
    const parsed = await readScheduleFile(file, 'official')
    if (parsed.events.length === 0) throw new Error('No valid class rows were found in this schedule file.')
    setCsvEvents(parsed.events)
    setCsvName(file.name)
    setTbaSubjects(parsed.tbaSubjects)
    saveCsvScheduleLocally({ events: parsed.events, name: file.name, tbaSubjects: parsed.tbaSubjects })
    scheduleRevisionRef.current += 1
    queueScheduleSync({ csvEvents: parsed.events, csvName: file.name })
  }

  const removeCsv = () => {
    setCsvEvents([])
    setCsvName('')
    setTbaSubjects([])
    saveCsvScheduleLocally({ events: [], name: '', tbaSubjects: [] })
    scheduleRevisionRef.current += 1
    queueScheduleSync({ csvEvents: [], csvName: '' })
  }

  const saveAdminEvent = (form: AdminEventForm, editingId: string | null) => {
    const calendarEvent: CalendarEvent = {
      id: editingId ?? `admin-${crypto.randomUUID()}`,
      source: 'admin',
      courseCode: form.title.trim(),
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
    const seriesId = crypto.randomUUID()
    const bookingEvents: CalendarEvent[] = schedules.flatMap(({ date, rooms, timeRanges }) => rooms.flatMap((room, roomIndex) => timeRanges.map((range, timeIndex) => ({
      id: `booking_${seriesId}_${roomIndex}_${timeIndex}_${date}`,
      source: 'admin',
      courseCode: form.title.trim(),
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

  const updateAdminEvents = (ids: string[], forms: AdminEventForm[]) => {
    deleteAdminEvents(ids)
    forms.forEach(form => saveAdminEvent(form, null))
  }

  const updateRoomBooking = (ids: string[], form: RoomBookingForm, schedules: BookingDateSchedule[]) => {
    deleteAdminEvents(ids)
    saveRoomBooking(form, schedules)
  }

  return (
    <div className="app-shell">
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
      </nav>

      <main className="app-main">
        {activeTab === 'schedule' && (
          <ScheduleCalendar
            key={`${csvName}:${csvEvents.length}:${csvEvents[0]?.id ?? ''}`}
            csvEvents={csvEvents}
            adminEvents={adminEvents}
            csvName={csvName}
            tbaSubjects={tbaSubjects}
            rooms={rooms}
            onCsvUpload={uploadCsv}
            onCsvRemove={removeCsv}
            onOpenEvents={() => { setEventEditRequest(null); setEventsPanelOpen(true) }}
            onEditEvent={(eventId, scope) => { setEventEditRequest({ eventId, scope }); setEventsPanelOpen(true) }}
            onDeleteEvent={deleteAdminEvent}
            onAssignAssistant={assignEventAssistant}
          />
        )}
        {activeTab === 'student-assistant' && (
          <StudentAssistantPanel
            mainSchedule={csvEvents}
            mainScheduleName={csvName}
            adminEvents={adminEvents}
          />
        )}
      </main>

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
              events={adminEvents}
              csvEvents={csvEvents}
              rooms={rooms}
              onSave={saveAdminEvent}
              onUpdateEvents={updateAdminEvents}
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
  )
}
