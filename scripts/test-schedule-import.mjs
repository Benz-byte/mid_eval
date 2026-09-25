import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'
import * as XLSX from 'xlsx/xlsx.mjs'

// Exercise the actual browser file reader and Flask route without a running
// server or touching the user's saved schedule/database.
async function moduleUrl(path, replacements = []) {
  let code = ts.transpileModule(await readFile(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  for (const [from, to] of replacements) code = code.replace(from, to)
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}
const clientUrl = await moduleUrl('frontend/src/api/apiClient.ts')
const parserUrl = await moduleUrl('frontend/src/api/scheduleParser.ts', [
  ["'./apiClient'", JSON.stringify(clientUrl)],
  ["'xlsx'", JSON.stringify(import.meta.resolve('xlsx/xlsx.mjs'))],
])
globalThis.window = { electron: { flaskUrl: 'http://import-test' } }
globalThis.fetch = async (_url, options) => {
  const result = spawnSync('python', ['-X', 'utf8', '-c', `
import json, sys
sys.path.insert(0, 'backend')
from flask import Flask
from routes.schedules import blueprint
app = Flask(__name__)
app.register_blueprint(blueprint)
response = app.test_client().post('/api/schedules/parse', json=json.load(sys.stdin))
print(json.dumps({'status': response.status_code, 'body': response.get_json()}))
`], { input: options.body, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const response = JSON.parse(result.stdout)
  return new Response(JSON.stringify(response.body), { status: response.status })
}
const { readScheduleFile } = await import(parserUrl)
const header = ['Stub No.', 'Course No. & Description', 'Time', 'Day', 'Room', 'Teacher', 'Credits']
const sheet = XLSX.utils.aoa_to_sheet([
  ['2nd SEMESTER 2026-2027'], header, ['Section', 'BSIT 1-01'],
  [55, 'CCS 2601 - LEC', '1300-1600', 'T', 'MTCL5', 'Eregia, R', 3],
  [38, 'IT 3110 - LEC', '1800-0200', 'T', 'MTCL9', 'Taasan, A', 3],
  ['Section', 'BLIS 2-01'],
  [55, 'CCS 2601 - LEC', '1300-1600', 'T', 'MTCL5', 'Eregia, R', 3],
])
sheet.A4.z = '$0'
sheet.A7.z = '$0'
const workbook = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(workbook, sheet, 'Report')
for (const bookType of ['xls', 'xlsx']) {
  const file = new File([XLSX.write(workbook, { type: 'buffer', bookType })], `report.${bookType}`)
  const result = await readScheduleFile(file, 'auto')
  assert.equal(result.events.length, 1)
  assert.equal(result.events[0].stubCode, '55')
  assert.deepEqual(result.events[0].sections, ['BSIT 1-01', 'BLIS 2-01'])
  assert.equal(result.tbaSubjects.length, 1)
  assert.match(result.tbaSubjects[0], /1800-0200/)
}
const csv = 'StubCode,Subject,SubjectTitle,StartTime,EndTime,Day,RoomType,Room,StudentAmount,LastName,FirstName,MiddleName\n1,CS 1001,Introduction,0700,0900,M,LEC,MT102,30,Cruz,Ana,\n'
const csvFile = new File([csv], 'original.csv')
assert.deepEqual(await readScheduleFile(csvFile, 'auto'), await readScheduleFile(csvFile, 'official'))
await assert.rejects(readScheduleFile(new File(['Unknown,Columns\n1,2'], 'bad.csv'), 'auto'), /Unknown schedule format/)

// Personal schedules with Excel numeric clock cells must remain readable.
const personal = XLSX.utils.aoa_to_sheet([
  ['SubjectCode', 'Title', 'Start', 'End', 'Days'],
  ['CS 1001', 'Introduction', 7 / 24, 9 / 24, 'M'],
])
personal.C2.z = personal.D2.z = 'h:mm AM/PM'
const personalBook = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(personalBook, personal, 'Classes')
const personalResult = await readScheduleFile(new File([XLSX.write(personalBook, { type: 'buffer', bookType: 'xlsx' })], 'student.xlsx'), 'assistant')
assert.equal(personalResult.events[0].startMinutes, 420)
assert.equal(personalResult.events[0].endMinutes, 540)
console.log('Import integration passed: XLS/XLSX, currency-formatted stubs, shared meetings, invalid-time TBA, original CSV, personal Excel times, unknown format.')

for (const path of process.argv.slice(2)) {
  const result = await readScheduleFile(new File([await readFile(path)], basename(path)), 'auto')
  assert.ok(result.events.every(event => event.startMinutes >= 0 && event.endMinutes > event.startMinutes && event.endMinutes <= 1440))
  assert.ok(result.events.every(event => !event.stubCode?.includes('$')))
  assert.equal(new Set(result.events.map(event => event.id)).size, result.events.length)
  console.log(JSON.stringify({ file: basename(path), events: result.events.length, rooms: result.rooms.length,
    tba: result.tbaSubjects.length, metadata: result.metadata,
    sharedMeetings: result.events.filter(event => event.sections?.length > 1).length,
    invalidTimeExample: result.tbaSubjects.find(label => label.includes('1800-0200')) }))
}
