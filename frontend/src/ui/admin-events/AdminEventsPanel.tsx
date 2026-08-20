import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { AdminEventForm, CalendarEvent } from '../../types'
import { matchesSelectedDay, toDateInputValue } from '../../formatters/dateFormatter'
import { formatTime, parseInputTime } from '../../formatters/timeFormatter'

function createEmptyAdminForm(date = toDateInputValue(new Date())): AdminEventForm {
  return { title: '', date, room: '', startTime: '07:00', endTime: '08:00' }
}

export function AdminEventsPanel({
  events,
  csvEvents,
  rooms,
  onSave,
  onDelete,
}: {
  events: CalendarEvent[]
  csvEvents: CalendarEvent[]
  rooms: string[]
  onSave: (form: AdminEventForm, editingId: string | null) => void
  onDelete: (id: string) => void
}) {
  const [form, setForm] = useState<AdminEventForm>(() => createEmptyAdminForm())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const requestedStart = parseInputTime(form.startTime)
  const requestedEnd = parseInputTime(form.endTime)
  const hasValidTimeRange = requestedEnd > requestedStart

  const availableRooms = useMemo(() => {
    if (!hasValidTimeRange) return []
    const requestedDate = new Date(`${form.date}T12:00:00`)

    return rooms.filter(room => !room.toUpperCase().startsWith('SHS')).filter(room => {
      const hasCsvConflict = csvEvents.some(event =>
        event.room === room &&
        matchesSelectedDay(event.dayCode, requestedDate) &&
        event.startMinutes < requestedEnd &&
        event.endMinutes > requestedStart,
      )
      const hasAdminConflict = events.some(event =>
        event.id !== editingId &&
        event.room === room &&
        event.date === form.date &&
        event.startMinutes < requestedEnd &&
        event.endMinutes > requestedStart,
      )
      return !hasCsvConflict && !hasAdminConflict
    })
  }, [
    csvEvents,
    editingId,
    events,
    form.date,
    hasValidTimeRange,
    requestedEnd,
    requestedStart,
    rooms,
  ])

  const updateField = (field: keyof AdminEventForm, value: string) => {
    setForm(current => ({
      ...current,
      [field]: value,
      ...(field === 'date' || field === 'startTime' || field === 'endTime' ? { room: '' } : {}),
    }))
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setError('')
    if (parseInputTime(form.endTime) <= parseInputTime(form.startTime)) {
      setError('End time must be later than start time.')
      return
    }
    if (!form.room || !availableRooms.includes(form.room)) {
      setError('Select one of the available rooms.')
      return
    }
    onSave(form, editingId)
    setEditingId(null)
    setForm(createEmptyAdminForm(form.date))
  }

  const startEditing = (event: CalendarEvent) => {
    setEditingId(event.id)
    setForm({
      title: event.courseCode,
      date: event.date ?? toDateInputValue(new Date()),
      room: event.room,
      startTime: `${String(Math.floor(event.startMinutes / 60)).padStart(2, '0')}:${String(event.startMinutes % 60).padStart(2, '0')}`,
      endTime: `${String(Math.floor(event.endMinutes / 60)).padStart(2, '0')}:${String(event.endMinutes % 60).padStart(2, '0')}`,
    })
  }

  return (
    <section className="event-panel">
      <div className="event-panel-heading">
        <div>
          <h2>{editingId ? 'Edit Event' : 'Add Event'}</h2>
          <p>Enter the event time, choose a vacant room, and save.</p>
        </div>
      </div>

      {error && <p className="msg-error">{error}</p>}
      <form className="event-form" onSubmit={submit}>
        <label>Event name<input required value={form.title} onChange={event => updateField('title', event.target.value)} /></label>
        <label>Date<input required type="date" value={form.date} onChange={event => updateField('date', event.target.value)} /></label>
        <label>Start<input required type="time" value={form.startTime} onChange={event => updateField('startTime', event.target.value)} /></label>
        <label>End<input required type="time" value={form.endTime} onChange={event => updateField('endTime', event.target.value)} /></label>

        <fieldset className="vacant-room-picker">
          <legend>Vacant rooms</legend>
          {!hasValidTimeRange && <p>Choose an end time later than the start time.</p>}
          {hasValidTimeRange && availableRooms.length === 0 && <p>No rooms are vacant for the complete time period.</p>}
          {availableRooms.map(room => (
            <button
              className={form.room === room ? 'selected' : ''}
              type="button"
              key={room}
              onClick={() => updateField('room', room)}
            >
              {room}
            </button>
          ))}
        </fieldset>

        <div className="event-form-actions">
          <button className="btn-primary" type="submit">{editingId ? 'Save Changes' : 'Save Event'}</button>
          {editingId && (
            <button
              className="btn-secondary"
              type="button"
              onClick={() => {
                setEditingId(null)
                setForm(createEmptyAdminForm(form.date))
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </form>

      <div className="admin-event-list">
        <h3>Admin Events</h3>
        {events.length === 0 && <p className="empty-state">No admin events yet.</p>}
        {events.map(event => (
          <article className="admin-event-card" key={event.id}>
            <div>
              <strong>{event.courseCode}</strong>
              <span>{event.date} · {event.room} · {formatTime(event.startMinutes)}–{formatTime(event.endMinutes)}</span>
              {event.instructorLastName && <small>Instructor: {event.instructorLastName}</small>}
            </div>
            <div>
              <button type="button" className="btn-secondary" onClick={() => startEditing(event)}>Edit</button>
              <button type="button" className="btn-danger" onClick={() => onDelete(event.id)}>Delete</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

