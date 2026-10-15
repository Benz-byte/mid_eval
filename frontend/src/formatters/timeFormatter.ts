export function parseInputTime(value: string): number {
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
}

export function formatTime(minutes: number) {
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  const period = hour >= 12 ? 'PM' : 'AM'
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${period}`
}

export function workloadHoursLabel(minutes: number) {
  const hours = minutes / 60
  return `${hours.toFixed(1).replace(/\.0$/, '')} ${hours === 1 ? 'hour' : 'hours'}`
}
