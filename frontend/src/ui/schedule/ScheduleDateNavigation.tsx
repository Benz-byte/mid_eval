import { useEffect, useRef, useState } from 'react'
import Calendar from 'react-calendar'
import 'react-calendar/dist/Calendar.css'
import { dateFromInputValue, startOfWeek, toDateInputValue } from '../../formatters/dateFormatter'
import './ScheduleDateNavigation.css'

interface ScheduleDateNavigationProps {
  date: Date
  viewMode: 'daily' | 'weekly'
  onChange: (date: Date) => void
}

export function ScheduleDateNavigation({ date, viewMode, onChange }: ScheduleDateNavigationProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const firstDay = startOfWeek(date)
  const lastDay = new Date(firstDay)
  lastDay.setDate(lastDay.getDate() + 6)
  const label = viewMode === 'weekly'
    ? `${firstDay.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}–${lastDay.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`
    : date.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    rootRef.current?.querySelector<HTMLButtonElement>('.react-calendar__tile--active')?.focus()
    document.addEventListener('mousedown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const move = (direction: number) => {
    const next = new Date(date)
    next.setDate(next.getDate() + direction * (viewMode === 'weekly' ? 7 : 1))
    setOpen(false)
    onChange(next)
  }

  const select = (next: Date) => {
    onChange(next)
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div className="schedule-date-heading" ref={rootRef}>
      <button className="schedule-date-arrow" type="button" onClick={() => move(-1)} aria-label={viewMode === 'weekly' ? 'Previous week' : 'Previous date'}>←</button>
      <h2>
        <button className="schedule-date-trigger" type="button" ref={triggerRef} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? 'schedule-date-picker' : undefined} onClick={() => setOpen(current => !current)}>
          {label}<span aria-hidden="true"> ▾</span>
        </button>
      </h2>
      <button className="schedule-date-arrow" type="button" onClick={() => move(1)} aria-label={viewMode === 'weekly' ? 'Next week' : 'Next date'}>→</button>
      {open && (
        <div className="schedule-date-picker" id="schedule-date-picker" role="dialog" aria-label="Choose schedule date">
          <Calendar value={date} onClickDay={next => select(dateFromInputValue(toDateInputValue(next)))} />
          <div className="schedule-date-picker-footer">
            <button type="button" onClick={() => select(new Date())}>Today</button>
          </div>
        </div>
      )}
    </div>
  )
}
