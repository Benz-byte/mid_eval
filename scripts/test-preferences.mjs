import './register-typescript.mjs'
import assert from 'node:assert/strict'
const values=new Map([['unrelated','keep']])
globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)}
const {loadActiveTab,saveActiveTab,loadScheduleDate,saveScheduleDate,ACTIVE_TAB_STORAGE_KEY,SCHEDULE_DATE_STORAGE_KEY}=await import('../frontend/src/storage/preferenceStorage.ts')
const {saveAdminEventsLocally,loadAdminEvents,ADMIN_STORAGE_KEY}=await import('../frontend/src/storage/adminEventStorage.ts')
const {saveCsvScheduleLocally,loadCsvSchedule,CSV_STORAGE_KEY}=await import('../frontend/src/storage/scheduleStorage.ts')
assert.equal(loadActiveTab(),'schedule')
saveActiveTab('student-assistant')
assert.equal(values.get(ACTIVE_TAB_STORAGE_KEY),'student-assistant')
assert.equal(loadActiveTab(),'student-assistant')
saveScheduleDate('2026-10-17')
assert.equal(values.get(SCHEDULE_DATE_STORAGE_KEY),'2026-10-17')
assert.equal(loadScheduleDate().getDate(),17)
assert.equal(loadScheduleDate().getMonth(),9)
const events=[{id:'event',source:'admin',room:'MT102',scheduleKey:'A'}]
saveAdminEventsLocally(events)
assert.equal(values.get(ADMIN_STORAGE_KEY),JSON.stringify(events))
assert.deepEqual(loadAdminEvents(),events)
const schedule={events:[],name:'A.csv',rooms:['MT102'],times:[420],fingerprint:'A',tbaSubjects:[],metadata:{schoolYear:'2026–2027'}}
saveCsvScheduleLocally(schedule)
assert.equal(values.get(CSV_STORAGE_KEY),JSON.stringify(schedule))
assert.deepEqual(loadCsvSchedule(),schedule)
assert.equal(values.get('unrelated'),'keep')
console.log('Preference/storage checks passed: unchanged keys, values, selected tab/date, events, and CSV persistence.')
