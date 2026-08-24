import fs from 'node:fs/promises'
import { FileBlob, SpreadsheetFile, Workbook } from '@oai/artifact-tool'

const source = await SpreadsheetFile.importXlsx(await FileBlob.load('C:/Users/jap/Downloads/CCS COURSE OFFERING 2NDSEM 26-27 8.24.2026.xls'))
const sourceOverview = await source.inspect({
  kind: 'workbook,sheet,table',
  maxChars: 30000,
  tableMaxRows: 30,
  tableMaxCols: 25,
  tableMaxCellChars: 120,
})
console.log('---SOURCE---')
console.log(sourceOverview.ndjson)

const csv = await Workbook.fromCSV(await fs.readFile('C:/Users/jap/Downloads/test_formatOfdate/ScheduleFormat.csv', 'utf8'), { sheetName: 'ScheduleFormat' })
const targetOverview = await csv.inspect({
  kind: 'workbook,sheet,table',
  maxChars: 16000,
  tableMaxRows: 10,
  tableMaxCols: 20,
  tableMaxCellChars: 120,
})
console.log('---TARGET---')
console.log(targetOverview.ndjson)
