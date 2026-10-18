import './register-typescript.mjs'
import assert from 'node:assert/strict'
const {planAssistantEdit}=await import('../frontend/src/formatters/assistantSchedule.ts')
const {DEFAULT_SCHEDULING_SETTINGS:settings}=await import('../frontend/src/api/studentAssistantApi.ts')
const people=[{id:'A',label:'Original, Alice',events:[]},{id:'B',label:'Other, Bob',events:[]}]
const duty=(id,day,start,end)=>({assistantId:id,assistantLabel:people.find(p=>p.id===id).label,classId:`${id}-${day}`,day,room:'MT102',courseCode:'CCS 1001',startMinutes:start,endMinutes:end})
const assignments=[duty('A','M',420,540),duty('A','T',600,660),duty('B','M',420,540)]
const relievers=[{classId:'A-M',originalAssistantId:'A',originalAssistantLabel:people[0].label,replacementAssistantId:'B',replacementAssistantLabel:people[1].label,day:'M',date:'2026-10-19',courseCode:'CCS 1001',room:'MT102',startMinutes:420,endMinutes:540},
  {classId:'B-M',originalAssistantId:'B',originalAssistantLabel:people[1].label,replacementAssistantId:'A',replacementAssistantLabel:people[0].label,day:'M',date:'2026-10-19',courseCode:'CCS 2200',room:'MTCL1',startMinutes:660,endMinutes:720}]
const events=[{id:'event',assistantId:'A',assistantLabel:people[0].label,date:'2026-10-19',courseCode:'Department event',room:'MTCL1',startMinutes:540,endMinutes:600}]
const result={status:'OPTIMAL',diagnostics:[],assignments,relieverAssignments:relievers,optimizedAssistantIds:['A','B'],assistantTotals:people.map(p=>({assistantId:p.id,assistantLabel:p.label,hours:p.id==='A'?3:2})),summary:{assistantCount:2,assignmentCount:3,coverageHours:5}}
const source=JSON.stringify({people,result,events})
const main=assignments.map(a=>({id:a.classId}))
const renamed={...people[0],label:'Renamed, Alicia'}
const namePlan=planAssistantEdit(result,renamed,people,main,events,settings,false)
assert.equal(namePlan.result.assignments.length,3)
assert.equal(namePlan.result.status,'OPTIMAL')
assert.deepEqual(namePlan.conflicts,[])
assert.deepEqual(namePlan.unassignedEventIds,[])
assert.ok(namePlan.result.assignments.filter(a=>a.assistantId==='A').every(a=>a.assistantLabel===renamed.label))
assert.equal(namePlan.result.relieverAssignments[0].originalAssistantLabel,renamed.label)
assert.equal(namePlan.result.relieverAssignments[1].replacementAssistantLabel,renamed.label)
assert.equal(namePlan.result.assistantTotals[0].assistantLabel,renamed.label)
const changed={...renamed,events:[{dayCode:'M',startMinutes:480,endMinutes:720}]}
const plan=planAssistantEdit(result,changed,people,main,events,settings,true)
assert.equal(plan.conflicts.length,4,'List the conflicting duty/event, replacement duty, and coverage tied to the removed original duty')
assert.deepEqual(plan.unassignedEventIds,['event'])
assert.deepEqual(plan.result.assignments.map(a=>a.classId),['A-T','B-M'])
assert.deepEqual(plan.result.assignments.find(a=>a.assistantId==='B'),assignments[2],'Do not change another assistant’s duties')
assert.deepEqual(plan.result.relieverAssignments,[])
assert.equal(plan.result.assistantTotals[0].hours,1)
assert.equal(plan.result.summary.unassignedClassCount,1)
assert.equal(plan.result.status,'FEASIBLE')
assert.equal(JSON.stringify({people,result,events}),source,'Planning/confirmation must not mutate saved data')
const boundary=planAssistantEdit(result,{...renamed,events:[{dayCode:'M',startMinutes:600,endMinutes:660}]},people,main,events,settings,true)
assert.deepEqual(boundary.conflicts,[],'Touching time boundaries are not overlaps')
const weekday=planAssistantEdit(result,{...renamed,events:[{dayCode:'Th',startMinutes:420,endMinutes:720}]},people,main,events,settings,true)
assert.deepEqual(weekday.conflicts,[],'Thursday must not match Tuesday')
const examEvents=[...events,{id:'exam_test',date:'2026-10-19'}]
assert.equal(planAssistantEdit(result,changed,people,main,examEvents,settings,true).unassignedEventIds.length,0,'Exam-day event eligibility matches the existing suspended-class rule')
assert.equal(planAssistantEdit(null,renamed,people,main,events,settings,false).result,null)
console.log('Assistant edit checks passed: preserved duties, renamed labels, targeted conflict plans, original/replacement relievers, event eligibility, boundaries, and no mutation before confirmation.')
