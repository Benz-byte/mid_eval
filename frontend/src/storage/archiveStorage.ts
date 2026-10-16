import { createSharedArchive, deleteSharedArchive, loadSharedArchives } from '../api/archiveApi'
import type { ArchiveRecord, RemoteArchiveRecord, ScheduleArchive } from './archiveTypes'
import { normalizedArchiveName } from '../formatters/archiveName'

const DATABASE_NAME = 'auto-scheduler-archives'
const STORE = 'archives'
let database: Promise<IDBDatabase> | null = null
let synchronization: Promise<void> | null = null

function openDatabase() {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => { database = null; reject(new Error('Could not open local archive storage.')) }
  })
  return database
}

async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, done: (value: T) => void, fail: (error: Error) => void) => void): Promise<T> {
  const db = await openDatabase()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    let result: T
    let failure: Error | undefined
    tx.oncomplete = () => resolve(result)
    tx.onabort = tx.onerror = () => reject(failure ?? new Error('Could not save archives on this device. Check available storage and try again.'))
    try { run(tx.objectStore(STORE), value => { result = value }, error => { failure = error; tx.abort() }) }
    catch (error) { tx.abort(); reject(error) }
  })
}

export function listLocalArchives(): Promise<ArchiveRecord[]> {
  return transaction('readonly', (store, done) => {
    const request = store.getAll()
    request.onsuccess = () => done(request.result as ArchiveRecord[])
  })
}

export async function saveArchiveLocally(archive: ScheduleArchive) {
  await transaction<void>('readwrite', (store, done, fail) => {
    const request = store.getAll()
    request.onsuccess = () => {
      const duplicate = (request.result as ArchiveRecord[]).some(record => !record.deletedAt
        && normalizedArchiveName(record.archive.name) === normalizedArchiveName(archive.name))
      if (duplicate) { fail(new Error('An archive with this name already exists. Choose a different name.')); return }
      store.add({ id: archive.id, archive, deletedAt: null, pending: true } satisfies ArchiveRecord)
      done(undefined)
    }
  })
}

export function deleteArchiveLocally(id: string) {
  return transaction<void>('readwrite', (store, done) => {
    const request = store.get(id)
    request.onsuccess = () => {
      const record = request.result as ArchiveRecord | undefined
      if (record) store.put({ ...record, deletedAt: new Date().toISOString(), pending: true })
      done(undefined)
    }
  })
}

export function mergeArchiveRecord(local: ArchiveRecord | undefined, remote: RemoteArchiveRecord): ArchiveRecord {
  if (local?.pending) return local
  // A stale remote list must never resurrect a locally deleted snapshot.
  if (local?.deletedAt && !remote.deletedAt) return local
  return { ...remote, pending: false }
}

async function acknowledge(record: ArchiveRecord) {
  await transaction<void>('readwrite', (store, done) => {
    const request = store.get(record.id)
    request.onsuccess = () => {
      const latest = request.result as ArchiveRecord | undefined
      if (latest && latest.deletedAt === record.deletedAt) store.put({ ...latest, pending: false })
      done(undefined)
    }
  })
}

export function syncArchives(): Promise<void> {
  if (synchronization) return synchronization
  synchronization = (async () => {
    const local = await listLocalArchives()
    for (const record of local.filter(value => value.pending)) {
      // Insert-if-absent cannot overwrite a saved archive or revive a tombstone.
      await createSharedArchive(record.archive)
      if (record.deletedAt) await deleteSharedArchive(record.id)
      await acknowledge(record)
    }
    const remote = await loadSharedArchives()
    await transaction<void>('readwrite', (store, done) => {
      for (const record of remote) {
        const request = store.get(record.id)
        request.onsuccess = () => store.put(mergeArchiveRecord(request.result as ArchiveRecord | undefined, record))
      }
      done(undefined)
    })
  })().finally(() => { synchronization = null })
  return synchronization
}
