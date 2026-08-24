import fs from 'node:fs/promises'
import { FileBlob, SpreadsheetFile, Workbook } from '@oai/artifact-tool'

const inputPath = 'C:/Users/jap/Downloads/test_formatOfdate/student_schedule_1.xlsx'
const input = await FileBlob.load(inputPath)
const workbook = await SpreadsheetFile.importXlsx(input)

const overview = await workbook.inspect({
  kind: 'workbook,sheet,table',
  maxChars: 20000,
  tableMaxRows: 20,
  tableMaxCols: 20,
  tableMaxCellChars: 160,
})

console.log(overview.ndjson)

const csvText = await fs.readFile('C:/Users/jap/Downloads/test_formatOfdate/ScheduleFormat.csv', 'utf8')
const csvWorkbook = await Workbook.fromCSV(csvText, { sheetName: 'ScheduleFormat' })
const csvOverview = await csvWorkbook.inspect({
  kind: 'workbook,sheet,table',
  maxChars: 30000,
  tableMaxRows: 40,
  tableMaxCols: 20,
  tableMaxCellChars: 160,
})
console.log('---CSV---')
console.log(csvOverview.ndjson)

const preview = await workbook.render({ sheetName: 'Sheet1', range: 'A1:L9', scale: 1.5, format: 'png' })
await fs.writeFile('.tmp-spreadsheet-read/before.png', new Uint8Array(await preview.arrayBuffer()))

const studentValues = workbook.worksheets.getItem('Sheet1').getUsedRange().values
const scheduleValues = csvWorkbook.worksheets.getItem('ScheduleFormat').getUsedRange().values
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim()
const scheduleRows = scheduleValues.slice(1)
console.log('---MATCHES---')
for (const row of studentValues.slice(1)) {
  const [,,,, subjectCode,, start, end, day, room] = row
  const exact = scheduleRows.filter(source =>
    clean(source[2]) === clean(subjectCode)
    && Number(source[4]) === Number(start)
    && Number(source[5]) === Number(end)
    && clean(source[6]) === clean(day)
    && clean(source[9]) === clean(room),
  )
  const byStub = scheduleRows.filter(source => Number(source[1]) === Number(row[3]))
  console.log(JSON.stringify({
    subjectCode: clean(subjectCode), start, end, day: clean(day), room: clean(room),
    exact: exact.map(source => ({ professorId: clean(source[8]), name: [clean(source[11]), clean(source[12]), clean(source[13])].filter(Boolean).join(', ') })),
    byStub: byStub.map(source => ({ professorId: clean(source[8]), name: [clean(source[11]), clean(source[12]), clean(source[13])].filter(Boolean).join(', '), start: source[4], end: source[5], day: clean(source[6]), room: clean(source[9]) })),
  }))
}
