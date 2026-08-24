import fs from 'node:fs/promises'
import { FileBlob, SpreadsheetFile, Workbook } from '@oai/artifact-tool'

const outputDir = 'C:/Users/jap/Documents/mid_eval/outputs/curriculum_course_year'
const outputPath = `${outputDir}/student_course_year_credit_units.xlsx`
const previewDir = 'C:/Users/jap/Documents/mid_eval/.tmp-spreadsheet-read/curriculum-previews'

const sharedFirstYear = [
  ['CCS 1001', 'Introduction to Computing', 3],
  ['CCS 1400', 'Fundamentals of Programming', 3],
  ['GEMath 1', 'Mathematics in the Modern World', 3],
  ['GESocSci 1', 'Understanding the Self', 3],
  ['CETech 1', 'Living in the IT Era', 3],
  ['Fil 12', 'Sayko-Sosyolinggwistik na Pag-aaral ng Wikang Filipino', 3],
  ['SEA1', 'Student Enhancement Activities for Life I', 1],
  ['RE 1', 'Christianity in a Changing Society', 3],
  ['PE 1a (W) / PE 2B (M)', 'Physical Fitness and Wellness / Individual-Dual Sports (Swimming)', 2],
  ['NSTP 1 - CWTS / LTS / ROTC', 'NSTP option: CWTS, Literacy Training Service, or ROTC', 3],
]

const curricula = {
  BSCS: {
    1: sharedFirstYear,
    2: [
      ['CCS 2100', 'Fundamentals of Database Design', 3],
      ['CS 2111', 'Structure of Programming Languages', 3],
      ['CCS 2110', 'Application Development and Emerging Technologies', 3],
      ['CCS 2200', 'Basic Electrical and Electronic Concepts', 3],
      ['CCS 2800', 'Mobile Application Development I', 3],
      ['Math 2110', 'Calculus', 3],
      ['CS 2120', 'Discrete Structures I', 3],
      ['GEHum 1', 'Art Appreciation', 3],
      ['PE 3a', 'Rhythmic Activities', 2],
    ],
    3: [
      ['CCS 3001', 'Computer Organization & Assembly Language', 3],
      ['CCS 3010', 'Fundamentals of Human Computer Interaction', 3],
      ['CCS 3020', 'Information Assurance and Security I', 3],
      ['CCS 3030', 'Web Systems and Technologies', 3],
      ['CCS 3100', 'Methods of Research in IT', 3],
      ['CCS 3200', 'Mobile Application Development II', 3],
      ['CSPE 2', 'Professional Elective', 3],
      ['CS 3120', 'Algorithms and Complexities', 3],
      ['GESocSci 3', 'Life and Works of Rizal', 3],
    ],
    4: [
      ['CCS 4100', 'CCS Thesis II', 3],
      ['CS 4110', 'Artificial Intelligence', 3],
      ['CCS 4300', 'Social Issues and Professional Practices', 3],
      ['CSPE 4', 'Professional Elective', 3],
      ['GESocSci 6', 'Science, Technology and Society', 3],
    ],
  },
  BSIT: {
    1: sharedFirstYear,
    2: [
      ['CCS 2100', 'Fundamentals of Database Design', 3],
      ['CCS 2200', 'Basic Electrical and Electronic Concepts', 3],
      ['CCS 2110', 'Application Development and Emerging Technologies', 3],
      ['CCS 2800', 'Mobile Application Development I', 3],
      ['Math 2109', 'Discrete Mathematics', 3],
      ['IT 2110', 'Platform Technologies', 3],
      ['GEHum 1', 'Art Appreciation', 3],
      ['GESocSci 3', 'Life and Works of Rizal', 3],
      ['PE 3a', 'Rhythmic Activities', 2],
    ],
    3: [
      ['CCS 3100', 'Methods of Research in IT', 3],
      ['CCS 3010', 'Fundamentals of Human Computer Interaction', 3],
      ['CCS 3020', 'Information Assurance and Security I', 3],
      ['CCS 3030', 'Web Systems and Technologies', 3],
      ['IT 3121', 'Network Engineering II: Switching, Routing, and Wireless Essentials', 3],
      ['ITPE 2', 'Professional Elective', 3],
      ['IT 3131', 'System Administration and Maintenance', 3],
      ['CCS 3200', 'Mobile Application Development II', 3],
      ['GESocSci 6', 'Science, Technology and Society', 3],
    ],
    4: [
      ['CCS 4100', 'CCS Thesis II', 3],
      ['CCS 4300', 'Social Issues and Professional Practices', 3],
      ['ITPE 4', 'Professional Elective', 3],
      ['IT 4120', 'Advanced Database Systems', 3],
      ['IT 4130', 'Advanced System Integration and Architecture', 3],
    ],
  },
  BSIS: {
    1: sharedFirstYear,
    2: [
      ['IS 2110', 'Organization and Management Concepts', 3],
      ['IS 2120', 'Fundamentals of IS', 3],
      ['IS 2130', 'Accounting Information System', 3],
      ['CCS 2100', 'Fundamentals of Database Design', 3],
      ['GEHum 1', 'Art Appreciation', 3],
      ['GESocSci 2', 'Readings in Philippine History', 3],
      ['PE 3a', 'Rhythmic Activities', 2],
    ],
    3: [
      ['CCS 3010', 'Fundamentals of Human Computer Interaction', 3],
      ['CCS 3100', 'Methods of Research in IT', 3],
      ['IS 3110', 'Information Systems Project Management', 3],
      ['CCS 3030', 'Web Systems and Technologies', 3],
      ['IS 3120', 'IS Strategy, Management and Acquisition', 3],
      ['IS 3130', 'Evaluation of Business Performance', 3],
      ['ISPE 2', 'Professional Elective', 3],
    ],
    4: [
      ['CCS 4100', 'CCS Thesis II', 3],
      ['CCS 4300', 'Social Issues and Professional Practices', 3],
      ['CCS 3020', 'Information Assurance and Security I', 3],
      ['IS 4110', 'Professional Issues in IS', 3],
      ['ISPE 4', 'Professional Elective', 3],
      ['GESocSci 6', 'Science, Technology and Society', 3],
    ],
  },
  DMA: {
    1: [
      ['DMIA 1101', 'Elements and Principles of Art and Design', 3],
      ['DMIA 1102', 'Drawing and Illustration I: Fundamentals', 3],
      ['DMIA 1103', 'Color Theory', 1],
      ['GEMath 1', 'Mathematics in the Modern World', 3],
      ['GESocSci 1', 'Understanding the Self', 3],
      ['CETech 1', 'Living in the IT Era', 3],
      ['Fil 12', 'Sayko-Sosyolinggwistik na Pag-aaral ng Wikang Filipino', 3],
      ['SEA1', 'Student Enhancement Activities for Life I', 1],
      ['RE 1', 'Christianity in a Changing Society', 3],
      ['PE 1a (W) / PE 2B (M)', 'Physical Fitness and Wellness / Individual-Dual Sports (Swimming)', 2],
      ['NSTP 1 - CWTS / LTS / ROTC', 'NSTP option: CWTS, Literacy Training Service, or ROTC', 3],
    ],
    2: [
      ['DMIA 2101', 'Shapes, Forms and Spaces', 1],
      ['DMIA 2102', 'Essentials of 2D and 3D Design', 3],
      ['DMIA 2103', 'Design and Digital Imaging', 1],
      ['DMIA 2104', 'Digital Photography', 3],
      ['CCS 1400', 'Fundamentals of Programming', 3],
      ['Math 2108', 'Analytic Geometry with Solid Mensuration', 3],
      ['DMIA 2205', 'Media and Social Psychology', 3],
      ['GESocSci 3', 'Life and Works of Rizal', 3],
      ['GESocSci 6', 'Science, Technology and Society', 3],
      ['PE 3a', 'Rhythmic Activities', 2],
    ],
    3: [
      ['DMIA 3100', 'Methods of Research', 3],
      ['DMIA 3110', 'Interactive Digital Storytelling', 1],
      ['DMBD 3101', 'Motion and Broadcast Design Principles', 3],
      ['DMBD 3102', 'Information Design', 3],
      ['DMBD 3103', 'Motion Typography', 1],
      ['DMBD 3104', '3D Motion Graphics and Design', 3],
      ['DMIAFE 1', 'Digital Media Free Elective', 3],
      ['CCS 3030', 'Web System and Technologies', 3],
      ['DMIA 3120', 'Physical Interaction Design', 1],
      ['GESocSci 2', 'Readings in Philippine History', 3],
    ],
    4: [
      ['DMIA 4102', 'Digital Media Law with Professional Ethics', 3],
      ['DMIA 4103', 'Digital Arts Entrepreneurship', 3],
      ['DMIAFE 3', 'Digital Media Free Elective', 3],
      ['DMIA 4100', 'Portfolio Development II', 3],
      ['CCS 4300', 'Social Issues and Professional Practices', 3],
    ],
  },
}

const workbook = Workbook.create()
const navy = '#17365D'
const blue = '#D9EAF7'
const light = '#F3F6FA'
const border = '#AAB7C4'

const styleSheet = (sheet, usedRange) => {
  usedRange.format.borders = { preset: 'all', style: 'thin', color: border }
  usedRange.format.verticalAlignment = 'center'
  sheet.showGridLines = false
  sheet.freezePanes.freezeRows(3)
}

for (const [program, years] of Object.entries(curricula)) {
  const sheet = workbook.worksheets.add(program)
  sheet.getRange('A1:C1').merge()
  sheet.getRange('A1').values = [[`${program} Curriculum by Year — First Semester`]]
  sheet.getRange('A1:C1').format = {
    fill: navy,
    font: { name: 'Aptos Display', size: 16, bold: true, color: '#FFFFFF' },
    horizontalAlignment: 'center',
    rowHeight: 30,
  }
  let row = 3
  for (const [year, courses] of Object.entries(years)) {
    sheet.getRange(`A${row}:C${row}`).merge()
    sheet.getRange(`A${row}`).values = [[`Year ${year}`]]
    sheet.getRange(`A${row}:C${row}`).format = {
      fill: blue,
      font: { bold: true, color: navy, size: 11 },
    }
    row += 1
    sheet.getRange(`A${row}:C${row}`).values = [['Course Code', 'Course Title', 'Credit Units']]
    sheet.getRange(`A${row}:C${row}`).format = {
      fill: navy,
      font: { bold: true, color: '#FFFFFF' },
      horizontalAlignment: 'center',
    }
    const dataStart = row + 1
    const dataEnd = dataStart + courses.length - 1
    sheet.getRange(`A${dataStart}:C${dataEnd}`).values = courses
    sheet.getRange(`C${dataStart}:C${dataEnd}`).format.numberFormat = '0'
    row = dataEnd + 1
    sheet.getRange(`A${row}:B${row}`).merge()
    sheet.getRange(`A${row}`).values = [['Total Credit Units']]
    sheet.getRange(`C${row}`).formulas = [[`=SUM(C${dataStart}:C${dataEnd})`]]
    sheet.getRange(`A${row}:C${row}`).format = {
      fill: light,
      font: { bold: true, color: navy },
    }
    row += 2
  }
  const used = sheet.getRange(`A1:C${row - 2}`)
  styleSheet(sheet, used)
  sheet.getRange('A:A').format.columnWidth = 24
  sheet.getRange('B:B').format.columnWidth = 62
  sheet.getRange('B:B').format.wrapText = true
  sheet.getRange('C:C').format.columnWidth = 14
  sheet.getRange('C:C').format.horizontalAlignment = 'center'
  used.format.autofitRows()
}

const inputWorkbook = await SpreadsheetFile.importXlsx(
  await FileBlob.load('C:/Users/jap/Downloads/test_formatOfdate/student_schedule_1_filled.xlsx'),
)
const inputRows = inputWorkbook.worksheets.getItem('Sheet1').getRange('A1:L9').values
const headers = inputRows[0].map(value => String(value ?? '').trim().toUpperCase())
const subjectIndex = headers.indexOf('SUBJECTCODE')
const titleIndex = headers.indexOf('TITLE')
const studentIndex = headers.indexOf('IDNO')
if (subjectIndex < 0 || titleIndex < 0 || studentIndex < 0) {
  throw new Error('Student schedule is missing IDNO, SUBJECTCODE, or TITLE.')
}
const normalize = value => String(value ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase()
const uniqueSubjects = new Map()
for (const row of inputRows.slice(1)) {
  const code = String(row[subjectIndex] ?? '').trim()
  if (!code) continue
  const key = normalize(code)
  const existing = uniqueSubjects.get(key)
  if (existing) existing.meetingCount += 1
  else uniqueSubjects.set(key, {
    code,
    title: String(row[titleIndex] ?? '').trim(),
    meetingCount: 1,
  })
}

const referenceIndex = new Map()
for (const [program, years] of Object.entries(curricula)) {
  for (const [year, courses] of Object.entries(years)) {
    for (const [code, title, units] of courses) {
      const key = normalize(code)
      if (!referenceIndex.has(key)) referenceIndex.set(key, [])
      referenceIndex.get(key).push({ program, year: Number(year), title, units })
    }
  }
}

const detailRows = [...uniqueSubjects.values()].map(subject => {
  const matches = referenceIndex.get(normalize(subject.code)) ?? []
  const programs = [...new Set(matches.map(match => match.program))]
  const years = [...new Set(matches.map(match => match.year))]
  const units = matches.length ? Math.max(...matches.map(match => match.units)) : ''
  return [
    subject.code,
    subject.title,
    subject.meetingCount,
    programs.join(', ') || 'Not found',
    years.length === 1 ? `Year ${years[0]}` : years.map(year => `Year ${year}`).join(', ') || 'Not found',
    units,
  ]
})

const studentSheet = workbook.worksheets.add('Student Classification')
studentSheet.getRange('A1:F1').merge()
studentSheet.getRange('A1').values = [['Student Course and Year Classification']]
studentSheet.getRange('A1:F1').format = {
  fill: navy,
  font: { name: 'Aptos Display', size: 16, bold: true, color: '#FFFFFF' },
  horizontalAlignment: 'center',
  rowHeight: 30,
}
const studentId = String(inputRows[1]?.[studentIndex] ?? '').trim()
studentSheet.getRange('A3:B5').values = [
  ['Student ID', studentId],
  ['Detected year', 'Second Year'],
  ['Likely program', 'BSCS or BSIT (tie based on 5 of 6 unique subjects)'],
]
studentSheet.getRange('A3:A5').format = { fill: blue, font: { bold: true, color: navy } }
studentSheet.getRange('A7:F7').values = [[
  'Course Code', 'Course Title', 'Meeting Rows', 'Curriculum Program Match', 'Year Match', 'Credit Units',
]]
studentSheet.getRange('A7:F7').format = {
  fill: navy,
  font: { bold: true, color: '#FFFFFF' },
  horizontalAlignment: 'center',
}
const detailStart = 8
const detailEnd = detailStart + detailRows.length - 1
studentSheet.getRange(`A${detailStart}:F${detailEnd}`).values = detailRows
studentSheet.getRange(`C${detailStart}:C${detailEnd}`).format.numberFormat = '0'
studentSheet.getRange(`F${detailStart}:F${detailEnd}`).format.numberFormat = '0'
const totalRow = detailEnd + 1
studentSheet.getRange(`A${totalRow}:E${totalRow}`).merge()
studentSheet.getRange(`A${totalRow}`).values = [['Total unique credit units (repeated meetings counted once)']]
studentSheet.getRange(`F${totalRow}`).formulas = [[`=SUM(F${detailStart}:F${detailEnd})`]]
studentSheet.getRange(`A${totalRow}:F${totalRow}`).format = {
  fill: light,
  font: { bold: true, color: navy },
}
studentSheet.getRange(`A${totalRow + 2}:B${totalRow + 5}`).values = [
  ['Program', 'Matched unique subjects'],
  ['BSCS', ''],
  ['BSIT', ''],
  ['BSIS', ''],
]
studentSheet.getRange(`A${totalRow + 2}:B${totalRow + 2}`).format = {
  fill: navy,
  font: { bold: true, color: '#FFFFFF' },
}
for (let row = totalRow + 3; row <= totalRow + 5; row += 1) {
  const matchTerms = Array.from(
    { length: detailEnd - detailStart + 1 },
    (_, index) => `IF(ISNUMBER(SEARCH(A${row},D${detailStart + index})),1,0)`,
  )
  studentSheet.getRange(`B${row}`).formulas = [[
    `=${matchTerms.join('+')}`,
  ]]
}
studentSheet.getRange(`A${totalRow + 7}:F${totalRow + 7}`).merge()
studentSheet.getRange(`A${totalRow + 7}`).values = [[
  'Note: Program cannot be identified uniquely from this schedule because BSCS and BSIT each match five of the six unique subjects.',
]]
studentSheet.getRange(`A${totalRow + 7}:F${totalRow + 7}`).format = {
  fill: '#FFF2CC',
  font: { italic: true, color: '#7F6000' },
  wrapText: true,
}
const studentUsed = studentSheet.getRange(`A1:F${totalRow + 7}`)
styleSheet(studentSheet, studentUsed)
studentSheet.getRange('A:A').format.columnWidth = 20
studentSheet.getRange('B:B').format.columnWidth = 48
studentSheet.getRange('C:C').format.columnWidth = 14
studentSheet.getRange('D:D').format.columnWidth = 28
studentSheet.getRange('E:E').format.columnWidth = 14
studentSheet.getRange('F:F').format.columnWidth = 14
studentSheet.getRange('B:B').format.wrapText = true
studentSheet.getRange('D:D').format.wrapText = true
studentUsed.format.autofitRows()

await fs.mkdir(outputDir, { recursive: true })
await fs.mkdir(previewDir, { recursive: true })
for (const sheetName of ['Student Classification', 'BSCS', 'BSIT', 'BSIS', 'DMA']) {
  const preview = await workbook.render({ sheetName, autoCrop: 'all', scale: 1.1, format: 'png' })
  await fs.writeFile(`${previewDir}/${sheetName.replaceAll(' ', '_')}.png`, new Uint8Array(await preview.arrayBuffer()))
}
const errors = await workbook.inspect({
  kind: 'match',
  searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
  options: { useRegex: true, maxResults: 100 },
  summary: 'final formula error scan',
})
console.log(errors.ndjson)
const check = await workbook.inspect({
  kind: 'table',
  range: `Student Classification!A1:F${totalRow + 7}`,
  include: 'values,formulas',
  tableMaxRows: 30,
  tableMaxCols: 8,
  maxChars: 12000,
})
console.log(check.ndjson)
const output = await SpreadsheetFile.exportXlsx(workbook)
await output.save(outputPath)
console.log(JSON.stringify({ outputPath, totalSubjects: detailRows.length }))
