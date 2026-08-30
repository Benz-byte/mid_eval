import { deleteSharedAdminEvent, saveSharedAdminEvent } from '../api/adminEventApi'
import { saveSharedSchedule, type SharedSchedule } from '../api/scheduleApi'
import {
  DEFAULT_SCHEDULING_SETTINGS,
  saveSharedStudentAssistantData,
  type SchedulingSettings,
  type StudentAssistantResult,
} from '../api/studentAssistantApi'
import type { CalendarEvent, UploadedAssistant } from '../types'

const PENDING_SCHEDULE_KEY = 'auto-scheduler-pending-schedule-sync'
const PENDING_ADMIN_KEY = 'auto-scheduler-pending-admin-sync'
const PENDING_ASSISTANT_KEY = 'auto-scheduler-pending-assistant-sync'

type AdminQueue = {
  upserts: Record<string, CalendarEvent>
  deletes: string[]
}

type AssistantSnapshot = {
  assistants: UploadedAssistant[]
  result: StudentAssistantResult | null
  settings: SchedulingSettings
}

let scheduleFlush: Promise<void> | null = null
let adminFlush: Promise<void> | null = null
let assistantFlush: Promise<void> | null = null

function readJson<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key)
    return saved ? JSON.parse(saved) as T : fallback
  } catch {
    return fallback
  }
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function hasPendingScheduleSync() {
  return localStorage.getItem(PENDING_SCHEDULE_KEY) !== null
}

export function queueScheduleSync(value: SharedSchedule<CalendarEvent>) {
  localStorage.setItem(PENDING_SCHEDULE_KEY, JSON.stringify(value))
  void flushPendingScheduleSync().catch(error => console.warn('Background schedule synchronization will retry.', error))
}

export function flushPendingScheduleSync(): Promise<void> {
  if (scheduleFlush) return scheduleFlush
  scheduleFlush = (async () => {
    const pending = readJson<SharedSchedule<CalendarEvent> | null>(PENDING_SCHEDULE_KEY, null)
    if (!pending) return
    await saveSharedSchedule(pending)
    const latest = readJson<SharedSchedule<CalendarEvent> | null>(PENDING_SCHEDULE_KEY, null)
    if (sameValue(latest, pending)) localStorage.removeItem(PENDING_SCHEDULE_KEY)
  })().finally(() => { scheduleFlush = null })
  return scheduleFlush
}

function loadAdminQueue(): AdminQueue {
  const queue = readJson<AdminQueue>(PENDING_ADMIN_KEY, { upserts: {}, deletes: [] })
  return {
    upserts: queue.upserts && typeof queue.upserts === 'object' ? queue.upserts : {},
    deletes: Array.isArray(queue.deletes) ? queue.deletes : [],
  }
}

function saveAdminQueue(queue: AdminQueue) {
  if (Object.keys(queue.upserts).length === 0 && queue.deletes.length === 0) {
    localStorage.removeItem(PENDING_ADMIN_KEY)
  } else {
    localStorage.setItem(PENDING_ADMIN_KEY, JSON.stringify(queue))
  }
}

export function queueAdminUpsert(event: CalendarEvent) {
  const queue = loadAdminQueue()
  queue.upserts[event.id] = event
  queue.deletes = queue.deletes.filter(id => id !== event.id)
  saveAdminQueue(queue)
  void flushPendingAdminSync().catch(error => console.warn('Background event synchronization will retry.', error))
}

export function queueAdminDelete(id: string) {
  const queue = loadAdminQueue()
  delete queue.upserts[id]
  if (!queue.deletes.includes(id)) queue.deletes.push(id)
  saveAdminQueue(queue)
  void flushPendingAdminSync().catch(error => console.warn('Background event synchronization will retry.', error))
}

export function mergePendingAdminEvents(remoteEvents: CalendarEvent[]) {
  const queue = loadAdminQueue()
  const merged = new Map(remoteEvents.map(event => [event.id, event]))
  queue.deletes.forEach(id => merged.delete(id))
  Object.values(queue.upserts).forEach(event => merged.set(event.id, event))
  return [...merged.values()]
}

export function flushPendingAdminSync(): Promise<void> {
  if (adminFlush) return adminFlush
  adminFlush = (async () => {
    const snapshot = loadAdminQueue()
    for (const id of snapshot.deletes) {
      await deleteSharedAdminEvent(id)
      const latest = loadAdminQueue()
      if (latest.deletes.includes(id) && !latest.upserts[id]) {
        latest.deletes = latest.deletes.filter(value => value !== id)
        saveAdminQueue(latest)
      }
    }
    for (const event of Object.values(snapshot.upserts)) {
      await saveSharedAdminEvent(event)
      const latest = loadAdminQueue()
      if (sameValue(latest.upserts[event.id], event)) {
        delete latest.upserts[event.id]
        saveAdminQueue(latest)
      }
    }
  })().finally(() => { adminFlush = null })
  return adminFlush
}

export function hasPendingAssistantSync() {
  return localStorage.getItem(PENDING_ASSISTANT_KEY) !== null
}

export function queueAssistantSync(value: AssistantSnapshot) {
  localStorage.setItem(PENDING_ASSISTANT_KEY, JSON.stringify(value))
  void flushPendingAssistantSync().catch(error => console.warn('Background assistant synchronization will retry.', error))
}

export function flushPendingAssistantSync(): Promise<void> {
  if (assistantFlush) return assistantFlush
  assistantFlush = (async () => {
    const pending = readJson<AssistantSnapshot | null>(PENDING_ASSISTANT_KEY, null)
    if (!pending) return
    await saveSharedStudentAssistantData({
      assistants: pending.assistants,
      solverResult: pending.result,
      schedulingSettings: pending.settings ?? DEFAULT_SCHEDULING_SETTINGS,
    })
    const latest = readJson<AssistantSnapshot | null>(PENDING_ASSISTANT_KEY, null)
    if (sameValue(latest, pending)) localStorage.removeItem(PENDING_ASSISTANT_KEY)
  })().finally(() => { assistantFlush = null })
  return assistantFlush
}
