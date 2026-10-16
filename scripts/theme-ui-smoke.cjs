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
const fixture={schedule,data,events:[{...event,id:'booking_demo',source:'admin',courseCode:'Department event',date:'2026-10-16',room:'MTCL1',scheduleKey:'theme-test',assistantId:'student',startMinutes:600,endMinutes:660}]}
const inject=`(() => {
  const fixture=${JSON.stringify(fixture)};
  const archive={schemaVersion:1,id:'00000000-0000-4000-8000-000000000001',name:'Theme preview archive',schoolYear:'2026–2027',semester:'First',createdAt:'2026-10-16T00:00:00Z',schedule:fixture.schedule,adminEvents:fixture.events,assistantData:fixture.data,view:{scheduleDate:'2026-10-16',assistantWeekStart:'2026-10-12',selectedAssistantId:'student',tab:'schedule'}};
  window.electron={flaskUrl:'http://isolated-theme-test'};
  if(!localStorage.getItem('fixture-seeded')) {
    localStorage.setItem('auto-scheduler-imported-schedule',JSON.stringify(fixture.schedule));
    localStorage.setItem('auto-scheduler-student-assistants',JSON.stringify(fixture.data));
    localStorage.setItem('auto-scheduler-selected-date','2026-10-16');
    localStorage.setItem('auto-scheduler-admin-events',JSON.stringify(fixture.events));
    localStorage.setItem('fixture-seeded','yes');
  }
  window.fetch=async url=>{
    const name=String(url); let value=null;
    if(name.endsWith('/api/schedules/shared'))value={...fixture.schedule,csvEvents:fixture.schedule.events,csvName:fixture.schedule.name};
    if(name.endsWith('/api/student-assistants/shared'))value={...fixture.data,solverResult:fixture.data.result,solverResultsBySchedule:fixture.data.resultsBySchedule,schedulingSettings:fixture.data.settings};
    if(name.endsWith('/api/admin-events'))value=fixture.events;
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
  await screenshot('dark-schedule')
  await evaluate(`document.querySelector('.theme-toggle').click()`)
  await waitFor(`document.documentElement.dataset.theme==='light'`)
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.app-shell')).backgroundColor`),'rgb(244, 246, 250)')
  assert.equal(await evaluate(`document.querySelector('.theme-toggle').getAttribute('aria-label')`),'Switch to dark mode')
  await screenshot('light-schedule')
  await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Add Event').click()`)
  await waitFor(`Boolean(document.querySelector('.event-drawer'))`)
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.event-drawer')).backgroundColor`),'rgb(244, 246, 250)')
  await screenshot('light-event-form')
  await evaluate(`document.querySelector('.event-drawer-close').click();document.querySelectorAll('.tab-btn')[1].click()`)
  await waitFor(`!document.querySelector('.event-drawer') && document.querySelectorAll('.tab-btn')[1].classList.contains('active')`)
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
  console.log('Electron theme smoke checks passed. Screenshots: '+output)
  win.destroy();server.close();app.exit(0)
}).catch(error=>{log(error.stack);console.error(error);server?.close();app.exit(1)})
