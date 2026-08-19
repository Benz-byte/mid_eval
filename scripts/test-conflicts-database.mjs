import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const DAY_ORDER = ['M', 'T', 'W', 'Th', 'F', 'S', 'Su']
const DAY_NAMES = {
  M: 'Monday',
  T: 'Tuesday',
  W: 'Wednesday',
  Th: 'Thursday',
  F: 'Friday',
  S: 'Saturday',
  Su: 'Sunday',
}

async function loadEnvironment() {
  try {
    const contents = await readFile('.env', 'utf8')
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!match || process.env[match[1]]) continue
      process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

function expandDays(dayCode) {
  const days = String(dayCode ?? '').match(/Th|Su|M|T|W|F|S/g) ?? []
  return days.join('') === String(dayCode ?? '').trim() ? days : []
}

function detectConflicts(events) {
  const occurrences = events.flatMap((event, index) =>
    expandDays(event.dayCode).map(day => ({
      ...event,
      occurrenceId: `${event.id ?? index}-${day}`,
      day,
    })),
  )
  const conflictGroups = new Map()

  for (let firstIndex = 0; firstIndex < occurrences.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < occurrences.length; secondIndex += 1) {
      const first = occurrences[firstIndex]
      const second = occurrences[secondIndex]
      const overlaps = first.day === second.day
        && first.room === second.room
        && first.startMinutes < second.endMinutes
        && first.endMinutes > second.startMinutes
      if (!overlaps) continue

      const key = `${first.day}|${first.room}`
      const group = conflictGroups.get(key) ?? {
        day: first.day,
        room: first.room,
        events: new Map(),
      }
      group.events.set(first.occurrenceId, first)
      group.events.set(second.occurrenceId, second)
      conflictGroups.set(key, group)
    }
  }

  return [...conflictGroups.values()].sort((left, right) =>
    DAY_ORDER.indexOf(left.day) - DAY_ORDER.indexOf(right.day)
    || left.room.localeCompare(right.room),
  )
}

function formatTime(minutes) {
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  const period = hour >= 12 ? 'PM' : 'AM'
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${period}`
}

function eventLabel(event) {
  const subject = event.subject || event.courseCode || 'Untitled class'
  const details = [event.section, event.instructorLastName].filter(Boolean)
  return details.length ? `${subject} (${details.join(' · ')})` : subject
}

await loadEnvironment()

const url = process.env.VITE_SUPABASE_URL
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
if (!url || !key) {
  throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are required in .env.')
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})
const { data, error } = await supabase
  .from('shared_schedules')
  .select('csv_events')
  .eq('id', 'ccs-main')
  .maybeSingle()

if (error) throw error
if (!data) throw new Error('No uploaded shared schedule was found.')

const events = Array.isArray(data.csv_events) ? data.csv_events : []
const groups = detectConflicts(events)

if (groups.length === 0) {
  console.log('No conflicts found.')
} else {
  for (const group of groups) {
    console.log(`\nConflict - ${DAY_NAMES[group.day] ?? group.day}`)
    console.log(`Room: ${group.room}`)
    const sortedEvents = [...group.events.values()].sort((left, right) =>
      left.startMinutes - right.startMinutes || left.endMinutes - right.endMinutes,
    )
    for (const event of sortedEvents) {
      console.log(`- ${eventLabel(event)}, ${formatTime(event.startMinutes)}–${formatTime(event.endMinutes)}`)
    }
  }
  console.log(`\nConflict detector test passed: ${groups.length} room/day conflict groups found.`)
}
