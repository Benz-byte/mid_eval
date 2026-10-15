import './register-typescript.mjs'
import assert from 'node:assert/strict'

const { weeklyWorkloads, sortWeeklyWorkloads } = await import('../frontend/src/formatters/weeklyWorkload.ts')
const students = [{ id: 'a', name: 'Anna' }, { id: 'b', name: 'Ben' }, { id: 'c', name: 'Cara' }, { id: 'd', name: 'Dylan' }]
const week = new Date(2026, 9, 12)
const duty = { assistantId: 'a', classId: 'duty', day: 'M', startMinutes: 420, endMinutes: 600 }
const event = { id: 'booking_test', assistantId: 'a', date: '2026-10-13', startMinutes: 420, endMinutes: 480 }
const relief = { originalAssistantId: 'a', replacementAssistantId: 'b', classId: 'duty', day: 'M', date: '2026-10-12', startMinutes: 420, endMinutes: 600 }
let rows = weeklyWorkloads(students, [duty], [event], [relief], week)
assert.deepEqual(rows.map(row => row.totalMinutes), [60, 180, 0, 0])
assert.deepEqual(sortWeeklyWorkloads(rows).map(row => row.id), ['b', 'a', 'c', 'd'])
assert.deepEqual(sortWeeklyWorkloads(rows, true).map(row => row.id), ['c', 'd', 'a', 'b'])
assert.equal(rows[0].dutyMinutes, 0, 'Original assistant does not count relieved duty')
assert.equal(rows[1].relieverMinutes, 180)
assert.deepEqual(weeklyWorkloads(students, [duty], [event], [relief], new Date(2026, 9, 19)).map(row => row.totalMinutes), [180, 0, 0, 0], 'Regular duties recur; events and relief are date-specific')
rows = weeklyWorkloads(students, [duty], [event, {id:'exam_test', date:'2026-10-12'}], [relief], week)
assert.deepEqual(rows.map(row => row.totalMinutes), [60, 0, 0, 0], 'Exam date suspends regular and reliever duties')
rows = weeklyWorkloads(students, [duty], [], [{ ...relief, replacementAssistantId: undefined }], week)
assert.equal(rows[0].dutyMinutes, 180, 'Pending relief does not count as covered')
rows = weeklyWorkloads(students, [duty], [], [{ ...relief, endMinutes: 480 }], week)
assert.equal(rows[0].dutyMinutes, 120, 'Partial relief subtracts only covered time')
assert.deepEqual(weeklyWorkloads(students, [], [], [], week).map(row => row.totalMinutes), [0,0,0,0])
console.log('Weekly workload tests passed: sorting, ties, zero hours, week boundaries, exams, full and partial relief.')
