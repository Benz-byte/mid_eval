import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool'

const workbook = await SpreadsheetFile.importXlsx(
  await FileBlob.load('C:/Users/jap/Downloads/test_formatOfdate/student_schedule_1_filled.xlsx'),
)
const result = await workbook.inspect({
  kind: 'workbook,sheet,table',
  range: 'Sheet1!A1:L20',
  include: 'values,formulas',
  maxChars: 12000,
  tableMaxRows: 20,
  tableMaxCols: 14,
})
console.log(result.ndjson)
