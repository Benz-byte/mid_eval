import fs from 'node:fs/promises'
import { FileBlob, SpreadsheetFile, Workbook } from '@oai/artifact-tool'

const curriculumPath = 'C:/Users/jap/Downloads/test_formatOfdate/student_course_year_credit_units.xlsx'
const schedulePath = 'C:/Users/jap/Downloads/test_formatOfdate/ScheduleFormat.csv'
const outputDir = 'C:/Users/jap/Documents/mid_eval/outputs/generated_student_schedules'
const previewDir = 'C:/Users/jap/Documents/mid_eval/.tmp-spreadsheet-read/generated-student-previews'
const programs = ['BSCS', 'BSIT', 'BSIS', 'DMA']
const headers = ['SY', 'SEM', 'IDNO', 'STUBCODE', 'SUBJECTCODE', 'TITLE', 'START', 'END', 'DAYS', 'ROOM', 'EMPID', 'EMPNAME']

const clean = value => String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
const normalizeCode = value => clean(value).replace(/[^a-z0-9]/gi, '').toLowerCase()
const normalizeTitle = value => clean(value)
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
  .split(/\s+/)
  .map(word => word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word)
  .join(' ')
const hhmmToMinutes = value => {
  const digits = clean(value).replace(/\D/g, '')
  if (!digits) return null
  const number = Number(digits)
  const hour = Math.floor(number / 100)
  const minute = number % 100
  return hour >= 0 && hour <= 24 && minute >= 0 && minute < 60 ? hour * 60 + minute : null
}
const expandDays = value => {
  const normalized = clean(value).replace(/[\s,/-]+/g, '')
  const days = normalized.match(/Th|Su|M|T|W|F|S/g) ?? []
  return days.join('') === normalized ? days : []
}
const isMajor = (program, code) => {
  const normalized = clean(code).toUpperCase().replace(/\s+/g, '')
  if (program === 'BSCS') return /^(CCS|CS|CSPE)/.test(normalized)
  if (program === 'BSIT') return /^(CCS|IT|ITPE)/.test(normalized)
  if (program === 'BSIS') return /^(CCS|IS|ISPE)/.test(normalized)
  if (program === 'DMA') return /^(CCS|DMIA|DMBD|DMIAFE)/.test(normalized)
  return false
}
const meetingsConflict = (left, right) =>
  left.days.some(day => right.days.includes(day))
  && left.start < right.end
  && left.end > right.start

const curriculumWorkbook = await SpreadsheetFile.importXlsx(await FileBlob.load(curriculumPath))
const scheduleWorkbook = await Workbook.fromCSV(await fs.readFile(schedulePath, 'utf8'), { sheetName: 'ScheduleFormat' })
const scheduleValues = scheduleWorkbook.worksheets.getItem('ScheduleFormat').getUsedRange().values
const scheduleHeaders = scheduleValues[0].map(value => clean(value).replace(/^\uFEFF/, ''))
const scheduleColumn = label => {
  const index = scheduleHeaders.indexOf(label)
  if (index < 0) throw new Error(`ScheduleFormat.csv is missing ${label}.`)
  return index
}
const columns = {
  stub: scheduleColumn('StubCode'),
  subject: scheduleColumn('Subject'),
  title: scheduleColumn('SubjectTitle'),
  start: scheduleColumn('StartTime'),
  end: scheduleColumn('EndTime'),
  day: scheduleColumn('Day'),
  professorId: scheduleColumn('ProfessorID'),
  room: scheduleColumn('Room'),
  lastName: scheduleColumn('LastName'),
  firstName: scheduleColumn('FirstName'),
  middleName: scheduleColumn('MiddleName'),
}

const offeringMap = new Map()
for (const [sourceIndex, row] of scheduleValues.slice(1).entries()) {
  const subjectCode = clean(row[columns.subject])
  const stubCode = clean(row[columns.stub])
  const start = hhmmToMinutes(row[columns.start])
  const end = hhmmToMinutes(row[columns.end])
  const days = expandDays(row[columns.day])
  if (!subjectCode || !stubCode || start === null || end === null || end <= start || days.length === 0) continue
  const key = `${normalizeCode(subjectCode)}|${stubCode}`
  if (!offeringMap.has(key)) {
    offeringMap.set(key, {
      subjectKey: normalizeCode(subjectCode),
      subjectCode,
      title: clean(row[columns.title]),
      stubCode,
      rows: [],
      meetings: [],
    })
  }
  const offering = offeringMap.get(key)
  const lastName = clean(row[columns.lastName])
  const firstName = clean(row[columns.firstName])
  const middleName = clean(row[columns.middleName])
  offering.rows.push({
    sourceIndex,
    stubCode,
    subjectCode,
    title: clean(row[columns.title]),
    startValue: clean(row[columns.start]),
    endValue: clean(row[columns.end]),
    dayValue: clean(row[columns.day]),
    room: clean(row[columns.room]),
    professorId: clean(row[columns.professorId]),
    professorName: lastName
      ? `${lastName}, ${[firstName, middleName].filter(Boolean).join(' ')}`
      : [firstName, middleName].filter(Boolean).join(' '),
  })
  offering.meetings.push({ start, end, days })
}

const offeringsBySubject = new Map()
const offeringsByTitle = new Map()
for (const offering of offeringMap.values()) {
  if (!offeringsBySubject.has(offering.subjectKey)) offeringsBySubject.set(offering.subjectKey, [])
  offeringsBySubject.get(offering.subjectKey).push(offering)
  const titleKey = normalizeTitle(offering.title)
  if (!offeringsByTitle.has(titleKey)) offeringsByTitle.set(titleKey, [])
  offeringsByTitle.get(titleKey).push(offering)
}
for (const offerings of offeringsBySubject.values()) {
  offerings.sort((left, right) => Number(left.stubCode) - Number(right.stubCode) || left.stubCode.localeCompare(right.stubCode))
}

const curriculumByProgramYear = new Map()
for (const program of programs) {
  const sheet = curriculumWorkbook.worksheets.getItem(program)
  const values = sheet.getUsedRange().values
  let currentYear = null
  for (const row of values) {
    const label = clean(row[0])
    const yearMatch = /^Year\s+([1-4])$/i.exec(label)
    if (yearMatch) {
      currentYear = Number(yearMatch[1])
      if (!curriculumByProgramYear.has(`${program}|${currentYear}`)) {
        curriculumByProgramYear.set(`${program}|${currentYear}`, [])
      }
      continue
    }
    if (!currentYear || !label || /^Course Code$/i.test(label) || /^Total Credit Units$/i.test(label)) continue
    const units = Number(row[2])
    if (!Number.isFinite(units) || units <= 0) continue
    curriculumByProgramYear.get(`${program}|${currentYear}`).push({
      order: curriculumByProgramYear.get(`${program}|${currentYear}`).length,
      code: label,
      title: clean(row[1]),
      units,
    })
  }
}

const chooseOfferings = subjects => {
  const candidates = subjects
    .map(subject => {
      const exactCodeOfferings = offeringsBySubject.get(normalizeCode(subject.code)) ?? []
      const titleOfferings = offeringsByTitle.get(normalizeTitle(subject.title)) ?? []
      return {
        ...subject,
        offerings: exactCodeOfferings.length > 0 ? exactCodeOfferings : titleOfferings,
      }
    })
    .filter(subject => subject.offerings.length > 0)
    .sort((left, right) => left.offerings.length - right.offerings.length || right.units - left.units || left.order - right.order)
  const remainingUnits = Array(candidates.length + 1).fill(0)
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    remainingUnits[index] = remainingUnits[index + 1] + candidates[index].units
  }
  let best = { units: 0, selections: [] }
  const search = (index, units, selections, meetings) => {
    if (units > best.units || (units === best.units && selections.length > best.selections.length)) {
      best = { units, selections: [...selections] }
    }
    if (index >= candidates.length || units + remainingUnits[index] <= best.units) return
    const subject = candidates[index]
    if (units + subject.units <= 30) {
      for (const offering of subject.offerings) {
        const conflicts = offering.meetings.some(proposed =>
          meetings.some(existing => meetingsConflict(proposed, existing)),
        )
        if (conflicts) continue
        search(
          index + 1,
          units + subject.units,
          [...selections, { subject, offering }],
          [...meetings, ...offering.meetings],
        )
      }
    }
    search(index + 1, units, selections, meetings)
  }
  search(0, 0, [], [])
  return best
}

const results = []
await fs.mkdir(outputDir, { recursive: true })
await fs.mkdir(previewDir, { recursive: true })
let studentNumber = 1
for (const program of programs) {
  for (let year = 1; year <= 4; year += 1) {
    const curriculum = curriculumByProgramYear.get(`${program}|${year}`) ?? []
    const majorSubjects = curriculum.filter(subject => isMajor(program, subject.code))
    const selection = chooseOfferings(majorSubjects)
    const studentId = `26-${String(studentNumber).padStart(4, '0')}-${String(year).padStart(2, '0')}`
    const selectedInCurriculumOrder = [...selection.selections].sort((left, right) => left.subject.order - right.subject.order)
    const outputRows = []
    for (const { subject, offering } of selectedInCurriculumOrder) {
      for (const row of [...offering.rows].sort((left, right) => left.sourceIndex - right.sourceIndex)) {
        outputRows.push([
          '2026-2027',
          '1st',
          studentId,
          row.stubCode,
          subject.code,
          subject.title,
          Number(row.startValue),
          Number(row.endValue),
          row.dayValue,
          row.room,
          row.professorId,
          row.professorName,
        ])
      }
    }

    const workbook = Workbook.create()
    const sheet = workbook.worksheets.add('Sheet1')
    sheet.getRangeByIndexes(0, 0, 1, headers.length).values = [headers]
    if (outputRows.length > 0) {
      sheet.getRangeByIndexes(1, 0, outputRows.length, headers.length).values = outputRows
    }
    const lastRow = Math.max(1, outputRows.length + 1)
    const used = sheet.getRange(`A1:L${lastRow}`)
    used.format.borders = { preset: 'all', style: 'thin', color: '#CBD5E1' }
    used.format.verticalAlignment = 'center'
    sheet.getRange('A1:L1').format = {
      fill: '#17365D',
      font: { bold: true, color: '#FFFFFF' },
      horizontalAlignment: 'center',
      rowHeight: 26,
    }
    sheet.getRange('A:A').format.columnWidth = 13
    sheet.getRange('B:B').format.columnWidth = 8
    sheet.getRange('C:C').format.columnWidth = 14
    sheet.getRange('D:D').format.columnWidth = 11
    sheet.getRange('E:E').format.columnWidth = 15
    sheet.getRange('F:F').format.columnWidth = 48
    sheet.getRange('G:H').format.columnWidth = 10
    sheet.getRange('I:I').format.columnWidth = 9
    sheet.getRange('J:J').format.columnWidth = 12
    sheet.getRange('K:K').format.columnWidth = 15
    sheet.getRange('L:L').format.columnWidth = 34
    sheet.getRange('F:F').format.wrapText = true
    sheet.getRange('L:L').format.wrapText = true
    used.format.autofitRows()
    sheet.freezePanes.freezeRows(1)
    sheet.showGridLines = false

    const errorScan = await workbook.inspect({
      kind: 'match',
      searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
      options: { useRegex: true, maxResults: 50 },
      summary: `${program} Year ${year} formula error scan`,
    })
    if (!errorScan.ndjson.includes('matched 0 entries')) throw new Error(errorScan.ndjson)
    const fileName = `${program}_Year${year}_Student.xlsx`
    const preview = await workbook.render({ sheetName: 'Sheet1', range: `A1:L${lastRow}`, scale: 1.2, format: 'png' })
    await fs.writeFile(`${previewDir}/${program}_Year${year}.png`, new Uint8Array(await preview.arrayBuffer()))
    const output = await SpreadsheetFile.exportXlsx(workbook)
    await output.save(`${outputDir}/${fileName}`)
    results.push({
      fileName,
      studentId,
      program,
      year,
      creditUnits: selection.units,
      selectedSubjects: selectedInCurriculumOrder.map(item => `${item.subject.code} [${item.offering.stubCode}]`),
      rowCount: outputRows.length,
    })
    studentNumber += 1
  }
}

if (results.length !== 16) throw new Error(`Expected 16 outputs, created ${results.length}.`)
await fs.writeFile(
  'C:/Users/jap/Documents/mid_eval/.tmp-spreadsheet-read/generated-student-results.json',
  JSON.stringify(results, null, 2),
)
console.log(JSON.stringify(results, null, 2))
