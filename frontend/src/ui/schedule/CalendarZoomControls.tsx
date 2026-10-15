import './CalendarZoomControls.css'

interface CalendarZoomControlsProps {
  value: number
  onChange: (value: number) => void
  className?: string
}

export function CalendarZoomControls({ value, onChange, className = '' }: CalendarZoomControlsProps) {
  return (
    <div className={`calendar-zoom-controls ${className}`} role="group" aria-label="Calendar zoom">
      <button type="button" aria-label="Zoom out calendar" disabled={value <= 75} onClick={() => onChange(Math.max(75, value - 25))}>−</button>
      <button type="button" aria-label={`Reset calendar zoom to 100 percent; current zoom ${value} percent`} onClick={() => onChange(100)}>{value}%</button>
      <button type="button" aria-label="Zoom in calendar" disabled={value >= 200} onClick={() => onChange(Math.min(200, value + 25))}>+</button>
    </div>
  )
}
