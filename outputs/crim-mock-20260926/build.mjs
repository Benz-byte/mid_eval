import fs from 'node:fs/promises';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const out = new URL('./', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const wb = Workbook.create();
const sheet = wb.worksheets.add('SubjectScheduleByDepartment');
sheet.showGridLines = false;
const subjects = [
  ['Steal an Egg', 'Grow a Garden', 'The Forge', 'Introduction to Criminology', 'Criminal Justice System', 'Criminal Law Fundamentals', 'Police Organization'],
  ['Criminal Investigation', 'Forensic Photography', 'Crime Prevention', 'Criminal Procedure', 'Traffic Management', 'Community Policing', 'Forensic Chemistry'],
  ['Forensic Science', 'Evidence Management', 'Correctional Administration', 'Juvenile Justice', 'Police Intelligence', 'Victimology', 'Criminal Psychology'],
  ['Criminological Research', 'Case Analysis', 'Disaster Response', 'Security Management', 'Professional Ethics', 'Mock Court Practice', 'Leadership in Policing'],
];
const teachers = ['Reyes', 'Santos', 'Cruz', 'Garcia', 'Mendoza', 'Torres', 'Ramos', 'Flores', 'Navarro', 'Castro', 'Dela Cruz', 'Aquino', 'Lopez'];
const days = ['M', 'T', 'W', 'Th', 'F', 'S'];
const times = ['0700-1000', '1000-1300', '1300-1600', '1600-1900'];
const rooms = Array.from({length:13}, (_, i) => `CR${101 + i}`);
const spans = [['B','C'], ['D','G'], ['H','K'], ['L','N'], ['O','Q'], ['R','V'], ['W','Y']];
sheet.getRange('A1:Y366').format.font = { name: 'Arial', size: 10, color: '#202A35' };
sheet.getRange('A1:Y366').format.rowHeight = 24;
sheet.getRange('A1:A366').format.columnWidth = 2;
sheet.getRange('B1:Y366').format.columnWidth = 4;
sheet.getRange('D1:G366').format.columnWidth = 13;
sheet.getRange('R1:V366').format.columnWidth = 4.5;

function merged(a, value) {
  sheet.mergeCells(a);
  sheet.getRange(a.split(':')[0]).values = [[value]];
}
merged('B2:Y2', 'MOCK COURSE OFFERING — 1st SEMESTER 2026-2027');
sheet.getRange('B2:Y2').format.font = { name: 'Arial', size: 14, bold: true, color: '#20364B' };
sheet.getRange('B2:Y2').format.rowHeight = 30;
const headers = ['Stub No.', 'Course No. & Description', 'Time', 'Day', 'Room', 'Teacher', 'Credits'];
headers.forEach((v, i) => merged(`${spans[i][0]}4:${spans[i][1]}4`, v));
sheet.getRange('B4:Y4').format.fill = '#20364B';
sheet.getRange('B4:Y4').format.font = { name: 'Arial', size: 10, bold: true, color: '#FFFFFF' };
sheet.getRange('B4:Y4').format.horizontalAlignment = 'center';
merged('B6:Y6', 'Department of Criminology');
sheet.getRange('B6:Y6').format.font.bold = true;
const expectedRows = [];
let row = 8;
for (let sectionIndex = 0; sectionIndex < 37; sectionIndex++) {
  const year = sectionIndex < 10 ? 0 : 1 + Math.floor((sectionIndex - 10) / 9);
  const sectionNumber = sectionIndex < 10 ? sectionIndex + 1 : (sectionIndex - 10) % 9 + 1;
  const section = `BSCRIM ${year + 1}-${String(sectionNumber).padStart(2, '0')}`;
  merged(`B${row}:C${row}`, 'Section');
  merged(`D${row}:Y${row}`, section);
  sheet.getRange(`B${row}:Y${row}`).format.fill = '#E4EBF1';
  sheet.getRange(`B${row}:Y${row}`).format.font.bold = true;
  const first = ++row;
  subjects[year].slice(0, sectionIndex < 27 ? 7 : 6).forEach((title, subject) => {
    const roomIndex = sectionIndex % rooms.length;
    const group = Math.floor(sectionIndex / rooms.length);
    const slot = group * 7 + subject;
    const teacher = `${teachers[roomIndex]}, ${String.fromCharCode(65 + group)}.`;
    const values = [String(9101 + expectedRows.length), `CRIM ${year + 1}00${subject + 1} - ${title} - LEC`, times[Math.floor(slot / days.length)], days[slot % days.length], rooms[roomIndex], teacher, 3];
    values.forEach((value, i) => merged(`${spans[i][0]}${row}:${spans[i][1]}${row}`, value));
    if (subject % 2 === 1) sheet.getRange(`B${row}:Y${row}`).format.fill = '#F4F7FA';
    sheet.getRange(`H${row}:Q${row}`).format.horizontalAlignment = 'center';
    sheet.getRange(`W${row}:Y${row}`).format.horizontalAlignment = 'center';
    expectedRows.push({ section, values });
    row++;
  });
  merged(`R${row}:V${row}`, 'Total');
  sheet.mergeCells(`W${row}:Y${row}`);
  sheet.getRange(`W${row}`).formulas = [[`=SUM(W${first}:W${row - 1})`]];
  sheet.getRange(`R${row}:Y${row}`).format.font.bold = true;
  sheet.getRange(`W${row}:Y${row}`).format.horizontalAlignment = 'center';
  row += 2;
}
sheet.getRange(`B4:Y${row - 2}`).format.verticalAlignment = 'center';
sheet.freezePanes.freezeRows(4);
wb.recalculate();
console.log((await wb.inspect({kind:'region',sheetId:sheet.name,range:'B8:Y15',maxChars:1600,tableMaxCols:25,tableMaxRows:8})).ndjson);
console.log((await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!',options:{useRegex:true,maxResults:10},maxChars:800})).ndjson);
const preview = await wb.render({sheetName:sheet.name,range:'A1:Y17',scale:1,format:'png'});
await fs.writeFile(`${out}preview.png`, new Uint8Array(await preview.arrayBuffer()));
await (await SpreadsheetFile.exportXlsx(wb)).save(`${out}CRIM_Mock_Schedule_249_Classes.xlsx`);
console.log(JSON.stringify({file:`${out}CRIM_Mock_Schedule_249_Classes.xlsx`,sections:37,meetings:expectedRows.length}));
