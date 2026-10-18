import './register-typescript.mjs'
import assert from 'node:assert/strict'
const disk = new Map()
globalThis.localStorage = { getItem: key => disk.get(key) ?? null, setItem: (key, value) => disk.set(key, value), removeItem: key => disk.delete(key) }
globalThis.window = { electron: { flaskUrl: 'http://deletion-test' } }
const { queueAdminUpsert: put, queueAdminDelete: remove, flushPendingAdminSync: flush,
  mergePendingAdminEvents: merge } = await import('../frontend/src/storage/localFirstSync.ts')
const { loadAdminEvents: load, saveAdminEventsLocally: save, loadDeletedEventIds: deleted } = await import('../frontend/src/storage/adminEventStorage.ts')
const { loadSharedAdminEvents: snapshot } = await import('../frontend/src/api/adminEventApi.ts')
const base = { id: 'deleted-A', source: 'admin', scheduleKey: 'csv-A', courseCode: 'Event', date: '2026-10-16',
  startMinutes: 420, endMinutes: 480, room: 'MT102', subject: '', classType: 'BOOKING', section: '', studentCount: '' }
const other = { ...base, id: 'other-B', scheduleKey: 'csv-B' }
const cloud = new Map([[base.id, base], [other.id, other]])
const tombstones = new Set()
let online = false, legacyDelete = false, failWrites = false, holdPut, putStarted
globalThis.fetch = async (url, init = {}) => {
  if (!online || failWrites) throw Error('Offline')
  if (String(url).endsWith('?include_deleted=true')) return { ok: true, status: 200,
    json: async () => ({ events: [...cloud.values()], deletedIds: [...tombstones], eventStorageVersion: 1 }) }
  const id = decodeURIComponent(String(url).split('/').pop())
  if (init.method === 'DELETE') {
    if (legacyDelete) return { ok: true, status: 204 }
    tombstones.add(id); cloud.delete(id)
    return { ok: true, status: 200, json: async () => ({ eventStorageVersion: 1 }) }
  }
  if (holdPut) { putStarted(); await holdPut }
  if (tombstones.has(id)) return { ok: false, status: 410, json: async () => ({ error: 'Deleted' }) }
  cloud.set(id, JSON.parse(init.body))
  return { ok: true, status: 204 }
}
const warn = console.warn
console.warn = () => {}
try {
  // Device B has a queued offline edit. Device A deletes that ID in the cloud.
  save([base, other]); put({ ...base, courseCode: 'Stale edit' })
  await flush().catch(() => {})
  tombstones.add(base.id); cloud.delete(base.id)
  online = true
  await flush()
  assert.ok(deleted().has(base.id))
  assert.deepEqual(load(), [other], 'A rejected stale PUT immediately removes its local cached card')
  assert.ok(!disk.has('auto-scheduler-pending-admin-sync'), 'Permanent deletion is not retried forever')
  put(base); await flush()
  assert.ok(!cloud.has(base.id), 'A deleted ID must never be reused')
  save([base, other])
  assert.deepEqual(load(), [other], 'Later local saves cannot restore a known deleted event')
  assert.deepEqual(merge([base, other]), [other], 'Stale cloud snapshots cannot restore it either')
  // Merely cached cards (with no queued PUT) must also learn remote deletions.
  const cached = { ...base, id: 'cached-A' }
  save([cached, other]); tombstones.add(cached.id)
  const remote = await snapshot()
  assert.deepEqual(merge(remote.events, remote.deletedIds), [other])
  assert.ok(deleted().has(cached.id))
  assert.deepEqual(load(), [other])
  // Offline deletes must survive restarts/retries, even before first upload.
  const neverUploaded = { ...base, id: 'new-offline-A' }
  online = false
  put(neverUploaded); await flush().catch(() => {})
  remove(neverUploaded.id); await flush().catch(() => {})
  assert.ok(JSON.parse(disk.get('auto-scheduler-pending-admin-sync')).deletes.includes(neverUploaded.id))
  online = true; legacyDelete = true
  await assert.rejects(flush(), /Restart the backend/)
  assert.ok(disk.has('auto-scheduler-pending-admin-sync'), 'An older backend cannot acknowledge deletion protection')
  legacyDelete = false; await flush()
  assert.ok(tombstones.has(neverUploaded.id))
  assert.ok(!cloud.has(neverUploaded.id))
  assert.ok(!disk.has('auto-scheduler-pending-admin-sync'))
  // A delete arriving while a PUT is in flight must remain queued afterward.
  const racing = { ...base, id: 'inflight-A' }
  let release
  holdPut = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { putStarted = resolve })
  put(racing); await started
  remove(racing.id); release(); await flush()
  holdPut = null
  assert.ok(JSON.parse(disk.get('auto-scheduler-pending-admin-sync')).deletes.includes(racing.id))
  await flush()
  assert.ok(tombstones.has(racing.id) && !cloud.has(racing.id))
  // Temporary failures keep real pending updates; they are not treated as deletes.
  const pending = { ...other, courseCode: 'Still pending' }
  failWrites = true; put(pending)
  await assert.rejects(flush(), /Offline/)
  assert.ok(!deleted().has(other.id))
  assert.equal(merge([])[0].courseCode, 'Still pending')
  failWrites = false; await flush()
  assert.equal(cloud.get(other.id).courseCode, 'Still pending')
} finally { console.warn = warn }
console.log('Event deletion checks passed: stale-device PUT rejection, permanent local deletion, CSV isolation, remote tombstones, offline delete/retry, legacy backend, and in-flight races.')
