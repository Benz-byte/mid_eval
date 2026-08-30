import fs from 'node:fs/promises'
import path from 'node:path'
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool'

const root = 'C:/Users/jap/Documents/mid_eval'
const sourceDir = path.join(root, 'samples')
const outputDir = path.join(root, 'outputs', 'student_assistant_samples_40')
const cohorts = [
  'BSCS_Year1_Student.xlsx', 'BSCS_Year2_Student.xlsx',
  'BSCS_Year3_Student.xlsx', 'BSCS_Year4_Student.xlsx',
  'BSIS_Year1_Student.xlsx', 'BSIS_Year2_Student.xlsx',
  'BSIS_Year3_Student.xlsx', 'BSIS_Year4_Student.xlsx',
  'BSIT_Year1_Student.xlsx', 'BSIT_Year2_Student.xlsx',
  'BSIT_Year3_Student.xlsx', 'BSIT_Year4_Student.xlsx',
  'DMA_Year1_Student.xlsx', 'DMA_Year2_Student.xlsx',
  'DMA_Year3_Student.xlsx', 'DMA_Year4_Student.xlsx',
]

const minorSubjects = [
  { stub: '1201', code: 'MIN 101', title: 'Introduction to Data Analytics' },
  { stub: '1202', code: 'MIN 102', title: 'Digital Entrepreneurship' },
  { stub: '1203', code: 'MIN 103', title: 'Creative Communication' },
]
const minorSlots = [
  { day: 'F', start: 1600, end: 1800 },
  { day: 'S', start: 1000, end: 1200 },
  { day: 'W', start: 1800, end: 2000 },
  { day: 'Th', start: 700, end: 900 },
  { day: 'M', start: 1800, end: 2000 },
]

function timeToMinutes(value) {
  const number = Number(value)
  return Math.floor(number / 100) * 60 + (number % 100)
}

function dayTokens(value) {
  return String(value ?? '').match(/Th|Su|M|T|W|F|S/g) ?? []
}

function availableMinorSlot(rows) {
  return minorSlots.find(candidate => rows.every(row => {
    if (!dayTokens(row[8]).includes(candidate.day)) return true
    return timeToMinutes(candidate.end) <= timeToMinutes(row[6])
      || timeToMinutes(candidate.start) >= timeToMinutes(row[7])
  })) ?? minorSlots[0]
}

function outputName(filename, ordinal) {
  if (ordinal === 1) return filename
  return filename.replace(/\.xlsx$/i, `_${String(ordinal).padStart(2, '0')}.xlsx`)
}

await fs.rm(outputDir, { recursive: true, force: true })
await fs.mkdir(outputDir, { recursive: true })

let newStudentNumber = 17
let generatedStudentNumber = 0
const manifest = []

for (const filename of cohorts) {
  const year = Number(filename.match(/Year(\d)/)?.[1] ?? 1)
  const studentCount = year <= 2 ? 3 : 2

  for (let ordinal = 1; ordinal <= studentCount; ordinal += 1) {
    const workbook = await SpreadsheetFile.importXlsx(
      await FileBlob.load(path.join(sourceDir, filename)),
    )
    const sheet = workbook.worksheets.getItemAt(0)
    const used = sheet.getUsedRange()
    const originalRows = used.values.slice(1)
    const id = ordinal === 1
      ? String(originalRows[0][2])
      : `26-${String(newStudentNumber++).padStart(4, '0')}-${String(year).padStart(2, '0')}`

    if (ordinal > 1) {
      sheet.getRange(`C2:C${originalRows.length + 1}`).values = originalRows.map(() => [id])
    }

    generatedStudentNumber += 1
    const addMinor = ordinal > 1 && generatedStudentNumber % 2 === 0
    let minor = null
    if (addMinor) {
      const subject = minorSubjects[(generatedStudentNumber / 2) % minorSubjects.length | 0]
      const slot = availableMinorSlot(originalRows)
      const targetRow = originalRows.length + 2
      const sourceRow = originalRows.length + 1
      const targetRange = sheet.getRange(`A${targetRow}:L${targetRow}`)
      targetRange.copyFrom(sheet.getRange(`A${sourceRow}:L${sourceRow}`), 'all')
      targetRange.values = [[
        originalRows[0][0], originalRows[0][1], id,
        subject.stub, subject.code, subject.title,
        slot.start, slot.end, slot.day, 'TBA',
        '26-E099-01', 'Reyes, Andrea M.',
      ]]
      minor = { ...subject, ...slot }
    }

    const finalName = outputName(filename, ordinal)
    const output = await SpreadsheetFile.exportXlsx(workbook)
    await output.save(path.join(outputDir, finalName))
    manifest.push({ filename: finalName, cohort: filename, ordinal, id, minor })
  }
}

await fs.writeFile(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(JSON.stringify({ outputDir, studentCount: manifest.length, minorCount: manifest.filter(item => item.minor).length }, null, 2))
