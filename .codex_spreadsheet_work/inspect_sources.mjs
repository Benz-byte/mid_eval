import fs from 'node:fs/promises'
import path from 'node:path'
import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool'

const root = 'C:/Users/jap/Documents/mid_eval'
const files = [
  'BSCS_Year1_Student.xlsx', 'BSCS_Year2_Student.xlsx',
  'BSCS_Year3_Student.xlsx', 'BSCS_Year4_Student.xlsx',
  'BSIS_Year1_Student.xlsx', 'BSIS_Year2_Student.xlsx',
  'BSIS_Year3_Student.xlsx', 'BSIS_Year4_Student.xlsx',
  'BSIT_Year1_Student.xlsx', 'BSIT_Year2_Student.xlsx',
  'BSIT_Year3_Student.xlsx', 'BSIT_Year4_Student.xlsx',
  'DMA_Year1_Student.xlsx', 'DMA_Year2_Student.xlsx',
  'DMA_Year3_Student.xlsx', 'DMA_Year4_Student.xlsx',
]

const previewDir = path.join(root, '.codex_spreadsheet_work', 'source_previews')
await fs.mkdir(previewDir, { recursive: true })
const summaries = []

for (const filename of files) {
  const inputPath = path.join(root, 'samples', filename)
  const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(inputPath))
  const sheet = workbook.worksheets.getItemAt(0)
  const used = sheet.getUsedRange()
  const values = used?.values ?? []
  const inspection = await workbook.inspect({
    kind: 'sheet,region,computedStyle',
    sheetId: sheet.name,
    range: 'A1:H18',
    maxChars: 3500,
    tableMaxRows: 18,
    tableMaxCols: 8,
  })
  const preview = await workbook.render({
    sheetName: sheet.name,
    autoCrop: 'all',
    scale: 1,
    format: 'png',
  })
  const previewPath = path.join(previewDir, filename.replace(/\.xlsx$/i, '.png'))
  await fs.writeFile(previewPath, new Uint8Array(await preview.arrayBuffer()))
  summaries.push({
    filename,
    sheetName: sheet.name,
    rowCount: values.length,
    columnCount: Math.max(0, ...values.map(row => row.length)),
    values: values.slice(0, 18).map(row => row.slice(0, 8)),
    inspection: inspection.ndjson,
    previewPath,
  })
}

await fs.writeFile(
  path.join(root, '.codex_spreadsheet_work', 'source_summaries.json'),
  JSON.stringify(summaries, null, 2),
)
console.log(JSON.stringify(summaries.map(({ filename, sheetName, rowCount, columnCount, values, previewPath }) => ({
  filename, sheetName, rowCount, columnCount, values, previewPath,
})), null, 2))
