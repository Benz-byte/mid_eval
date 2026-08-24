import fs from 'node:fs/promises'
import { FileBlob, SpreadsheetFile, Workbook } from '@oai/artifact-tool'

const clean = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
const normalize = value => clean(value).replace(/[^a-z0-9]/gi, '').toLowerCase()
const curriculum = await SpreadsheetFile.importXlsx(await FileBlob.load('C:/Users/jap/Downloads/test_formatOfdate/student_course_year_credit_units.xlsx'))
const schedule = await Workbook.fromCSV(await fs.readFile('C:/Users/jap/Downloads/test_formatOfdate/ScheduleFormat.csv', 'utf8'), { sheetName: 'ScheduleFormat' })
const scheduleRows = schedule.worksheets.getItem('ScheduleFormat').getUsedRange().values.slice(1)
const offered = scheduleRows.map(row => ({ code: clean(row[2]), title: clean(row[3]) }))
const codeSet = new Set(offered.map(item => normalize(item.code)))
const titleMap = new Map()
for (const item of offered) {
  const key = normalize(item.title)
  if (!titleMap.has(key)) titleMap.set(key, new Set())
  titleMap.get(key).add(item.code)
}
const isMajor = (program, code) => {
  const value = clean(code).toUpperCase().replace(/\s+/g, '')
  if (program === 'BSCS') return /^(CCS|CS|CSPE)/.test(value)
  if (program === 'BSIT') return /^(CCS|IT|ITPE)/.test(value)
  if (program === 'BSIS') return /^(CCS|IS|ISPE)/.test(value)
  return /^(CCS|DMIA|DMBD|DMIAFE)/.test(value)
}
for (const program of ['BSCS', 'BSIT', 'BSIS', 'DMA']) {
  let year = 0
  for (const row of curriculum.worksheets.getItem(program).getUsedRange().values) {
    const yearMatch = /^Year\s+([1-4])$/i.exec(clean(row[0]))
    if (yearMatch) { year = Number(yearMatch[1]); continue }
    const code = clean(row[0]); const title = clean(row[1]); const units = Number(row[2])
    if (!year || !code || !Number.isFinite(units) || !isMajor(program, code)) continue
    const exact = codeSet.has(normalize(code))
    const titleCodes = [...(titleMap.get(normalize(title)) ?? [])]
    console.log(JSON.stringify({ program, year, code, title, units, exactCode: exact, sameTitleCodes: titleCodes }))
  }
}
