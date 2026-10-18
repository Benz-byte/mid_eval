import './register-typescript.mjs'
import assert from 'node:assert/strict'
const disk=new Map()
globalThis.localStorage={getItem:k=>disk.get(k)??null,setItem:(k,v)=>disk.set(k,v),removeItem:k=>disk.delete(k)}
globalThis.window={electron:{flaskUrl:'http://removal-test'}}
let uploaded
globalThis.fetch=async(_url,init)=>{
  uploaded=JSON.parse(init.body)
  return {ok:true,status:200,json:async()=>({rosterStorageVersion:1,resultStorageVersion:1})}
}
const {withoutAssistantAssignments}=await import('../frontend/src/formatters/assistantSchedule.ts')
const {saveLocalAssistantData:save,loadLocalAssistantData:load,activateLocalAssistantSchedule:activate}=await import('../frontend/src/storage/studentAssistantStorage.ts')
const {flushPendingAssistantSync}=await import('../frontend/src/storage/localFirstSync.ts')
const {DEFAULT_SCHEDULING_SETTINGS:settings}=await import('../frontend/src/api/studentAssistantApi.ts')
const assistants=['A','B','C'].map(id=>({id,label:id,fileName:id+'.xlsx',events:[]}))
const assignments=assistants.map((assistant,index)=>({assistantId:assistant.id,assistantLabel:assistant.label,classId:'class-'+assistant.id,
  day:'M',room:'MT102',courseCode:'CCS '+index,subject:'',section:'',startMinutes:420+index*120,endMinutes:540+index*120}))
const relievers=[
  {classId:'class-A',date:'2026-10-19',originalAssistantId:'A',replacementAssistantId:'B'},
  {classId:'class-B',date:'2026-10-19',originalAssistantId:'B',replacementAssistantId:'A'},
  {classId:'class-C',date:'2026-10-19',originalAssistantId:'C',replacementAssistantId:'B'},
]
const result={status:'OPTIMAL',diagnostics:[],assignments,optimizedAssistantIds:['A','B'],relieverAssignments:relievers,
  summary:{assistantCount:3,coverageHours:6},assistantTotals:assistants.map(a=>({assistantId:a.id,assistantLabel:a.label,hours:2}))}
const main=assignments.map(a=>({id:a.classId}))
const untouched=JSON.stringify(result)
const remaining=assistants.filter(a=>a.id!=='A')
const next=withoutAssistantAssignments(result,'A',remaining,main,settings)
assert.deepEqual(next.assignments,assignments.slice(1),'Other assistants keep identical duties, rooms, days, and times')
assert.equal(next.status,'FEASIBLE')
assert.deepEqual(next.relieverAssignments,[relievers[2]])
assert.deepEqual(next.optimizedAssistantIds,['B'],'Do not mark previously unoptimized assistants as optimized')
assert.equal(next.assistantTotals.length,2)
assert.ok(next.assistantTotals.every(total=>total.hours===2))
assert.equal(next.summary.unassignedClassCount,1)
assert.equal(next.summary.assignedClassCount,2)
assert.equal(next.summary.assignmentCount,2)
assert.equal(next.summary.assistantCount,2)
assert.equal(JSON.stringify(result),untouched,'Original result/archive snapshot must not be mutated')
assert.equal(withoutAssistantAssignments(null,'A',remaining,main,settings),null)
const last=withoutAssistantAssignments({...result,assignments:[assignments[0]],relieverAssignments:[]},'A',[],main,settings)
assert.deepEqual(last.assignments,[])
assert.deepEqual(last.assistantTotals,[])
const otherResult={...result,diagnostics:['Other CSV']}
save({assistants,result,settings,activeScheduleKey:'first',rostersBySchedule:{first:assistants,second:assistants},resultsBySchedule:{first:result,second:otherResult}},false)
save({...load(),assistants:remaining,result:next})
await flushPendingAssistantSync()
assert.deepEqual(load().result.assignments,assignments.slice(1),'Remaining duties survive local reload')
assert.deepEqual(uploaded.solverResult.assignments,assignments.slice(1),'Sync uploads the remaining result, not null')
assert.deepEqual(uploaded.solverResultsBySchedule.second,otherResult,'Other CSVs are untouched')
activate('second',false)
assert.deepEqual(load().result,otherResult)
activate('first',false)
assert.deepEqual(load().result.assignments,assignments.slice(1),'Switching CSVs restores remaining duties')
console.log('Assistant removal checks passed: retained duties, totals, optimized IDs, relievers, empty/no-result cases, local persistence, cloud payload, and CSV isolation.')
