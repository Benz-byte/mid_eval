import assert from 'node:assert/strict'
import './register-typescript.mjs'
const { editedBookingEvents, validateEditedEventAssistants } = await import('../frontend/src/formatters/bookingEdit.ts')
const { bookingSeriesKey } = await import('../frontend/src/formatters/bookingSeries.ts')
const old = { id: 'booking_demo_0_0_2026-10-16', source: 'admin', scheduleKey: 'csv',
  courseCode: 'Event', date: '2026-10-16', room: 'A', startMinutes: 600, endMinutes: 660,
  assistantId: 'student', assistantLabel: 'Maria', subject: '', classType: 'BOOKING', section: '', studentCount: '' }
const assistant = { id: 'student', label: 'Maria', events: [] }
const form = { title: 'Updated', description: 'New description', rooms: ['A'], examPeriod: false }
const slot = (rooms = ['A'], startTime = '10:00', endTime = '11:00', date = old.date) => [{ date, rooms, timeRanges: [{ startTime, endTime }] }]
const rename = editedBookingEvents([old], form, slot(), 'csv')
assert.equal(rename[0].id, old.id)
assert.equal(rename[0].assistantId, 'student')
assert.equal(rename[0].description, 'New description')
assert.equal(old.courseCode, 'Event', 'input is not mutated')
const added = editedBookingEvents([old], form, slot(['B', 'A']), 'csv')
assert.equal(added.find(item => item.room === 'A').id, old.id)
assert.equal(added.find(item => item.room === 'B').assistantId, undefined)
assert.equal(bookingSeriesKey(added[0].id), 'booking_demo', 'new cards stay in the edited series')
const moved = editedBookingEvents([old], form, slot(['B'], '11:00', '12:00'), 'csv')
assert.equal(moved[0].id, old.id)
assert.equal(moved[0].assistantId, 'student')
const check = (events, assistants = [assistant], result = null, others = []) => validateEditedEventAssistants([old], events, others, assistants, result)
assert.equal(check(moved).conflicts.length, 0)
const personal = { ...assistant, events: [{ dayCode: 'F', startMinutes: 660, endMinutes: 720 }] }
assert.equal(check(moved, [personal]).events[0].assistantId, undefined)
assert.equal(check(moved, [personal]).conflicts.length, 1)
assert.equal(check(rename, [{ ...assistant, events: [{ dayCode: 'F', startMinutes: 600, endMinutes: 660 }] }]).conflicts.length, 0, 'text-only edits retain assignments')
const duty = { assistantId: 'student', day: 'F', startMinutes: 660, endMinutes: 720 }
assert.equal(check(moved, [assistant], { assignments: [duty] }).conflicts.length, 1)
assert.equal(check(moved, [assistant], { relieverAssignments: [{ ...duty, date: old.date, replacementAssistantId: 'student' }] }).conflicts.length, 1)
assert.equal(check(moved, [assistant], null, [{ ...old, id: 'other', startMinutes: 690, endMinutes: 750 }]).conflicts.length, 1)
assert.equal(check(moved, [assistant], { assignments: [{ ...duty, startMinutes: 720 }] }).conflicts.length, 0, 'adjacent slots do not overlap')
const exam = editedBookingEvents([old], { ...form, examPeriod: true }, slot(['B'], '11:00', '12:00'), 'csv')
assert.ok(exam[0].id.startsWith('booking_exam_'))
assert.equal(check(exam, [personal], { assignments: [duty] }).conflicts.length, 0, 'exam days suspend regular duties and personal classes')
assert.equal(check(exam, [assistant], null, [{ ...old, id: 'other', startMinutes: 690, endMinutes: 750 }]).conflicts.length, 1, 'exam days still check other events')
assert.equal(check(moved, []).conflicts.length, 1, 'missing assistants cannot be retained on changed slots')
const dayMoved = editedBookingEvents([old], form, slot(['A'], '10:00', '11:00', '2026-10-17'), 'csv')
assert.equal(dayMoved[0].id, old.id)
assert.equal(check(dayMoved, [personal]).conflicts.length, 0)
console.log('Booking edit regression tests passed.')
