const events = [
  {
    subject: 'CCS 1301',
    section: 'BSIT 1-01',
    professor: 'Baylon, G',
    day: 'Monday',
    room: 'MTAVR2',
    startMinutes: 10 * 60,
    endMinutes: 12 * 60,
  },
  {
    subject: 'CCS 1500',
    section: 'BSCS 1-02',
    professor: 'Oñate, V',
    day: 'Monday',
    room: 'MTAVR2',
    startMinutes: 10 * 60 + 30,
    endMinutes: 12 * 60 + 30,
  },
  {
    subject: 'IT 3110',
    section: 'BSIT 2-01',
    professor: 'Taasan, A',
    day: 'Monday',
    room: 'MTCL3',
    startMinutes: 13 * 60,
    endMinutes: 16 * 60,
  },
  {
    subject: 'CCS 2401',
    section: 'BSIT 2-02',
    professor: 'Parreño, M',
    day: 'Monday',
    room: 'MTCL3',
    startMinutes: 14 * 60,
    endMinutes: 17 * 60,
  },
]

function detectConflicts(schedule) {
  const conflicts = []
  for (let firstIndex = 0; firstIndex < schedule.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < schedule.length; secondIndex += 1) {
      const first = schedule[firstIndex]
      const second = schedule[secondIndex]
      const overlaps = first.day === second.day
        && first.room === second.room
        && first.startMinutes < second.endMinutes
        && first.endMinutes > second.startMinutes
      if (overlaps) conflicts.push([first, second])
    }
  }
  return conflicts
}

function formatTime(minutes) {
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  const period = hour >= 12 ? 'PM' : 'AM'
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${period}`
}

const conflicts = detectConflicts(events)
if (conflicts.length !== 2) {
  throw new Error(`Expected 2 conflicts but detected ${conflicts.length}.`)
}

const grouped = new Map()
for (const [first, second] of conflicts) {
  const key = `${first.day}|${first.room}`
  const group = grouped.get(key) ?? { day: first.day, room: first.room, events: new Set() }
  group.events.add(first)
  group.events.add(second)
  grouped.set(key, group)
}

for (const group of grouped.values()) {
  console.log(`Conflict - ${group.day}`)
  console.log(`Room: ${group.room}`)
  for (const event of group.events) {
    console.log(`- ${event.subject} (${event.section} · ${event.professor}), ${formatTime(event.startMinutes)}–${formatTime(event.endMinutes)}`)
  }
  console.log('')
}

console.log(`Conflict detector test passed: ${conflicts.length} conflicts found.`)
