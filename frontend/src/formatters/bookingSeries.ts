export function bookingSeriesKey(id: string) {
  return id.replace(/(?:_\d+)*_\d{4}-\d{2}-\d{2}$/, '')
}
