import { useEffect, useState } from 'react'
import './ScheduleFilter.css'

export interface ScheduleFilterOption {
  key: string
  label: string
}

export function ScheduleFilter({
  teachers,
  rooms,
  selectedTeachers,
  selectedRooms,
  onApply,
  onClose,
}: {
  teachers: ScheduleFilterOption[]
  rooms: string[]
  selectedTeachers: Set<string>
  selectedRooms: Set<string>
  onApply: (teachers: Set<string>, rooms: Set<string>) => void
  onClose: () => void
}) {
  const [activeTab, setActiveTab] = useState<'teachers' | 'rooms'>('teachers')
  const [draftTeachers, setDraftTeachers] = useState(() => new Set(selectedTeachers))
  const [draftRooms, setDraftRooms] = useState(() => new Set(selectedRooms))

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const options = activeTab === 'teachers'
    ? teachers
    : rooms.map(room => ({ key: room, label: room }))
  const draftSelection = activeTab === 'teachers' ? draftTeachers : draftRooms

  const toggleOption = (value: string) => {
    const update = (current: Set<string>) => {
      const next = new Set(current)
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return next
    }
    if (activeTab === 'teachers') setDraftTeachers(update)
    else setDraftRooms(update)
  }

  const clearFilters = () => {
    setDraftTeachers(new Set())
    setDraftRooms(new Set())
  }

  return (
    <div className="schedule-filter-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="schedule-filter-dialog" role="dialog" aria-modal="true" aria-labelledby="filter-title">
        <div className="schedule-filter-heading">
          <h2 id="filter-title">Filter</h2>
          <button type="button" aria-label="Close filter" onClick={onClose}>×</button>
        </div>
        <div className="schedule-filter-tabs" role="tablist" aria-label="Filter type">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'teachers'}
            onClick={() => setActiveTab('teachers')}
          >Teachers</button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'rooms'}
            onClick={() => setActiveTab('rooms')}
          >Rooms</button>
        </div>
        <div className="schedule-filter-options">
          {options.map(option => {
            const selected = draftSelection.has(option.key)
            return (
              <button
                className={`schedule-filter-pill${selected ? ' selected' : ''}`}
                type="button"
                aria-pressed={selected}
                key={option.key}
                onClick={() => toggleOption(option.key)}
              >{option.label}</button>
            )
          })}
        </div>
        <div className="schedule-filter-footer">
          <button className="filter-clear-button" type="button" onClick={clearFilters}>Clear</button>
          <button
            className="filter-apply-button"
            type="button"
            onClick={() => onApply(new Set(draftTeachers), new Set(draftRooms))}
          >Apply</button>
        </div>
      </section>
    </div>
  )
}
