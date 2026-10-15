import './register-typescript.mjs'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { spawnSync } from 'node:child_process'

const storage = new Map([['auto-scheduler-selected-date', '2026-10-05']])
globalThis.localStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }
const { createExamPeriodEvents, examBelongsToSchedule, examPeriodPrefix, isExamBooking, isExamDate } = await import('../frontend/src/formatters/examPeriod.ts')
const { ScheduleCalendar } = await import('../frontend/src/ui/schedule/ScheduleCalendar.tsx')
const { AssistantWeeklyCalendar } = await import('../frontend/src/ui/student-assistants/AssistantWeeklyCalendar.tsx')
const { AdminEventsPanel } = await import('../frontend/src/ui/admin-events/AdminEventsPanel.tsx')
const noop = () => {}
const period = createExamPeriodEvents('file_A', 'Exam Week', ['2026-10-05', '2026-10-06', '2026-10-05'])
assert.equal(period.length, 2)
assert.ok(examBelongsToSchedule(period[0], 'file_A'))
assert.ok(!examBelongsToSchedule(period[0], 'file_B'))
assert.ok(!examBelongsToSchedule(period[0], ''))
assert.equal(isExamDate(period, '2026-10-07'), false)
assert.equal(createExamPeriodEvents('', 'Exam Week', ['2026-10-05']).length, 0)

// Save/load through the real backend model and repository with network mocked.
const examBooking = { ...period[0], id: `booking_${examPeriodPrefix('file_A')}test_0_0_2026-10-05`,
  courseCode: 'EXAM_BOOKING', description: 'Bring your ID.\nArrive early.', room: 'MT102', startMinutes: 420, endMinutes: 480, classType: 'BOOKING' }
assert.ok(isExamBooking(examBooking))
assert.ok(examBelongsToSchedule(examBooking, 'file_A'))
assert.ok(!examBelongsToSchedule(examBooking, 'file_B'))
assert.ok(isExamDate([examBooking], '2026-10-05'))
const persisted = spawnSync('python', ['-X', 'utf8', '-c', `
import json,sys
from unittest.mock import patch
from backend.models.admin_event import validate_admin_event
from backend.database.supabase.admin_event_repository import save_event, load_events
events=json.load(sys.stdin)
rows=[]
with patch('backend.database.supabase.admin_event_repository.request') as request:
    for event in events:
        save_event(validate_admin_event(event,event['id']))
        rows.append(request.call_args.kwargs['payload'])
    request.return_value=rows
    print(json.dumps(load_events()))
`], {input:JSON.stringify([...period, examBooking]), encoding:'utf8'})
assert.equal(persisted.status, 0, persisted.stderr)
const restored = JSON.parse(persisted.stdout)
assert.ok(examBelongsToSchedule(restored[0], 'file_A'))
assert.ok(isExamDate(restored, '2026-10-05'))
const lesson = {id:'class-1',source:'csv',courseCode:'REGULAR_CLASS',subject:'',dayCode:'M',startMinutes:420,endMinutes:480,room:'MT102',section:'',classType:'LEC',studentCount:''}
const booking = {...lesson,id:'admin-1',source:'admin',courseCode:'BOOKED_EVENT',date:'2026-10-05',assistantId:'sa-1',assistantLabel:'Student'}
const calendarProps = {csvEvents:[lesson],csvName:'file_A.csv',tbaSubjects:[],rooms:['MT102'],times:[],onCsvUpload:noop,onCsvRemove:noop,onOpenEvents:noop,onEditEvent:noop,onDeleteEvent:noop,onAssignAssistant:noop}
const calendar = events => renderToStaticMarkup(React.createElement(ScheduleCalendar,{...calendarProps,adminEvents:events}))
assert.ok(calendar([booking]).includes('REGULAR_CLASS'))
assert.ok(calendar([booking]).includes('Remove CSV'))
assert.ok(calendar([booking]).includes('schedule-date-trigger'))
assert.ok(calendar([booking]).includes('aria-haspopup="dialog"'))
assert.ok(calendar([booking]).includes('schedule-date-arrow'))
assert.ok(!calendar([booking]).includes('>Today<'), 'Today is inside the closed picker, not on the toolbar')
assert.ok(!calendar([booking]).includes('type="date"'), 'Date picker is combined with the heading')
assert.ok(!calendar([booking]).includes('Upload Schedule'), 'Loaded schedule shows Remove CSV only')
const emptyCalendar = renderToStaticMarkup(React.createElement(ScheduleCalendar, {
  ...calendarProps, csvName:'', csvEvents:[], adminEvents:[], rooms:[],
}))
assert.ok(emptyCalendar.includes('Upload Schedule'))
assert.ok(!emptyCalendar.includes('Remove CSV'), 'Empty schedule shows Upload Schedule only')
const examCalendar = calendar([...restored,booking])
assert.ok(!examCalendar.includes('REGULAR_CLASS'))
assert.ok(examCalendar.includes('BOOKED_EVENT'))
assert.ok(examCalendar.includes('Exam period'))
assert.ok(calendar([booking]).includes('REGULAR_CLASS'), 'Deleting exam restores class')
assert.ok(!calendar([examBooking]).includes('REGULAR_CLASS'))
assert.ok(calendar([examBooking]).includes('EXAM_BOOKING'), 'Exam booking is visible, not an all-day marker')
assert.ok(isExamBooking(restored[2]), 'Exam flag survives database save/reload')
assert.equal(restored[2].description, examBooking.description, 'Description survives database save/reload')
const assistant = {id:'sa-1',label:'Student',fileName:'student.xlsx',events:[{...lesson,courseCode:'PERSONAL_CLASS'}]}
const assignment = {assistantId:'sa-1',classId:lesson.id,day:'M',courseCode:'REGULAR_DUTY',room:'MT102',startMinutes:420,endMinutes:480}
const weekly = events => renderToStaticMarkup(React.createElement(AssistantWeeklyCalendar,{
  assistant,assignments:[assignment],eventAssignments:[booking],relieverAssignments:[],
  examPeriods:events,weekStart:new Date('2026-10-05T12:00:00'),onViewDuty:noop,onRemoveDuty:noop,
}))
assert.ok(weekly([]).includes('PERSONAL_CLASS'))
assert.ok(weekly([]).includes('REGULAR_DUTY'))
assert.ok(!weekly(restored).includes('PERSONAL_CLASS'))
assert.ok(!weekly(restored).includes('REGULAR_DUTY'))
assert.ok(weekly(restored).includes('BOOKED_EVENT'))
const form = renderToStaticMarkup(React.createElement(AdminEventsPanel,{
  events:[],csvEvents:[lesson],rooms:['MT102'],onSave:noop,onBook:noop,
  onUpdateBooking:noop,onDeleteMany:noop,editRequest:null,onClose:noop,onExamDatesChange:noop,canCreateExamPeriod:true,
}))
assert.ok(form.includes('Exam date'))
assert.ok(form.includes('Time slots'))
assert.ok(form.includes('Room availability'))
assert.ok(form.includes('Description (optional)'))
assert.ok(form.includes('<textarea'), 'Event title uses an expanding textarea')
assert.ok(form.includes('Select All Rooms'))
assert.ok(!form.includes('Suspend regular classes on these dates'))
const today = new Date()
if (today.getDay() === 0) today.setDate(today.getDate() + 1)
const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
const todayClass = {...lesson,dayCode:['Su','M','T','W','Th','F','S'][today.getDay()]}
const todayExam = createExamPeriodEvents('file_A','Exam',[todayKey])
const roomForm = events => renderToStaticMarkup(React.createElement(AdminEventsPanel,{
  events,csvEvents:[todayClass],rooms:['MT102'],onSave:noop,onBook:noop,
  onUpdateBooking:noop,onDeleteMany:noop,editRequest:null,onClose:noop,onExamDatesChange:noop,canCreateExamPeriod:true,
}))
assert.ok(roomForm([]).includes('Occupied'))
assert.ok(roomForm(todayExam).includes('Vacant'))
assert.ok(!roomForm(todayExam).includes('Occupied'))
assert.ok(roomForm([...todayExam,{...booking,id:'booking_test_0_0_'+todayKey,date:todayKey}]).includes('Already booked'))
console.log('Exam-period checks passed: scope, multi-date creation, backend save/reload, class restoration, calendar and SA visibility, existing events retained, concise form label.')
