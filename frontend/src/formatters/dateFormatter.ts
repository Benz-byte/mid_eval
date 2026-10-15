export function toDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function startOfWeek(date: Date) {
  const start = new Date(date)
  const day = start.getDay()
  start.setDate(start.getDate() - (day === 0 ? 6 : day - 1))
  start.setHours(0, 0, 0, 0)
  return start
}

export function dateFromInputValue(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function weekRangeLabel(weekStart: Date) {
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekEnd.getDate() + 6)
  const sameYear = weekStart.getFullYear() === weekEnd.getFullYear()
  const sameMonth = sameYear && weekStart.getMonth() === weekEnd.getMonth()
  if (sameMonth) {
    return `${weekStart.toLocaleDateString(undefined, { month: 'long' })} ${weekStart.getDate()}–${weekEnd.getDate()}, ${weekStart.getFullYear()}`
  }
  return `${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}–${weekEnd.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
}

export function matchesSelectedDay(dayCode: string | undefined, date: Date) {
  if (!dayCode) return false
  const selectedCode = ['Su', 'M', 'T', 'W', 'Th', 'F', 'S'][date.getDay()]
  return dayCode.match(/Th|Su|M|T|W|F|S/g)?.includes(selectedCode) ?? false
}
