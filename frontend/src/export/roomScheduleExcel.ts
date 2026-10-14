import * as XLSX from 'xlsx'
import type { CalendarEvent } from '../types'
import { matchesSelectedDay, toDateInputValue } from '../formatters/dateFormatter'
import { isExamDate, isExamPeriod } from '../formatters/examPeriod'

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const CFB = XLSX.CFB

function escapeXml(value: string) {
  return Array.from(value).filter(char => char.charCodeAt(0) >= 32 || [9, 10, 13].includes(char.charCodeAt(0))).join('')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

function timeLabel(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}${String(minutes % 60).padStart(2, '0')}`
}

function eventText(event: CalendarEvent) {
  const identifier = event.stubCode || (/^\d{2}-[A-Z]\d{3}-\d{2}$/i.test(event.section) ? '' : event.section)
  const instructor = event.instructorLastName || [event.lastName, event.firstName].filter(Boolean).join(', ')
  return [event.courseCode || event.subject, identifier, instructor, event.room].filter(Boolean).join('\n')
}

function cell(address: string, text: string, style: number) {
  return `<c r="${address}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`
}

function sheetNames(rooms: string[]) {
  const used = new Set<string>()
  return rooms.map(room => {
    const base = room.replace(/[\[\]:*?/\\]/g, '_').replace(/^'+|'+$/g, '').trim() || 'Room'
    let name = base.slice(0, 31)
    let index = 2
    while (used.has(name.toLocaleLowerCase())) {
      const suffix = ` (${index++})`
      name = base.slice(0, 31 - suffix.length) + suffix
    }
    used.add(name.toLocaleLowerCase())
    return name
  })
}

export function createRoomScheduleExcel(
  rooms: string[], csvEvents: CalendarEvent[], adminEvents: CalendarEvent[], selectedDate: Date,
): { bytes: Uint8Array, weekStart: string, weekEnd: string } {
  const uniqueRooms = [...new Map(rooms.filter(room => room.trim()).map(room => [room.trim().toLocaleLowerCase(), room.trim()])).values()]
  if (!uniqueRooms.length) throw new Error('Upload a schedule with rooms before exporting.')
  const monday = new Date(selectedDate)
  if (Number.isNaN(monday.getTime())) throw new Error('Choose a valid schedule date.')
  monday.setDate(monday.getDate() - (monday.getDay() === 0 ? 6 : monday.getDay() - 1))
  const dates = DAYS.map((_, day) => {
    const date = new Date(monday)
    date.setDate(date.getDate() + day)
    return date
  })
  const weekStart = toDateInputValue(dates[0])
  const weekEnd = toDateInputValue(dates[4])
  const valid = (event: CalendarEvent) => Number.isInteger(event.startMinutes) && Number.isInteger(event.endMinutes)
    && event.startMinutes >= 0 && event.endMinutes <= 1440 && event.endMinutes > event.startMinutes
  const dailyEvents = dates.map(date => [
    ...(!isExamDate(adminEvents, toDateInputValue(date)) ? csvEvents.filter(event => matchesSelectedDay(event.dayCode, date)) : []),
    ...adminEvents.filter(event => !isExamPeriod(event) && event.date === toDateInputValue(date)),
  ].filter(event => valid(event) && uniqueRooms.some(room => room.toLocaleLowerCase() === event.room.trim().toLocaleLowerCase())))
  const allEvents = dailyEvents.flat()
  const start = Math.min(420, ...allEvents.map(event => event.startMinutes))
  const end = Math.max(1240, ...allEvents.map(event => event.endMinutes))
  const boundaries = new Set([start, end, 780])
  for (let minute = Math.ceil(start / 30) * 30; minute < end; minute += 30) boundaries.add(minute)
  allEvents.forEach(event => { boundaries.add(event.startMinutes); boundaries.add(event.endMinutes) })
  const times = [...boundaries].filter(minute => minute >= start && minute <= end).sort((a, b) => a - b)
  const names = sheetNames(uniqueRooms)
  const parts: Record<string, string> = {}
  uniqueRooms.forEach((room, sheetIndex) => {
    const texts = new Map<string, string>()
    const styles = new Map<string, number>()
    const merges = ['A1:C1', 'D1:F1']
    const heights = times.slice(1).map(() => 16)
    dailyEvents.forEach((events, day) => {
      const ordered = events.filter(event => event.room.trim().toLocaleLowerCase() === room.toLocaleLowerCase())
        .sort((a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes || a.id.localeCompare(b.id))
      const groups: Array<{ start: number, end: number, events: CalendarEvent[] }> = []
      for (const event of ordered) {
        const last = groups.at(-1)
        if (last && event.startMinutes < last.end) {
          last.end = Math.max(last.end, event.endMinutes)
          last.events.push(event)
        } else groups.push({ start: event.startMinutes, end: event.endMinutes, events: [event] })
      }
      for (const group of groups) {
        const first = times.indexOf(group.start)
        const last = times.indexOf(group.end) - 1
        const col = String.fromCharCode(66 + day)
        const text = group.events.map(event => group.events.length > 1
          ? `${eventText(event)}\n${timeLabel(event.startMinutes)}–${timeLabel(event.endMinutes)}` : eventText(event)).join('\n\n')
        texts.set(`${col}${first + 3}`, text)
        for (let index = first; index <= last; index++) styles.set(`${col}${index + 3}`, group.events.length > 1 ? 6 : 5)
        if (last > first) merges.push(`${col}${first + 3}:${col}${last + 3}`)
        // Keep long names, short bookings, and overlapping classes legible.
        const lines = text.split('\n').reduce((total, line) => total + Math.max(1, Math.ceil(line.length / 21)), 0)
        const requiredHeight = lines * 12 + 8
        const currentHeight = heights.slice(first, last + 1).reduce((sum, height) => sum + height, 0)
        if (requiredHeight > currentHeight) {
          const extra = (requiredHeight - currentHeight) / (last - first + 1)
          for (let index = first; index <= last; index++) heights[index] += extra
        }
      }
    })
    const rows = [`<row r="1" ht="22" customHeight="1">${cell('A1', room, 0)}${cell('D1', `${weekStart} – ${weekEnd}`, 0)}</row>`,
      `<row r="2" ht="22" customHeight="1">${['Time', ...DAYS].map((day, index) => cell(`${String.fromCharCode(65 + index)}2`, day, 1)).join('')}</row>`]
    times.slice(0, -1).forEach((minute, index) => {
      const row = index + 3
      const cells = [cell(`A${row}`, `${timeLabel(minute)}–${timeLabel(times[index + 1])}`, 2)]
      for (let day = 0; day < 5; day++) {
        const address = `${String.fromCharCode(66 + day)}${row}`
        cells.push(cell(address, texts.get(address) ?? '', styles.get(address) ?? (minute >= 780 ? 4 : 3)))
      }
      rows.push(`<row r="${row}" ht="${heights[index]}" customHeight="1">${cells.join('')}</row>`)
    })
    const lastRow = times.length + 1
    parts[`xl/worksheets/sheet${sheetIndex + 1}.xml`] = `${XML}<worksheet xmlns="${NS}"><dimension ref="A1:F${lastRow}"/><sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="16"/><cols><col min="1" max="1" width="14" customWidth="1"/><col min="2" max="6" width="22" customWidth="1"/></cols><sheetData>${rows.join('')}</sheetData><mergeCells count="${merges.length}">${merges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells><printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.15" footer="0.15"/><pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/></worksheet>`
  })
  const fillColors = ['FFFFFFFF', 'FFE5F1E9', 'FFB4C7E7', 'FFF4CCCC']
  const xfs = [
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>',
    ...[0, 0, 0, 1, 2, 3].map((fill, index) => `<xf numFmtId="0" fontId="${index === 0 ? 1 : 0}" fillId="${fill + 2}" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>`),
  ]
  parts['xl/styles.xml'] = `${XML}<styleSheet xmlns="${NS}"><fonts count="2"><font><sz val="10"/><name val="Arial"/><color rgb="FF000000"/></font><font><b/><sz val="10"/><name val="Arial"/><color rgb="FF000000"/></font></fonts><fills count="${fillColors.length + 2}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fillColors.map(color => `<fill><patternFill patternType="solid"><fgColor rgb="${color}"/><bgColor indexed="64"/></patternFill></fill>`).join('')}</fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border>${['left','right','top','bottom'].map(edge => `<${edge} style="thin"><color rgb="FF000000"/></${edge}>`).join('')}<diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`
  parts['xl/workbook.xml'] = `${XML}<workbook xmlns="${NS}" xmlns:r="${REL}"><bookViews><workbookView/></bookViews><sheets>${names.map((name, index) => `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`
  const packageRel = 'http://schemas.openxmlformats.org/package/2006/relationships'
  parts['xl/_rels/workbook.xml.rels'] = `${XML}<Relationships xmlns="${packageRel}">${names.map((_, index) => `<Relationship Id="rId${index + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}<Relationship Id="rIdStyles" Type="${REL}/styles" Target="styles.xml"/></Relationships>`
  parts['_rels/.rels'] = `${XML}<Relationships xmlns="${packageRel}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`
  parts['[Content_Types].xml'] = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`
  const zip = CFB.utils.cfb_new()
  for (const [path, content] of Object.entries(parts)) CFB.utils.cfb_add(zip, path, new TextEncoder().encode(content))
  return { bytes: new Uint8Array(CFB.write(zip, { fileType: 'zip' })), weekStart, weekEnd }
}

export function downloadRoomScheduleExcel(rooms: string[], csvEvents: CalendarEvent[], adminEvents: CalendarEvent[], selectedDate: Date, scheduleName: string) {
  const { bytes, weekStart } = createRoomScheduleExcel(rooms, csvEvents, adminEvents, selectedDate)
  const blob = new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${scheduleName.replace(/\.(csv|xlsx?)$/i, '').replace(/[<>:"/\\|?*]/g, '_') || 'Schedule'}_${weekStart}.xlsx`
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
