import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool'

const workbook = await SpreadsheetFile.importXlsx(
  await FileBlob.load('C:/Users/jap/Documents/mid_eval/samples/BSCS_Year1_Student.xlsx'),
)
const sheet = workbook.worksheets.getItemAt(0)
console.log(JSON.stringify(sheet.getUsedRange().values, null, 2))
