import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import XLSX from 'xlsx'

registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'xlsx' && context.parentURL?.endsWith('.ts')) return next('xlsx/xlsx.mjs', context)
    if (specifier.startsWith('.') && context.parentURL?.endsWith('.ts') && !specifier.endsWith('.ts')) {
      return { url: new URL(`${specifier}.ts`, context.parentURL).href, shortCircuit: true }
    }
    return next(specifier, context)
  },
  load(url, context, next) {
    if (url.endsWith('.ts')) return { format: 'module', shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText }
    return next(url, context)
  },
})
const { createRoomScheduleExcel } = await import('../frontend/src/export/roomScheduleExcel.ts')
const { examPeriodPrefix } = await import('../frontend/src/formatters/examPeriod.ts')
const lesson = { id:'lesson', source:'csv', courseCode:'CCS1301', subject:'', stubCode:'5',
  section:'', dayCode:'MW', startMinutes:420, endMinutes:600, room:'MTCL3', instructorLastName:'BAYLON' }
const sampleClasses = [lesson,
  {...lesson, id:'tuesday', courseCode:'CCS2700', dayCode:'T', instructorLastName:'CABANAL'},
  {...lesson, id:'friday', courseCode:'DMIA3221', dayCode:'F', instructorLastName:'CABANAL'},
  {...lesson, id:'middle', courseCode:'CCS2700', dayCode:'M', startMinutes:600, endMinutes:780, instructorLastName:'CARBONILLA'},
  {...lesson, id:'afternoon', courseCode:'CCS3100', dayCode:'M', startMinutes:810, endMinutes:900, instructorLastName:'CANATOY'},
  {...lesson, id:'late', courseCode:'CCS3801', dayCode:'W', startMinutes:1060, endMinutes:1240, instructorLastName:'FAJAR'},
]
const event = {...lesson, id:'booking_test', source:'admin', courseCode:'College & Exam', date:'2026-10-15', startMinutes:460, endMinutes:510}
const output = createRoomScheduleExcel(['MTCL3','Empty room','Bad/name','Bad:name'], sampleClasses, [event], new Date(2026,9,14))
assert.equal(output.weekStart, '2026-10-12')
assert.equal(output.weekEnd, '2026-10-16')
const book = XLSX.read(output.bytes, { type:'array', cellStyles:true })
assert.deepEqual(book.SheetNames, ['MTCL3','Empty room','Bad_name','Bad_name (2)'])
const sheet = book.Sheets.MTCL3
assert.deepEqual(['A2','B2','C2','D2','E2','F2'].map(address => sheet[address].v), ['Time','Monday','Tuesday','Wednesday','Thursday','Friday'])
assert.equal(sheet.B3.v, 'CCS1301\n5\nBAYLON\nMTCL3')
assert.ok(sheet['!merges'].some(merge => merge.s.c === 1 && merge.s.r === 2 && merge.e.r > merge.s.r))
assert.ok(Object.values(sheet).some(value => value?.v === 'College & Exam\n5\nBAYLON\nMTCL3'))
assert.ok(!Object.values(book.Sheets['Empty room']).some(value => value?.v?.includes?.('CCS1301')))
const archive = XLSX.CFB.read(output.bytes, {type:'array'})
const styles = new TextDecoder().decode(XLSX.CFB.find(archive,'styles.xml').content)
assert.ok(styles.includes('FFB4C7E7') && styles.includes('FFE5F1E9') && styles.includes('wrapText="1"'))
const exam = {...event, id:`booking_${examPeriodPrefix('test')}exam`, date:'2026-10-12', courseCode:'EXAM'}
const examBook = XLSX.read(createRoomScheduleExcel(['MTCL3'],[lesson],[exam],new Date(2026,9,12)).bytes,{type:'array'})
assert.ok(!Object.entries(examBook.Sheets.MTCL3).some(([address, value]) => address.startsWith('B') && value?.v === 'CCS1301\n5\nBAYLON\nMTCL3'))
assert.ok(Object.values(examBook.Sheets.MTCL3).some(value => value?.v?.includes?.('EXAM')))
const overlap = {...lesson,id:'other',courseCode:'OVERLAPPING',startMinutes:450,endMinutes:570}
const conflictExport = createRoomScheduleExcel(['MTCL3'],[lesson,overlap],[],new Date(2026,9,12))
const conflictSheet = XLSX.read(conflictExport.bytes,{type:'array',cellStyles:true}).Sheets.MTCL3
assert.ok(conflictSheet.B3.v.includes('CCS1301') && conflictSheet.B3.v.includes('OVERLAPPING'), 'Overlaps retain both schedules')
assert.equal(conflictSheet.B3.s.fgColor.rgb, 'F4CCCC', 'Conflicting blocks are red')
assert.equal(sheet.B3.s.fgColor.rgb, 'B4C7E7', 'Non-conflicting blocks stay blue')
const touching = {...lesson,id:'touching',startMinutes:600,endMinutes:780}
const touchingSheet = XLSX.read(createRoomScheduleExcel(['MTCL3'],[lesson,touching],[],new Date(2026,9,12)).bytes,{type:'array',cellStyles:true}).Sheets.MTCL3
assert.equal(touchingSheet.B3.s.fgColor.rgb, 'B4C7E7', 'Back-to-back schedules are not conflicts')
const excluded = XLSX.read(createRoomScheduleExcel(['MTCL3'],[{...lesson,dayCode:'S'},{...lesson,id:'invalid',endMinutes:400}], [{...event,date:'2026-10-19'}], new Date(2026,9,12)).bytes,{type:'array'}).Sheets.MTCL3
assert.ok(!Object.values(excluded).some(value => value?.v?.includes?.('CCS1301') || value?.v?.includes?.('College & Exam')))
assert.throws(() => createRoomScheduleExcel([],[],[],new Date()), /rooms/)
if (process.argv[2]) writeFileSync(process.argv[2], process.argv.includes('--conflicts') ? conflictExport.bytes : output.bytes)
console.log('Room export checks passed: valid XLSX, room sheets, merges, colors, exact times, exam dates, overlaps, week boundaries, empty rooms and safe sheet names.')
