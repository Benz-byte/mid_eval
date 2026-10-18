import './register-typescript.mjs'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const { CalendarZoomControls } = await import('../frontend/src/ui/schedule/CalendarZoomControls.tsx')
const { ScheduleDateNavigation } = await import('../frontend/src/ui/schedule/ScheduleDateNavigation.tsx')
const { WeeklyWorkloadSummary } = await import('../frontend/src/ui/student-assistants/WeeklyWorkloadSummary.tsx')
const { StudentAssistantPanel } = await import('../frontend/src/ui/student-assistants/StudentAssistantPanel.tsx')
const { AdminEventsPanel } = await import('../frontend/src/ui/admin-events/AdminEventsPanel.tsx')
const { bookingFormFromEvents, bookingSeriesKey, inferBookingRepeat } = await import('../frontend/src/ui/admin-events/bookingForm.ts')
const { startOfWeek, toDateInputValue, dateFromInputValue, weekRangeLabel } = await import('../frontend/src/formatters/dateFormatter.ts')
const { assistantDisplayName } = await import('../frontend/src/formatters/assistantNameFormatter.ts')
const { workloadHoursLabel } = await import('../frontend/src/formatters/timeFormatter.ts')

let zoom = 100
const controls = CalendarZoomControls({ value: zoom, onChange: value => { zoom = value } })
controls.props.children[0].props.onClick()
assert.equal(zoom, 75)
controls.props.children[2].props.onClick()
assert.equal(zoom, 125)
controls.props.children[1].props.onClick()
assert.equal(zoom, 100)
assert.equal(CalendarZoomControls({value:75,onChange:()=>{}}).props.children[0].props.disabled, true)
assert.equal(CalendarZoomControls({value:200,onChange:()=>{}}).props.children[2].props.disabled, true)

const monday = new Date(2026, 9, 12)
assert.equal(toDateInputValue(startOfWeek(new Date(2026,9,18))), '2026-10-12')
assert.equal(toDateInputValue(dateFromInputValue('2026-12-31')), '2026-12-31')
assert.ok(weekRangeLabel(new Date(2026,11,28)).includes('2027'))
const markup = viewMode => renderToStaticMarkup(React.createElement(ScheduleDateNavigation,{date:monday,viewMode,onChange:()=>{}}))
assert.ok(markup('daily').includes('Monday'))
assert.ok(markup('daily').includes('Previous date'))
assert.ok(markup('weekly').includes('Previous week'))
assert.ok(!markup('daily').includes('>Today<'))
assert.ok(markup('daily').includes('aria-expanded="false"'))
assert.equal(assistantDisplayName({firstName:'Dylan',middleName:'James',lastName:'Libo-on'}), 'Dylan J. Libo-on')
assert.equal(assistantDisplayName({label:'Legacy name',fileName:'sample.xlsx'}), 'Legacy name')
assert.equal(workloadHoursLabel(90), '1.5 hours')
assert.equal(workloadHoursLabel(60), '1 hour')

const event = {id:'booking_series_0_0_2026-10-12',courseCode:'Exam',description:'Bring ID',room:'MT102',date:'2026-10-12',startMinutes:420,endMinutes:480}
const form = bookingFormFromEvents([event,{...event,date:'2026-10-13'}])
assert.equal(form.description, 'Bring ID')
assert.deepEqual(form.rooms, ['MT102'])
assert.equal(form.startTime, '07:00')
assert.equal(form.endTime, '08:00')
assert.equal(form.repeat, 'daily')
assert.equal(bookingSeriesKey(event.id), 'booking_series')
assert.deepEqual(inferBookingRepeat(['2026-10-12','2026-10-19']).weekdays, [1])

const row = {id:'a',name:'Dylan J. Libo-on',dutyMinutes:60,eventMinutes:0,relieverMinutes:30,totalMinutes:90}
const summary = renderToStaticMarkup(React.createElement(WeeklyWorkloadSummary,{weekStart:monday,rows:[row],ascending:false,onSortChange:()=>{},onClose:()=>{}}))
assert.ok(summary.includes(row.name) && summary.includes('1.5 hours'))
assert.ok(summary.includes('Most workload first') && summary.includes('Least workload first'))
assert.ok(summary.includes('role="dialog"') && summary.includes('aria-modal="true"'))
const noop = () => {}
const oldEvent = { ...event, id:'admin-old-event' }
const legacyEditor = renderToStaticMarkup(React.createElement(AdminEventsPanel, {
  events:[oldEvent],csvEvents:[],rooms:['MT102'],editRequest:{eventId:oldEvent.id},
  onSave:noop,onBook:noop,onUpdateBooking:noop,onDeleteMany:noop,onClose:noop,
  onExamDatesChange:noop,canCreateExamPeriod:true,
}))
assert.ok(legacyEditor.includes('Save Changes') && legacyEditor.includes('Bring ID'), 'Old saved events still open in the move editor')
const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
const legacyRoster = JSON.stringify({
  activeScheduleKey:'current-csv', assistants:[], rostersBySchedule:{'current-csv':[]},
  unlinkedAssistants:[{id:'previous-student',label:'Previous Student',fileName:'previous.xlsx',events:[]}],
})
try {
  Object.defineProperty(globalThis, 'localStorage', { configurable:true, value:{getItem:()=>legacyRoster} })
  const assistantPanel = renderToStaticMarkup(React.createElement(StudentAssistantPanel, {
    mainSchedule:[],mainScheduleName:'Current.csv',mainScheduleKey:'current-csv',adminEvents:[],onViewDuty:noop,
  }))
  assert.ok(!assistantPanel.includes('Link previous assistants to this CSV'), 'Legacy linking button must not appear')
  assert.ok(assistantPanel.includes('No student assistant added'), 'Previous assistants must not be added to this CSV automatically')
} finally {
  if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage)
  else delete globalThis.localStorage
}
console.log('UI component checks passed: zoom controls, daily/weekly headings, date helpers, names, hours, booking forms and workload summary.')
