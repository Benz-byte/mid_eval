// Isolated Electron rendering test. Uses synthetic fixtures and mocks every
// backend call; never reads the user's app profile or contacts Supabase.
const {app,BrowserWindow}=require('electron')
const {createServer}=require('node:http')
const {readFileSync,writeFileSync,mkdtempSync,mkdirSync}=require('node:fs')
const path=require('node:path')
const os=require('node:os')
const assert=require('node:assert/strict')
const output=mkdtempSync(path.join(os.tmpdir(),'scheduler-theme-check-'))
const log=message=>writeFileSync(path.join(output,'run.log'),String(message)+'\n',{flag:'a'})
process.on('uncaughtException',error=>{log(error.stack);app.exit(1)})
log('starting')
mkdirSync(path.join(output,'profile'))
app.setPath('userData',path.join(output,'profile'))
app.disableHardwareAcceleration()
const event={id:'lesson',source:'csv',courseCode:'CCS 1001',subject:'Programming',dayCode:'F',room:'MT102',section:'A',classType:'LEC',studentCount:'30',startMinutes:420,endMinutes:600}
const events=[event,{...event,id:'conflict',courseCode:'CCS 2200',startMinutes:480,endMinutes:540}]
const schedule={events,name:'Theme test.csv',rooms:['MT102','MTCL1'],times:[420,480,540,600,660],fingerprint:'theme-test',tbaSubjects:[]}
const assistant={id:'student',label:'Santos, Maria',firstName:'Maria',lastName:'Santos',studentId:'26-1001',fileName:'student.xlsx',events:[{...event,id:'personal',dayCode:'T'}]}
const result={status:'FEASIBLE',diagnostics:[],assignments:[{assistantId:'student',assistantLabel:'Maria Santos',classId:'lesson',day:'F',room:'MT102',courseCode:'CCS 1001',startMinutes:420,endMinutes:600}],optimizedAssistantIds:['student']}
const data={assistants:[assistant],result,settings:{maximumDailyDutyMinutes:480,maximumWeeklyDutyMinutes:1200,minimumGapAfterThreeHourDutyMinutes:0},activeScheduleKey:'theme-test',rostersBySchedule:{'theme-test':[assistant]},resultsBySchedule:{'theme-test':result},unlinkedAssistants:[]}
const checkRemoval=process.argv.includes('--check-assistant-removal')
const checkEdit=process.argv.includes('--check-assistant-edit')
const checkBookingEdit=process.argv.includes('--check-booking-edit')
const checkEventDeletion=process.argv.includes('--check-event-deletion')
const checkArchiveSave=process.argv.includes('--check-archive-save')
if(checkRemoval || checkEdit){
  data.assistants.push({...assistant,id:'other-student',label:'Cruz, Juan',firstName:'Juan',lastName:'Cruz',studentId:'26-1002'})
  data.rostersBySchedule['theme-test']=data.assistants
  result.assignments.push({...result.assignments[0],assistantId:'other-student',assistantLabel:'Juan Cruz',classId:'conflict',courseCode:'CCS 2200',startMinutes:480,endMinutes:540})
  result.optimizedAssistantIds.push('other-student')
}
const fixture={schedule,data,events:[{...event,id:'booking_demo',source:'admin',courseCode:'Department event',date:'2026-10-16',room:'MTCL1',scheduleKey:'theme-test',assistantId:'student',startMinutes:600,endMinutes:660}]}
const inject=`(() => {
  const fixture=${JSON.stringify(fixture)};
  const deletedIds=new Set();
  const archive={schemaVersion:1,id:'00000000-0000-4000-8000-000000000001',name:'Theme preview archive',schoolYear:'2026–2027',semester:'First',createdAt:'2026-10-16T00:00:00Z',schedule:fixture.schedule,adminEvents:fixture.events,assistantData:fixture.data,view:{scheduleDate:'2026-10-16',assistantWeekStart:'2026-10-12',selectedAssistantId:'student',tab:'schedule'}};
  window.electron={flaskUrl:'http://isolated-theme-test'};
  if(!localStorage.getItem('fixture-seeded')) {
    localStorage.setItem('auto-scheduler-imported-schedule',JSON.stringify(fixture.schedule));
    localStorage.setItem('auto-scheduler-student-assistants',JSON.stringify(fixture.data));
    localStorage.setItem('auto-scheduler-selected-date','2026-10-16');
    localStorage.setItem('auto-scheduler-admin-events',JSON.stringify(fixture.events));
    localStorage.setItem('fixture-seeded','yes');
  }
  window.fetch=async (url,init)=>{
    const name=String(url); let value=null;
    if(name.endsWith('/api/schedules/parse'))value={events:[{...fixture.schedule.events[0],dayCode:'F',startMinutes:420,endMinutes:660}],studentId:'26-1001',rooms:['MT102'],times:[],tbaSubjects:[]};
    if(init?.method==='PUT' && name.endsWith('/api/student-assistants/shared')){
      const body=JSON.parse(init.body);
      fixture.data={...fixture.data,...body,result:body.solverResult,resultsBySchedule:body.solverResultsBySchedule,settings:body.schedulingSettings};
      return new Response(JSON.stringify({rosterStorageVersion:1,resultStorageVersion:1}),{status:200});
    }
    if(init?.method==='PUT' && name.includes('/api/admin-events/')){
      const event=JSON.parse(init.body);fixture.events=fixture.events.map(item=>item.id===event.id?event:item);
      return new Response(null,{status:204});
    }
    if(init?.method==='DELETE' && name.includes('/api/admin-events/')){
      const id=decodeURIComponent(name.split('/').pop());deletedIds.add(id);fixture.events=fixture.events.filter(event=>event.id!==id);
      return new Response(JSON.stringify({eventStorageVersion:1}),{status:200});
    }
    if(name.endsWith('/api/schedules/shared'))value={...fixture.schedule,csvEvents:fixture.schedule.events,csvName:fixture.schedule.name};
    if(name.endsWith('/api/student-assistants/shared'))value={...fixture.data,solverResult:fixture.data.result,solverResultsBySchedule:fixture.data.resultsBySchedule,schedulingSettings:fixture.data.settings};
    if(name.endsWith('/api/admin-events'))value=fixture.events;
    if(name.endsWith('/api/admin-events?include_deleted=true'))value={events:fixture.events,deletedIds:[...deletedIds],eventStorageVersion:1};
    if(name.endsWith('/api/archives'))value=[{id:archive.id,archive,deletedAt:null}];
    return new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
  };
})()`
let server
app.whenReady().then(async()=>{
  log('app ready')
  server=createServer((req,res)=>{
    const relative=new URL(req.url,'http://localhost').pathname
    const filename=path.resolve('dist-react',relative==='/'?'index.html':`.${relative}`)
    if(!filename.startsWith(path.resolve('dist-react')+path.sep)){res.writeHead(403).end();return}
    try{
      res.setHeader('Content-Type',filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'text/html')
      res.end(readFileSync(filename))
    }catch{res.writeHead(404).end()}
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  log('server ready')
  const win=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}})
  await win.loadURL('about:blank')
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Page.enable')
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:inject})
  await win.loadURL(`http://127.0.0.1:${server.address().port}`)
  log('page loaded')
  const evaluate=source=>win.webContents.executeJavaScript(source)
  const screenshot=async name=>{
    await new Promise(resolve=>setTimeout(resolve,200))
    writeFileSync(path.join(output,name+'.png'),(await win.webContents.capturePage()).toPNG())
  }
  const waitFor=async source=>{
    for(let n=0;n<80;n++){if(await evaluate(source))return;await new Promise(resolve=>setTimeout(resolve,50))}
    throw Error('Timed out: '+source)
  }
  await waitFor(`Boolean(document.querySelector('.theme-toggle') && document.querySelector('.calendar-event'))`)
  assert.equal(await evaluate(`document.documentElement.dataset.theme`),'dark')
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.time-guide')).borderTopColor`),'rgb(36, 45, 61)')
  await screenshot('dark-schedule')
  await evaluate(`document.querySelector('.theme-toggle').click()`)
  await waitFor(`document.documentElement.dataset.theme==='light'`)
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.app-shell')).backgroundColor`),'rgb(244, 246, 250)')
  assert.equal(await evaluate(`document.querySelector('.theme-toggle').getAttribute('aria-label')`),'Switch to dark mode')
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.time-guide')).borderTopColor`),'rgb(71, 85, 105)')
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.remove-csv-button')).backgroundColor`),'rgb(185, 28, 28)')
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.remove-csv-button')).color`),'rgb(255, 255, 255)')
  await screenshot('light-schedule')
  await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Add Event').click()`)
  await waitFor(`Boolean(document.querySelector('.event-drawer'))`)
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.event-drawer')).backgroundColor`),'rgb(244, 246, 250)')
  await screenshot('light-event-form')
  await evaluate(`document.querySelector('.event-drawer-close').click();document.querySelectorAll('.tab-btn')[1].click()`)
  await waitFor(`!document.querySelector('.event-drawer') && document.querySelectorAll('.tab-btn')[1].classList.contains('active')`)
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.sa-hour-line')).borderTopColor`),'rgb(71, 85, 105)')
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.sa-day-lane')).borderRightColor`),'rgb(51, 65, 85)')
  await screenshot('light-assistants')
  await evaluate(`document.querySelectorAll('.tab-btn')[0].click()`)
  await waitFor(`Boolean(document.querySelector('.schedule-calendar'))`)
  await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Archives').click()`)
  await waitFor(`Boolean(document.querySelector('.archive-list-item'))`)
  await evaluate(`[...document.querySelectorAll('.archive-list-item button')].find(button=>button.textContent.trim()==='View').click()`)
  await waitFor(`Boolean(document.querySelector('.archive-banner'))`)
  await screenshot('light-archive')
  await evaluate(`document.querySelector('.app-shell:not(.is-archive-hidden) .theme-toggle').click()`)
  await waitFor(`document.documentElement.dataset.theme==='dark'`)
  await evaluate(`document.querySelector('.app-shell:not(.is-archive-hidden) .theme-toggle').click()`)
  await waitFor(`document.documentElement.dataset.theme==='light'`)
  win.webContents.reload()
  await waitFor(`Boolean(document.querySelector('.theme-toggle')) && document.documentElement.dataset.theme==='light'`)
  assert.equal(await evaluate(`localStorage.getItem('auto-scheduler-theme')`),'light')
  if(checkEdit){
    await evaluate(`document.querySelectorAll('.tab-btn')[1].click()`)
    await waitFor(`document.querySelectorAll('.tab-btn')[1].classList.contains('active')`)
    await evaluate(`document.querySelector('[aria-label="Open student assistants"]').click()`)
    await waitFor(`Boolean(document.querySelector('[aria-label="Edit Maria Santos"]'))`)
    await evaluate(`document.querySelector('[aria-label="Edit Maria Santos"]').click()`)
    await waitFor(`Boolean(document.querySelector('.sa-profile-form'))`)
    await evaluate(`(() => {
      const input=document.querySelectorAll('.sa-profile-form input')[1];
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Mariana');
      input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`)
    await evaluate(`document.querySelector('.sa-profile-form').requestSubmit()`)
    await waitFor(`!document.querySelector('.sa-profile-form') && JSON.parse(localStorage.getItem('auto-scheduler-student-assistants')).assistants[0].firstName==='Mariana'`)
    let saved=await evaluate(`JSON.parse(localStorage.getItem('auto-scheduler-student-assistants'))`)
    assert.equal(saved.result.assignments.length,2,'Name-only edits must not erase duties')
    assert.equal(saved.result.assignments.find(duty=>duty.assistantId==='student').assistantLabel,'Santos, Mariana')
    let savedEvents=await evaluate(`JSON.parse(localStorage.getItem('auto-scheduler-admin-events'))`)
    assert.equal(savedEvents[0].assistantId,'student')
    assert.equal(savedEvents[0].assistantLabel,'Santos, Mariana')
    const replaceSchedule=async()=>{
      await evaluate(`document.querySelector('[aria-label="Edit Mariana Santos"]').click()`)
      await waitFor(`Boolean(document.querySelector('[aria-label="Remove schedule file"]'))`)
      await evaluate(`document.querySelector('[aria-label="Remove schedule file"]').click()`)
      await waitFor(`Boolean(document.querySelector('.sa-profile-form input[type=file]'))`)
      await evaluate(`(() => {
        const input=document.querySelector('.sa-profile-form input[type=file]');
        const files=new DataTransfer();files.items.add(new File(['Course,Day,Start,End\\nCCS,F,07:00,11:00'],'conflict.csv',{type:'text/csv'}));
        input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));
      })()`)
      await evaluate(`document.querySelector('.sa-profile-form').requestSubmit()`)
      await waitFor(`Boolean(document.querySelector('.sa-edit-conflicts'))`)
    }
    await replaceSchedule()
    assert.equal(await evaluate(`document.querySelectorAll('.sa-edit-conflicts li').length`),2)
    saved=await evaluate(`JSON.parse(localStorage.getItem('auto-scheduler-student-assistants'))`)
    assert.equal(saved.result.assignments.length,2,'Nothing is unassigned before confirmation')
    await evaluate(`[...document.querySelectorAll('.sa-profile-form button')].find(button=>button.textContent==='Cancel').click()`)
    await waitFor(`!document.querySelector('.sa-profile-form')`)
    assert.equal(await evaluate(`JSON.parse(localStorage.getItem('auto-scheduler-student-assistants')).result.assignments.length`),2)
    await replaceSchedule()
    await evaluate(`document.querySelector('.sa-profile-form').requestSubmit()`)
    await waitFor(`!document.querySelector('.sa-profile-form')`)
    saved=await evaluate(`JSON.parse(localStorage.getItem('auto-scheduler-student-assistants'))`)
    assert.equal(saved.result.assignments.length,1)
    assert.equal(saved.result.assignments[0].assistantId,'other-student')
    savedEvents=await evaluate(`JSON.parse(localStorage.getItem('auto-scheduler-admin-events'))`)
    assert.equal(savedEvents.length,1)
    assert.ok(!savedEvents[0].assistantId)
    console.log('Electron edit-assistant workflow passed: name/label preservation, replacement schedule review, cancellation, and targeted confirmed unassignment.')
  }
  if(checkRemoval){
    await evaluate(`document.querySelectorAll('.tab-btn')[1].click()`)
    await waitFor(`document.querySelectorAll('.tab-btn')[1].classList.contains('active')`)
    await evaluate(`document.querySelector('[aria-label="Open student assistants"]').click()`)
    await waitFor(`Boolean(document.querySelector('[aria-label="Delete Maria Santos"]'))`)
    await evaluate(`document.querySelector('[aria-label="Delete Maria Santos"]').click()`)
    await waitFor(`Boolean(document.querySelector('.sa-confirm-delete'))`)
    await evaluate(`document.querySelector('.sa-confirm-delete').click()`)
    await waitFor(`!document.querySelector('.sa-delete-dialog') && JSON.parse(localStorage.getItem('auto-scheduler-student-assistants')).assistants.length===1`)
    const saved=await evaluate(`JSON.parse(localStorage.getItem('auto-scheduler-student-assistants'))`)
    assert.equal(saved.assistants[0].id,'other-student')
    assert.equal(saved.result.assignments.length,1)
    assert.equal(saved.result.assignments[0].assistantId,'other-student')
    assert.equal(saved.result.assignments[0].classId,'conflict')
    const savedEvents=await evaluate(`JSON.parse(localStorage.getItem('auto-scheduler-admin-events'))`)
    assert.ok(savedEvents.every(event=>event.assistantId!=='student'),'Deleted assistant must be unassigned from events, not delete the events')
    assert.equal(savedEvents.length,1)
    assert.ok(await evaluate(`document.querySelector('.sa-selected-heading').textContent.includes('Juan Cruz')`))
    console.log('Electron delete-assistant workflow passed: remaining roster, duties, selection, and event unassignment.')
  }
  if(checkBookingEdit){
    await evaluate(`document.querySelectorAll('.tab-btn')[0].click()`)
    const openEditor=async()=>{
      await waitFor(`Boolean([...document.querySelectorAll('.calendar-event')].find(card=>card.textContent.includes('Department event')))`)
      await evaluate(`[...document.querySelectorAll('.calendar-event')].find(card=>card.textContent.includes('Department event')).click()`)
      await waitFor(`Boolean([...document.querySelectorAll('.calendar-event-dialog-actions button')].find(button=>button.textContent==='Edit'))`)
      await evaluate(`[...document.querySelectorAll('.calendar-event-dialog-actions button')].find(button=>button.textContent==='Edit').click()`)
      await waitFor(`Boolean(document.querySelector('.focused-event-editor'))`)
    }
    await openEditor()
    await evaluate(`(() => {const input=document.querySelector('.focused-event-editor textarea:not(:disabled)');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Updated description');input.dispatchEvent(new Event('input',{bubbles:true}));})()`)
    await evaluate(`document.querySelector('.focused-event-editor form').requestSubmit()`)
    await waitFor(`!document.querySelector('.focused-event-editor')`)
    let saved=await evaluate(`JSON.parse(localStorage.getItem('auto-scheduler-admin-events'))`)
    assert.equal(saved[0].id,'booking_demo')
    assert.equal(saved[0].assistantId,'student')
    assert.equal(saved[0].description,'Updated description')
    await openEditor()
    await evaluate(`(() => {const input=document.querySelector('.focused-event-editor input[type=date]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'2026-10-20');input.dispatchEvent(new Event('input',{bubbles:true}));window.confirm=message=>{window.lastAssignmentWarning=message;return false;};})()`)
    await evaluate(`(() => {const inputs=document.querySelectorAll('.focused-event-editor input[type=time]');['08:00','09:00'].forEach((value,index)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(inputs[index],value);inputs[index].dispatchEvent(new Event('input',{bubbles:true}));});})()`)
    await evaluate(`document.querySelector('.focused-event-editor form').requestSubmit()`)
    await waitFor(`Boolean(window.lastAssignmentWarning)`)
    assert.ok(await evaluate(`window.lastAssignmentWarning.includes('Department event')`))
    assert.ok(await evaluate(`Boolean(document.querySelector('.focused-event-editor'))`),'Cancel keeps the editor open')
    saved=await evaluate(`JSON.parse(localStorage.getItem('auto-scheduler-admin-events'))`)
    assert.equal(saved[0].date,'2026-10-16','Cancel must not change the saved event')
    assert.equal(saved[0].assistantId,'student')
    await evaluate(`window.confirm=()=>true;document.querySelector('.focused-event-editor form').requestSubmit()`)
    await waitFor(`!document.querySelector('.focused-event-editor')`)
    saved=await evaluate(`JSON.parse(localStorage.getItem('auto-scheduler-admin-events'))`)
    assert.equal(saved[0].id,'booking_demo')
    assert.equal(saved[0].date,'2026-10-20')
    assert.ok(!saved[0].assistantId)
    console.log('Electron booking edit workflow passed: description/assignment preservation, conflict confirmation, cancellation, and confirmed unassignment.')
  }
  if(checkEventDeletion){
    await evaluate(`document.querySelectorAll('.tab-btn')[0].click()`)
    await waitFor(`Boolean([...document.querySelectorAll('.calendar-event')].find(card=>card.textContent.includes('Department event')))`)
    await evaluate(`[...document.querySelectorAll('.calendar-event')].find(card=>card.textContent.includes('Department event')).click()`)
    await waitFor(`Boolean(document.querySelector('.calendar-event-dialog-actions .btn-danger'))`)
    await evaluate(`document.querySelector('.calendar-event-dialog-actions .btn-danger').click()`)
    await waitFor(`document.querySelector('.calendar-event-dialog')?.textContent.includes('Delete this card')`)
    await evaluate(`document.querySelector('.calendar-event-dialog-actions .btn-danger').click()`)
    await waitFor(`!document.querySelector('.calendar-event-dialog') && !localStorage.getItem('auto-scheduler-pending-admin-sync')`)
    assert.equal(await evaluate(`[...document.querySelectorAll('.calendar-event')].some(card=>card.textContent.includes('Department event'))`),false)
    assert.ok(await evaluate(`JSON.parse(localStorage.getItem('auto-scheduler-deleted-admin-events')).includes('booking_demo')`))
    assert.deepEqual(await evaluate(`JSON.parse(localStorage.getItem('auto-scheduler-admin-events'))`),[])
    assert.ok(await evaluate(`Boolean(document.querySelector('.calendar-event'))`),'Regular classes remain visible')
    console.log('Electron event deletion workflow passed: card removal, dialog close, durable deleted ID, and successful queue acknowledgement.')
  }
  if(checkArchiveSave){
    await evaluate(`document.querySelectorAll('.tab-btn')[0].click()`)
    await evaluate(`(() => {
      const originalFetch=window.fetch;window.archiveNetworkHeld=true;
      window.fetch=async(url,init)=>{
        if(String(url).includes('/api/archives')){
          if(window.archiveNetworkHeld){window.archiveRequestHeld=true;await new Promise(resolve=>{window.releaseArchiveNetwork=resolve;});}
          if(init?.method==='PUT' && JSON.parse(init.body).name==='Fast local archive')return new Response(JSON.stringify({error:'An archive with this name already exists. Choose a different name.'}),{status:409});
        }
        return originalFetch(url,init);
      };
    })()`)
    const openArchives=async()=>{
      await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Archives').click()`)
      await waitFor(`Boolean(document.querySelector('.archive-dialog'))`)
    }
    await openArchives()
    await waitFor(`window.archiveRequestHeld===true`)
    await evaluate(`[...document.querySelectorAll('.archive-dialog button')].find(button=>button.textContent==='Save Current Schedule').click()`)
    await waitFor(`Boolean(document.querySelector('.archive-save-form'))`)
    await evaluate(`(() => {
      const inputs=document.querySelectorAll('.archive-save-form input');
      ['Fast local archive','2026-2027'].forEach((value,index)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(inputs[index],value);inputs[index].dispatchEvent(new Event('input',{bubbles:true}));});
      const select=document.querySelector('.archive-save-form select');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'First Semester');select.dispatchEvent(new Event('change',{bubbles:true}));
    })()`)
    await evaluate(`document.querySelector('.archive-save-form').requestSubmit()`)
    await waitFor(`!document.querySelector('.archive-dialog') && JSON.parse(localStorage.getItem('auto-scheduler-imported-schedule')).name===''`)
    assert.equal(await evaluate(`window.archiveNetworkHeld`),true,'Local save must finish before the cloud request is released')
    await openArchives()
    await waitFor(`Boolean([...document.querySelectorAll('.archive-list-item')].find(row=>row.textContent.includes('Fast local archive')))`)
    assert.ok(await evaluate(`[...document.querySelectorAll('.archive-list-item')].find(row=>row.textContent.includes('Fast local archive')).textContent.includes('Sync pending')`))
    await evaluate(`document.querySelector('[aria-label="Close archives"]').click();window.archiveNetworkHeld=false;window.releaseArchiveNetwork()`)
    await new Promise(resolve=>setTimeout(resolve,100))
    await openArchives()
    await waitFor(`Boolean([...document.querySelectorAll('.archive-list-item')].find(row=>row.textContent.includes('Fast local archive') && row.textContent.includes('Rename')))`)
    await screenshot('archive-name-conflict')
    await evaluate(`[...document.querySelectorAll('.archive-list-item')].find(row=>row.textContent.includes('Fast local archive')).querySelectorAll('button')[1].click()`)
    await waitFor(`document.querySelector('.archive-save-form h3')?.textContent==='Rename archive'`)
    await evaluate(`(() => {const input=document.querySelector('.archive-save-form input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Renamed local archive');input.dispatchEvent(new Event('input',{bubbles:true}));})()`)
    await evaluate(`document.querySelector('.archive-save-form').requestSubmit()`)
    await waitFor(`!document.querySelector('.archive-save-form') && [...document.querySelectorAll('.archive-list-item')].some(row=>row.textContent.includes('Renamed local archive') && row.textContent.includes('Synced'))`)
    await evaluate(`[...document.querySelectorAll('.archive-list-item')].find(row=>row.textContent.includes('Renamed local archive')).querySelector('button').click()`)
    await waitFor(`Boolean(document.querySelector('.archive-banner'))`)
    assert.ok(await evaluate(`document.querySelector('.archive-banner').textContent.includes('Renamed local archive')`))
    assert.ok(await evaluate(`Boolean(document.querySelector('.app-shell:not(.is-archive-hidden) .calendar-event'))`),'The renamed archive retains the saved schedule')
    console.log('Electron archive workflow passed: local save/close while cloud is blocked, name-conflict display, rename/retry, and preserved preview.')
  }
  console.log('Electron theme smoke checks passed. Screenshots: '+output)
  win.destroy();server.close();app.exit(0)
}).catch(error=>{log(error.stack);console.error(error);server?.close();app.exit(1)})
