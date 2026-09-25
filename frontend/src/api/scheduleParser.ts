import * as XLSX from 'xlsx'
import type { ScheduleImportResult } from '../types'
import { requestJson } from './apiClient'

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    const next = text[index + 1]
    if (character === '"') {
      if (quoted && next === '"') {
        field += '"'
        index += 1
      } else quoted = !quoted
    } else if (character === ',' && !quoted) {
      row.push(field)
      field = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index += 1
      row.push(field)
      if (row.some(value => value.trim())) rows.push(row)
      row = []
      field = ''
    } else field += character
  }
  row.push(field)
  if (row.some(value => value.trim())) rows.push(row)
  return rows
}

async function rowsFromFile(file: File): Promise<string[][]> {
  if (/\.csv$/i.test(file.name)) return parseCsvRows(await file.text())
  if (/\.xlsx?$/i.test(file.name)) {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellNF: true })
    return workbook.SheetNames.flatMap(sheetName => {
      const rows = XLSX.utils.sheet_to_json<(string | number | boolean)[]>(workbook.Sheets[sheetName], {
        header: 1,
        raw: false,
        defval: '',
        blankrows: true,
      })
      const sheet = workbook.Sheets[sheetName]
      const origin = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1').s
      return rows.map((row, rowIndex) => row.map((value, columnIndex) => {
        const cell = sheet[XLSX.utils.encode_cell({ r: origin.r + rowIndex, c: origin.c + columnIndex })]
        // Preserve actual identifiers/numbers, not currency display formats.
        // Date/time cells still need their formatted clock representation.
        return String(cell?.t === 'n' && !XLSX.SSF.is_date(cell.z ?? '') ? cell.v : value)
      }))
    })
  }
  throw new Error('Choose a CSV, XLS, or XLSX schedule file.')
}

export async function readScheduleFile(
  file: File,
  format: 'auto' | 'official' | 'legacy' | 'assistant' = 'legacy',
): Promise<ScheduleImportResult> {
  return requestJson<ScheduleImportResult>('/api/schedules/parse', {
    method: 'POST',
    body: JSON.stringify({ rows: await rowsFromFile(file), format }),
  })
}
