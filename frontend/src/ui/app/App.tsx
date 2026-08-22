import { useEffect, useMemo, useState } from 'react'
import { deleteSharedAdminEvent, loadSharedAdminEvents, saveSharedAdminEvent, subscribeToSharedAdminEvents } from '../../api/adminEventApi'
import { isCloudConfigured, loadSharedSchedule, saveSharedSchedule, subscribeToSharedSchedule } from '../../api/scheduleApi'
import { readScheduleFile } from '../../api/scheduleParser'
import { parseInputTime } from '../../formatters/timeFormatter'
import { ADMIN_STORAGE_KEY, loadAdminEvents } from '../../storage/adminEventStorage'
import { ACTIVE_TAB_STORAGE_KEY, loadActiveTab } from '../../storage/preferenceStorage'
import { CSV_STORAGE_KEY, loadCsvSchedule } from '../../storage/scheduleStorage'
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

      try {
        const schedule = await loadSharedSchedule<CalendarEvent>()
        if (cancelled) return

        if (schedule) {
          setCsvEvents(schedule.csvEvents)
          setCsvName(schedule.csvName)
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
      try {
        const events = await loadSharedAdminEvents()
        if (!cancelled) setAdminEvents(events)
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

    try {
      await saveSharedSchedule({ csvEvents: parsed.events, csvName: file.name })
      if (isCloudConfigured) {
        setStorageStatus('Database schedule loaded')
        setStorageStatusClass('api-online')
      }
    } catch (error) {
      console.warn('Could not synchronize the CSV schedule; the local copy remains available.', error)
      setStorageStatus('Database unavailable')
      setStorageStatusClass('api-offline')
    }
  }

  const removeCsv = () => {
    setCsvEvents([])
    setCsvName('')
    setTbaSubjects([])

    void saveSharedSchedule({ csvEvents: [], csvName: '' }).catch(error => {
      console.warn('Could not synchronize CSV removal; the local copy was still removed.', error)
      setStorageStatus('Database unavailable')
      setStorageStatusClass('api-offline')
    })
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

    setAdminEvents(current =>
      editingId
        ? current.map(event => event.id === editingId ? calendarEvent : event)
        : [...current, calendarEvent],
    )

    void saveSharedAdminEvent(calendarEvent).catch(error => {
      console.warn('Could not synchronize the event; the local copy remains available.', error)
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

    setAdminEvents(current => [...current, ...bookingEvents])
    bookingEvents.forEach(event => {
      void saveSharedAdminEvent(event).catch(error => {
        console.warn('Could not synchronize the room booking; the local copy remains available.', error)
      })
    })
  }

  const deleteAdminEvent = (id: string) => {
    setAdminEvents(current => current.filter(event => event.id !== id))
    void deleteSharedAdminEvent(id).catch(error => {
      console.warn('Could not synchronize the deletion.', error)
    })
  }

  const deleteAdminEvents = (ids: string[]) => {
    const idsToDelete = new Set(ids)
    setAdminEvents(current => current.filter(event => !idsToDelete.has(event.id)))
    ids.forEach(id => {
      void deleteSharedAdminEvent(id).catch(error => {
        console.warn('Could not synchronize the booking deletion.', error)
      })
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
          />
        )}
        {activeTab === 'student-assistant' && (
          <StudentAssistantPanel
            mainSchedule={csvEvents}
            mainScheduleName={csvName}
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
