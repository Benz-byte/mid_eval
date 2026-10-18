import './register-typescript.mjs'
import assert from 'node:assert/strict'
const storage = new Map()
globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) }
globalThis.window = { electron: { flaskUrl: 'http://roster-test' } }
let online = false
let remote = null
globalThis.fetch = async (_url, init) => {
  if (!online) throw Error('Offline')
  remote = JSON.parse(init.body)
  return { ok: true, status: 200, json:async()=>({rosterStorageVersion:1,resultStorageVersion:1}) }
}
const { loadLocalAssistantData: load, saveLocalAssistantData: save, activateLocalAssistantSchedule: activate, mergeSharedAssistantData, ASSISTANT_STORAGE_KEY } = await import('../frontend/src/storage/studentAssistantStorage.ts')
const { flushPendingAssistantSync } = await import('../frontend/src/storage/localFirstSync.ts')
const { createScheduleArchive } = await import('../frontend/src/storage/archiveTypes.ts')
const student = { id:'s1', studentId:'26-01', label:'First semester student', fileName:'student.xlsx', events:[{id:'personal-A'}] }
const result = { status:'FEASIBLE', diagnostics:[], assignments:[{assistantId:'s1'}] }
storage.set(ASSISTANT_STORAGE_KEY, JSON.stringify({ assistants:[student], result, activeScheduleKey:'A', resultsBySchedule:{A:result} }))
assert.deepEqual(load().assistants, [], 'Legacy shared assistants must not automatically become a CSV roster')
assert.deepEqual(load().unlinkedAssistants, [student])
activate('B', false)
assert.deepEqual(load().assistants, [])
assert.equal(load().result, null)
assert.equal(load().resultsBySchedule.A.status, 'FEASIBLE', 'Preserve legacy assignments while awaiting explicit roster linking')
activate('A', false)
save({...load(), assistants:load().unlinkedAssistants, unlinkedAssistants:[], result:load().resultsBySchedule.A}, false)
assert.deepEqual(load().assistants, [student])
activate('B', false)
assert.deepEqual(load().assistants, [])
save({...load(), assistants:[{...student,label:'Second semester name',events:[{id:'personal-B'}]}],result:{...result,diagnostics:['B only']}},false)
activate('A',false)
assert.equal(load().assistants[0].label, 'First semester student')
assert.equal(load().assistants[0].events[0].id, 'personal-A', 'Personal classes must stay with the correct CSV')
assert.deepEqual(load().result.diagnostics, [])
activate('B',false)
save({...load(),assistants:[],result:null},false)
activate('A',false)
assert.equal(load().assistants.length, 1, 'Removing an assistant in B must not remove A’s roster')
assert.equal(load().result.status,'FEASIBLE')
activate('',false)
assert.deepEqual(load().assistants, [])
assert.equal(load().result,null)
assert.throws(()=>save({...load(),assistants:[student]},false),/Upload/)
activate('A',false)
const archive = createScheduleArchive({name:'A archive',schoolYear:'2026',semester:'First'},
  {name:'A.csv',fingerprint:'A',events:[],rooms:[],times:[],tbaSubjects:[]},[],load(),
  {scheduleDate:'2026-10-16',assistantWeekStart:'2026-10-12',selectedAssistantId:'s1',tab:'schedule'})
assert.deepEqual(Object.keys(archive.assistantData.rostersBySchedule),['A'])
assert.deepEqual(archive.assistantData.unlinkedAssistants,[])
const warning = console.warn
console.warn = () => {}
save(load())
await flushPendingAssistantSync().catch(()=>{})
online = true
await flushPendingAssistantSync()
console.warn = warning
assert.equal(remote.rostersBySchedule.A[0].id,'s1')
assert.deepEqual(remote.rostersBySchedule.B,[],'Sync must keep intentionally empty rosters')
storage.clear()
save(mergeSharedAssistantData(remote,'B'),false,false)
assert.deepEqual(load().assistants,[])
activate('A',false)
assert.equal(load().assistants[0].label,'First semester student','Restore roster from another device')
assert.equal(archive.assistantData.assistants[0].label,'First semester student')
// A legacy API may return an empty preservation pool alongside an old shared
// assistant row. That must not discard the assistant or attach it to every CSV.
storage.clear()
const oldCloud = { assistants:[student], activeScheduleKey:'A', solverResult:result,
  solverResultsBySchedule:{A:result}, rostersBySchedule:null, unlinkedAssistants:[] }
save(mergeSharedAssistantData(oldCloud,'A'),false,false)
assert.deepEqual(load().assistants,[])
assert.equal(load().unlinkedAssistants[0].id,'s1','Recover cloud legacy assistant even when unlinkedAssistants is an explicit empty array')
activate('B',false)
assert.ok(!Object.hasOwn(load().rostersBySchedule,'B'),'Merely opening a CSV must not create a cloud-overwriting empty roster')
activate('A',false)
save({...load(),assistants:load().unlinkedAssistants,unlinkedAssistants:[],result},false)
const linked = load()
assert.equal(linked.assistants.length,1)
save(mergeSharedAssistantData(oldCloud,'A'),false,false)
assert.equal(load().assistants.length,1,'Legacy cloud refresh must not hide a linked or newly added assistant')
assert.equal(load().unlinkedAssistants.length,0,'Already linked assistants must not reappear as legacy duplicates')
const staleCloud = { ...oldCloud, rostersBySchedule:{A:[]}, rosterRevisions:{A:'2000-01-01T00:00:00.000Z:old'} }
save(mergeSharedAssistantData(staleCloud,'A'),false,false)
assert.equal(load().assistants.length,1,'Stale cloud roster must not overwrite a newer local addition')
activate('B',false)
assert.equal(load().assistants.length,0)
activate('A',false)
assert.equal(load().assistants.length,1)
const originalFetch = globalThis.fetch
globalThis.fetch = async()=>({ok:true,status:204})
console.warn = () => {}
save(load())
await assert.rejects(flushPendingAssistantSync(),/Restart the backend/)
assert.ok(storage.has('auto-scheduler-pending-assistant-sync'),'Old backend acknowledgement must not discard the pending roster save')
globalThis.fetch = originalFetch
await flushPendingAssistantSync()
console.warn = warning
assert.ok(!storage.has('auto-scheduler-pending-assistant-sync'))
console.log('Assistant roster checks passed: CSV isolation, legacy preservation/linking, personal profiles, deletion, offline retry, cloud reload, and archive scope.')
