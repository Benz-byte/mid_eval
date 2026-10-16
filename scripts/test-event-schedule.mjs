import './register-typescript.mjs'
import assert from 'node:assert/strict'
const { eventsForSchedule } = await import('../frontend/src/formatters/eventSchedule.ts')
const { createExamPeriodEvents } = await import('../frontend/src/formatters/examPeriod.ts')
const { loadAdminEvents, saveAdminEventsLocally } = await import('../frontend/src/storage/adminEventStorage.ts')
const { flushPendingAdminSync, mergePendingAdminEvents, queueAdminUpsert } = await import('../frontend/src/storage/localFirstSync.ts')

const storage = new Map()
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: key => storage.delete(key),
}
globalThis.window = { electron: { flaskUrl: 'http://test' } }
const base = { source: 'admin', courseCode: 'Event', room: 'MT102', date: '2026-10-16',
  startMinutes: 420, endMinutes: 480, classType: 'BOOKING', section: '', subject: '', studentCount: '' }
const a = { ...base, id: 'a', scheduleKey: 'hash-A', assistantId: 'student-1' }
const b = { ...base, id: 'b', scheduleKey: 'hash-B', assistantId: 'student-1' }
const legacy = { ...base, id: 'old-unscoped' }
const exam = createExamPeriodEvents('hash-A', 'Exam', ['2026-10-16'])[0]
const oldExam = { ...exam }
delete oldExam.scheduleKey
const all = [a, b, legacy, oldExam]
saveAdminEventsLocally(all)
assert.deepEqual(eventsForSchedule(loadAdminEvents(), 'hash-A', ['mt102']).map(e => e.id), [a.id, exam.id])
assert.deepEqual(eventsForSchedule(all, 'hash-B', ['MT102']), [b])
assert.deepEqual(eventsForSchedule(all, '', ['MT102']), [])
assert.equal(loadAdminEvents().length, 4, 'switching/removing a CSV must not delete saved events')
assert.equal(eventsForSchedule(all, 'hash-A', ['MT102']).filter(e => e.assistantId).length, 1,
  'assistant event counts must only include the active CSV')
assert.equal(eventsForSchedule([{ ...a, scheduleKey: 'hash-B', id: exam.id }], 'hash-A', ['MT102']).length, 0,
  'explicit scope takes precedence over legacy exam ID')

let online = false
const remote = new Map()
globalThis.fetch = async (_url, init) => {
  if (!online) throw new Error('Offline')
  const event = JSON.parse(init.body)
  remote.set(event.id, event)
  return { ok: true, status: 204 }
}
const warn = console.warn
console.warn = () => {}
queueAdminUpsert(a)
queueAdminUpsert(b)
await flushPendingAdminSync().catch(() => {})
assert.equal(mergePendingAdminEvents([]).length, 2, 'offline queue retains both CSVs')
online = true
await flushPendingAdminSync()
console.warn = warn
assert.equal(remote.get('a').scheduleKey, 'hash-A')
assert.equal(remote.get('b').scheduleKey, 'hash-B')
assert.equal(remote.get('a').assistantId, 'student-1')
assert.equal(eventsForSchedule(mergePendingAdminEvents([...remote.values()]), 'hash-B', ['MT102']).length, 1)
assert.equal(loadAdminEvents().find(e => e.id === legacy.id).scheduleKey, undefined)
console.log('CSV event isolation, counts, legacy preservation, and offline/cloud round-trip tests passed.')
