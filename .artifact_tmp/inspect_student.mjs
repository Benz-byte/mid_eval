import { FileBlob, SpreadsheetFile } from '@oai/artifact-tool';

const path = 'C:/Users/jap/Documents/mid_eval/samples/BSCS_Year1_Student.xlsx';
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(path));
const overview = await workbook.inspect({
  kind: 'sheet,table',
  maxChars: 10000,
  tableMaxRows: 20,
  tableMaxCols: 12,
  tableMaxCellChars: 100,
});
process.stdout.write(overview.ndjson);
