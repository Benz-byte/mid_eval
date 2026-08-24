import fs from 'node:fs/promises'
import path from 'node:path'
import { FileBlob, SpreadsheetFile, Workbook } from '@oai/artifact-tool'

const studentPath = 'C:/Users/jap/Downloads/test_formatOfdate/student_schedule_1.xlsx'
const csvPath = 'C:/Users/jap/Downloads/test_formatOfdate/ScheduleFormat.csv'
const outputDir = 'C:/Users/jap/Documents/mid_eval/outputs/student_schedule_professors'
const outputPath = `${outputDir}/student_schedule_1_filled.xlsx`
const previewPath = 'C:/Users/jap/Documents/mid_eval/.tmp-spreadsheet-read/after.png'

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(studentPath))
const csvWorkbook = await Workbook.fromCSV(await fs.readFile(csvPath, 'utf8'), { sheetName: 'ScheduleFormat' })
const sheet = workbook.worksheets.getItem('Sheet1')
const studentValues = sheet.getRange('A1:L9').values
const scheduleValues = csvWorkbook.worksheets.getItem('ScheduleFormat').getUsedRange().values
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim()

const professorCells = studentValues.slice(1).map((row, index) => {
  const subjectCode = clean(row[4])
  const start = Number(row[6])
  const end = Number(row[7])
  const day = clean(row[8])
  const room = clean(row[9])
  const matches = scheduleValues.slice(1).filter(source =>
    clean(source[2]) === subjectCode
    && Number(source[4]) === start
    && Number(source[5]) === end
    && clean(source[6]) === day
    && clean(source[9]) === room,
  )
  if (matches.length !== 1) {
    throw new Error(`Student row ${index + 2} matched ${matches.length} source rows`)
  }
  const source = matches[0]
  const employeeId = clean(source[8])
  const lastName = clean(source[11])
  const firstName = clean(source[12])
  const middleName = clean(source[13])
  const employeeName = `${lastName}, ${[firstName, middleName].filter(Boolean).join(' ')}`
  if (!employeeId || !lastName || !firstName) {
    throw new Error(`Student row ${index + 2} has incomplete professor data`)
  }
  return [employeeId, employeeName]
})

sheet.getRange('K2:L9').values = professorCells
await fs.mkdir(outputDir, { recursive: true })
const output = await SpreadsheetFile.exportXlsx(workbook)
await output.save(outputPath)

const finalValues = sheet.getRange('A1:L9').values
const writtenValues = sheet.getRange('K2:L9').values
const expected = JSON.stringify(professorCells)
if (JSON.stringify(writtenValues) !== expected) {
  throw new Error('EMPID/EMPNAME verification failed')
}
const formulaErrors = finalValues.flat().filter(value =>
  typeof value === 'string' && /^#(?:REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|NULL!)/.test(value),
)
if (formulaErrors.length) {
  throw new Error(`Formula errors found: ${formulaErrors.join(', ')}`)
}

const preview = await workbook.render({ sheetName: 'Sheet1', range: 'A1:L9', scale: 1.5, format: 'png' })
await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()))
console.log(JSON.stringify({ outputPath, previewPath, rowsFilled: professorCells.length, professorCells }, null, 2))
