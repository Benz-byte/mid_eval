export function toDateInputValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function matchesSelectedDay(dayCode: string | undefined, date: Date) {
  if (!dayCode) return false
  const selectedCode = ['Su', 'M', 'T', 'W', 'Th', 'F', 'S'][date.getDay()]
  return dayCode.match(/Th|Su|M|T|W|F|S/g)?.includes(selectedCode) ?? false
}
