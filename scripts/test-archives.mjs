import './register-typescript.mjs'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

// A transactional IndexedDB test double: no user's browser data is accessed.
let disk = new Map()
const db = {
  createObjectStore() {},
  transaction(_name, mode) {
    const tx = {}
    const rows = new Map(structuredClone([...disk]))
    let pending = 0
    let aborted = false
    const finish = () => setImmediate(() => {
      if (pending || aborted) return
      if (mode === 'readwrite') disk = rows
      tx.oncomplete?.()
    })
    const request = operation => {
      const req = {}
      pending++
      queueMicrotask(() => {
        if (aborted) return
        try { req.result = structuredClone(operation()); req.onsuccess?.() }
        catch { aborted = true; tx.onerror?.(); return }
        pending--
        if (!pending) finish()
      })
      return req
    }
    tx.objectStore = () => ({
      get: id => request(() => rows.get(id)),
      getAll: () => request(() => [...rows.values()]),
      add: row => request(() => { if (rows.has(row.id)) throw Error('Duplicate ID'); rows.set(row.id, structuredClone(row)); return row.id }),
      put: row => request(() => { rows.set(row.id, structuredClone(row)); return row.id }),
    })
    tx.abort = () => { aborted = true; tx.onabort?.() }
    finish()
    return tx
  },
}
globalThis.indexedDB = { open() {
  const request = {result:db}
  queueMicrotask(() => { request.onupgradeneeded?.(); request.onsuccess?.() })
  return request
} }
const currentStorage = new Map([['auto-scheduler-selected-date','2026-10-16'],['auto-scheduler-imported-schedule','ACTIVE CSV MUST NOT CHANGE']])
globalThis.localStorage = {getItem:key=>currentStorage.get(key)??null,setItem:(key,value)=>currentStorage.set(key,value),removeItem:key=>currentStorage.delete(key)}
globalThis.window = {electron:{flaskUrl:'http://archive-test'},innerHeight:900}
let offline = true
const remote = new Map()
globalThis.fetch = async (url, init) => {
  if (offline) throw new TypeError('Offline')
  const id = url.split('/').at(-1)
  if (init?.method === 'PUT' && !remote.has(id)) remote.set(id,{id,archive:JSON.parse(init.body),deletedAt:null})
  if (init?.method === 'DELETE' && remote.has(id)) remote.get(id).deletedAt = new Date().toISOString()
  return {ok:true,status:init?.method ? 204 : 200,json:async()=>structuredClone([...remote.values()])}
}
const {createScheduleArchive} = await import('../frontend/src/storage/archiveTypes.ts')
const {saveArchiveLocally,listLocalArchives,deleteArchiveLocally,syncArchives,mergeArchiveRecord} = await import('../frontend/src/storage/archiveStorage.ts')
const {saveArchiveWithAction} = await import('../frontend/src/storage/archiveWorkflow.ts')
const {DEFAULT_SCHEDULING_SETTINGS} = await import('../frontend/src/api/studentAssistantApi.ts')
const {ArchivePreview} = await import('../frontend/src/ui/archives/ArchivePreview.tsx')
const {ScheduleCalendar} = await import('../frontend/src/ui/schedule/ScheduleCalendar.tsx')
const {ArchiveManager} = await import('../frontend/src/ui/archives/ArchiveManager.tsx')
const lesson = {id:'class',source:'csv',courseCode:'ARCHIVED_CLASS',subject:'',dayCode:'F',room:'MT102',section:'',classType:'LEC',studentCount:'',startMinutes:420,endMinutes:480}
const event = {...lesson,id:'booking_event',source:'admin',courseCode:'ARCHIVED_EVENT',date:'2026-10-16',description:'Archived instructions',startMinutes:600,endMinutes:660,assistantId:'sa',assistantLabel:'Student'}
const result = {status:'FEASIBLE',diagnostics:[],assignments:[{assistantId:'sa',assistantLabel:'Student',classId:'class',day:'F',room:'MT102',courseCode:'ARCHIVED_CLASS',startMinutes:420,endMinutes:480}],relieverAssignments:[{date:'2026-10-16',classId:'class',day:'F',courseCode:'ARCHIVED_CLASS',room:'MT102',originalAssistantId:'sa',originalAssistantLabel:'Student',replacementAssistantId:'other',replacementAssistantLabel:'Replacement',startMinutes:420,endMinutes:480}]}
const schedule = {events:[lesson],name:'First.csv',fingerprint:'first',rooms:['MT102','Empty'],times:[420,480,600,660],tbaSubjects:['TBA'],metadata:{schoolYear:'2026–2027',semester:'First'}}
const data = {assistants:[{id:'sa',label:'Student',fileName:'personal.xlsx',events:[{...lesson,courseCode:'PERSONAL_CLASS'}]}],result,settings:DEFAULT_SCHEDULING_SETTINGS,activeScheduleKey:'first',resultsBySchedule:{first:result,unrelated:{...result,status:'OPTIMAL'}}}
const view = {scheduleDate:'2026-10-16',assistantWeekStart:'2026-10-12',selectedAssistantId:'sa',tab:'schedule'}
const details = {name:'Final',schoolYear:'2026–2027',semester:'First'}
const snapshot = createScheduleArchive(details,schedule,[event],data,view)
const second = createScheduleArchive(details,schedule,[event],data,view)
assert.notEqual(snapshot.id,second.id,'Repeated names create independent archives')
second.name = 'Another archive'
assert.deepEqual(Object.keys(snapshot.assistantData.resultsBySchedule),['first'])
const differentSchedule = createScheduleArchive(details,{...schedule,fingerprint:'different'},[],data,view)
assert.equal(differentSchedule.assistantData.result,null,'Never archive a different CSV’s generated assignments')
assert.throws(()=>createScheduleArchive(details,{...schedule,name:''},[],data,view),/Upload/)
assert.deepEqual(snapshot.assistantData.result.relieverAssignments,result.relieverAssignments)
assert.equal(snapshot.adminEvents[0].description,'Archived instructions')
schedule.events[0].courseCode = 'ACTIVE_CHANGED'
data.assistants[0].label = 'Renamed later'
assert.equal(snapshot.schedule.events[0].courseCode,'ARCHIVED_CLASS')
assert.equal(snapshot.assistantData.assistants[0].label,'Student')
await saveArchiveLocally(snapshot)
await saveArchiveLocally(second)
await assert.rejects(saveArchiveLocally({...snapshot,id:crypto.randomUUID(),name:'  FINAL  '}),/already exists/)
await saveArchiveLocally({...snapshot,id:crypto.randomUUID(),name:'Two Words'})
await assert.rejects(saveArchiveLocally({...snapshot,id:crypto.randomUUID(),name:' two   WORDS '}),/already exists/)
// Keep the original sync fixture size unchanged after checking whitespace.
const words = (await listLocalArchives()).find(row=>row.archive.name==='Two Words')
disk.delete(words.id)
await assert.rejects(saveArchiveLocally(snapshot),'Existing ID must not be overwritten')
await assert.rejects(syncArchives(),/Offline/)
assert.equal((await listLocalArchives()).filter(row=>!row.deletedAt).length,2)
assert.ok((await listLocalArchives()).every(row=>row.pending),'Offline saves remain queued')
offline = false
await syncArchives()
assert.equal(remote.size,2)
assert.ok((await listLocalArchives()).every(row=>!row.pending))
offline = true
await deleteArchiveLocally(snapshot.id)
await assert.rejects(syncArchives(),/Offline/)
assert.equal((await listLocalArchives()).filter(row=>!row.deletedAt).length,1)
offline = false
await syncArchives()
assert.ok(remote.get(snapshot.id).deletedAt,'Offline deletion syncs as a tombstone')
const deleted = (await listLocalArchives()).find(row=>row.id===snapshot.id)
assert.ok(mergeArchiveRecord(deleted,{id:snapshot.id,archive:snapshot,deletedAt:null}).deletedAt,'Stale lists cannot revive deleted archives')
const third = createScheduleArchive(details,schedule,[],data,view)
remote.set(third.id,{id:third.id,archive:third,deletedAt:null})
await syncArchives()
assert.ok((await listLocalArchives()).some(row=>row.id===third.id),'Archives from other devices are cached locally')
const storageBefore = JSON.stringify([...currentStorage])
const noop = () => {}
const preview = renderToStaticMarkup(React.createElement(ArchivePreview,{archive:snapshot,onExit:noop}))
assert.ok(preview.includes('Exit Archive') && preview.includes('Read-only') && preview.includes('ARCHIVED_CLASS'))
assert.ok(preview.includes('Weekly Summary') && preview.includes('Student'))
assert.ok(!preview.includes('Create schedule') && !preview.includes('Remove CSV') && !preview.includes('Add Event') && !preview.includes('Edit Student'))
const readonly = renderToStaticMarkup(React.createElement(ScheduleCalendar,{
  csvEvents:snapshot.schedule.events,adminEvents:snapshot.adminEvents,csvName:snapshot.schedule.name,rooms:snapshot.schedule.rooms,times:snapshot.schedule.times,tbaSubjects:[],readOnly:true,archivedAssistantData:snapshot.assistantData,initialDate:'2026-10-16',onCsvUpload:async()=>{},onCsvRemove:noop,onOpenEvents:noop,onEditEvent:noop,onDeleteEvent:noop,onAssignAssistant:noop,
}))
assert.ok(readonly.includes('ARCHIVED_EVENT') && readonly.includes('Export Excel'))
assert.ok(!readonly.includes('click to edit') && !readonly.includes('Upload Schedule'))
const manager = renderToStaticMarkup(React.createElement(ArchiveManager,{canSave:false,defaultName:'',getSummary:()=>({rooms:0,assistants:0,events:0,duties:0}),capture:()=>snapshot,onView:noop,onClose:noop,onSaveAndClose:noop}))
assert.ok(/disabled="">Save Current Schedule/.test(manager),'No CSV disables only saving, not viewing')
assert.equal(JSON.stringify([...currentStorage]),storageBefore,'Archiving and preview do not change active schedule storage')
let closeCount = 0
const closeSnapshot = createScheduleArchive({...details,name:'Close test'},schedule,[event],data,view)
const closing = saveArchiveWithAction(closeSnapshot, () => {
  assert.ok(disk.has(closeSnapshot.id), 'Snapshot must commit before closing the current schedule')
  closeCount++
})
assert.equal(closeCount,0,'Do not close while persistence is still pending')
await closing
assert.equal(closeCount,1)
await assert.rejects(saveArchiveWithAction(closeSnapshot,()=>{closeCount++}))
assert.equal(closeCount,1,'A failed save must keep the current schedule open')
await saveArchiveWithAction(createScheduleArchive({...details,name:'Keep test'},schedule,[],data,view))
assert.equal(closeCount,1,'Save Archive without a close action keeps current work open')
assert.equal(JSON.stringify([...currentStorage]),storageBefore,'Saving and closing only invokes the supplied clear action')
console.log('Archive checks passed: snapshots, duplicate names, immutable IDs, offline save/delete, retry, remote merge, tombstones, read-only rendering and active-state isolation.')
