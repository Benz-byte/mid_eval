import fs from 'node:fs/promises'
import path from 'node:path'
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool'

const root = 'C:/Users/jap/Documents/mid_eval'
const outputDir = path.join(root, 'outputs', 'student_assistant_samples_40')
const previewDir = path.join(root, '.codex_spreadsheet_work', 'output_previews')
const expectedHeaders = ['SY', 'SEM', 'IDNO', 'STUBCODE', 'SUBJECTCODE', 'TITLE', 'START', 'END', 'DAYS', 'ROOM', 'EMPID', 'EMPNAME']
const filenames = (await fs.readdir(outputDir)).filter(name => name.endsWith('.xlsx')).sort()
await fs.rm(previewDir, { recursive: true, force: true })
await fs.mkdir(previewDir, { recursive: true })

const ids = new Set()
let minorCount = 0
const results = []

for (const filename of filenames) {
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(path.join(outputDir, filename)))
  const sheet = workbook.worksheets.getItemAt(0)
  const values = sheet.getUsedRange().values
  const headers = values[0].slice(0, 12).map(String)
  if (JSON.stringify(headers) !== JSON.stringify(expectedHeaders)) throw new Error(`${filename}: header mismatch`)
  const fileIds = new Set(values.slice(1).map(row => String(row[2])))
  if (fileIds.size !== 1) throw new Error(`${filename}: expected exactly one student ID`)
  const [id] = fileIds
  if (ids.has(id)) throw new Error(`${filename}: duplicate student ID ${id}`)
  ids.add(id)

  const minors = values.slice(1).filter(row => String(row[4]).startsWith('MIN '))
  minorCount += minors.length
  const formulaErrors = await workbook.inspect({
    kind: 'match',
    searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
    options: { useRegex: true, maxResults: 50 },
    summary: `formula error scan for ${filename}`,
    maxChars: 1200,
  })
  if (/"kind":"match"/.test(formulaErrors.ndjson) && !/"count":0/.test(formulaErrors.ndjson)) {
    throw new Error(`${filename}: formula error detected`)
  }

  const preview = await workbook.render({
    sheetName: sheet.name,
    autoCrop: 'all',
    scale: 1,
    format: 'png',
  })
  const previewPath = path.join(previewDir, filename.replace(/\.xlsx$/i, '.png'))
  await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()))
  results.push({ filename, id, rows: values.length - 1, minors: minors.length, previewPath })
}

if (filenames.length !== 40) throw new Error(`Expected 40 workbooks, found ${filenames.length}`)
if (ids.size !== 40) throw new Error(`Expected 40 unique IDs, found ${ids.size}`)
if (minorCount === 0) throw new Error('Expected optional minor subjects in selected workbooks')

const summary = { workbookCount: filenames.length, uniqueIdCount: ids.size, minorCount, results }
await fs.writeFile(path.join(root, '.codex_spreadsheet_work', 'verification_summary.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify({ workbookCount: filenames.length, uniqueIdCount: ids.size, minorCount }, null, 2))
