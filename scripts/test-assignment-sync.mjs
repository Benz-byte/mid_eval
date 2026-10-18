import './register-typescript.mjs'
import assert from 'node:assert/strict'
const disk = new Map()
globalThis.localStorage = { getItem: key => disk.get(key) ?? null, setItem: (key, value) => disk.set(key, value), removeItem: key => disk.delete(key) }
globalThis.window = { electron: { flaskUrl: 'http://assignment-sync-test' } }
let online = false, uploaded
globalThis.fetch = async (_url, init) => {
  if (!online) throw Error('Offline')
  uploaded = JSON.parse(init.body)
  return { ok: true, json: async () => ({ rosterStorageVersion: 1, resultStorageVersion: 1 }) }
}
const { loadLocalAssistantData: load, saveLocalAssistantData: save, activateLocalAssistantSchedule: activate,
  mergeSharedAssistantData: merge, ASSISTANT_STORAGE_KEY } = await import('../frontend/src/storage/studentAssistantStorage.ts')
const { flushPendingAssistantSync: flush } = await import('../frontend/src/storage/localFirstSync.ts')
const student = { id: 'student', label: 'Maria', fileName: 'student.csv', events: [] }
const result = name => ({ status: 'FEASIBLE', diagnostics: [], assignments: [{ assistantId: student.id, classId: name }] })
const aOld = result('A-old'), aNew = result('A-new'), bOld = result('B-old')
const remote = { assistants: [student], activeScheduleKey: 'A', solverResult: aNew,
  rostersBySchedule: { A: [student], B: [student] }, rosterRevisions: { A: 'same', B: 'same' },
  solverResultsBySchedule: { A: aNew, B: bOld }, resultRevisions: { A: '002', B: '001' } }
disk.set(ASSISTANT_STORAGE_KEY, JSON.stringify({ assistants: [student], result: bOld, activeScheduleKey: 'B',
  rostersBySchedule: remote.rostersBySchedule, rosterRevisions: remote.rosterRevisions,
  resultsBySchedule: { A: aOld, B: bOld }, resultRevisions: { A: '001', B: '001' } }))
save(merge(remote, 'B'), false, false)
assert.deepEqual(load().resultsBySchedule.A, aNew, 'Same-roster newer cloud duties replace the old local cache')
assert.deepEqual(load().resultRevisions, remote.resultRevisions, 'Hydration must not mint local edits')
activate('A', false)
activate('B', false)
assert.deepEqual(load().resultRevisions, remote.resultRevisions, 'Switching CSVs is not an edit')
save({ ...load(), result: result('B-manual') }, false)
const changedB = load()
assert.equal(changedB.resultRevisions.A, '002')
assert.ok(changedB.resultRevisions.B > '001', 'Manual assignment edits receive their own CSV revision')
save(load(), false)
assert.deepEqual(load().resultRevisions, changedB.resultRevisions, 'Saving unchanged results does not advance revisions')
save(merge(remote, 'B'), false, false)
assert.deepEqual(load().result, result('B-manual'), 'Stale cloud results cannot undo local manual edits')
save({ ...load(), result: null }, false)
const clearedRevision = load().resultRevisions.B
assert.ok(clearedRevision > changedB.resultRevisions.B)
save(merge(remote, 'B'), false, false)
assert.equal(load().result, null, 'Stale cloud data cannot restore a cleared result')
activate('A', false)
save(merge({ ...remote, activeScheduleKey: 'B', solverResult: null, solverResultsBySchedule: { A: aNew },
  resultRevisions: { A: '002', B: `${clearedRevision}newer` } }, 'A'), false, false)
assert.ok(!load().resultsBySchedule.B, 'A cloud clear is applied even while another CSV is active')
assert.equal(load().resultRevisions.B, `${clearedRevision}newer`)
// One queue snapshot must retain edits made to more than one CSV while offline.
const warn = console.warn
console.warn = () => {}
try {
  save({ ...load(), result: result('A-offline') })
  await flush().catch(() => {})
  activate('B', false)
  save({ ...load(), result: result('B-offline') })
  await flush().catch(() => {})
  online = true
  await flush()
  assert.deepEqual(uploaded.solverResultsBySchedule.A, result('A-offline'))
  assert.deepEqual(uploaded.solverResultsBySchedule.B, result('B-offline'))
  assert.equal(uploaded.resultRevisions.A, load().resultRevisions.A)
  assert.equal(uploaded.resultRevisions.B, load().resultRevisions.B)
  assert.ok(!disk.has('auto-scheduler-pending-assistant-sync'))
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ rosterStorageVersion: 1 }) })
  save(load())
  await assert.rejects(flush(), /Restart the backend/)
  assert.ok(disk.has('auto-scheduler-pending-assistant-sync'), 'An older backend must not acknowledge away a versioned edit')
} finally { console.warn = warn }
console.log('Assignment sync checks passed: per-CSV revisions, manual edits, stale merges, clears, CSV switches, multi-CSV offline retry, and backend compatibility.')
