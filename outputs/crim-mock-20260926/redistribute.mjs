import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {FileBlob, SpreadsheetFile} from '@oai/artifact-tool';
const out = new URL('./', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const wb = await SpreadsheetFile.importXlsx(await FileBlob.load(`${out}CRIM_Mock_Schedule_249_Classes.xlsx`));
const sheet = wb.worksheets.getItemAt(0);
const names = ['Reyes','Santos','Cruz','Garcia','Mendoza','Torres','Ramos','Flores','Navarro','Castro','Dela Cruz','Aquino','Lopez'];
const days = ['M','T','W','Th','F','S'];
const classes = [];
let row = 8;
for (let section = 0; section < 37; section++) {
  row++;
  for (let subject = 0; subject < (section < 27 ? 7 : 6); subject++, row++) {
    const year = section < 10 ? 0 : 1 + Math.floor((section - 10) / 9);
    const faculty = (year * 7 + subject) * 2 + section % 2;
    classes.push({row, section, subject, faculty, duration: subject % 3 === 0 ? 180 : 90});
  }
  row += 2;
}
let seed = 261;
const random = () => {seed = (Math.imul(seed,1664525) + 1013904223) >>> 0;return seed / 4294967296;};
const shuffled = items => items.map(x => [random(),x]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
const patterns = {90:[[0,2],[1,3],[2,4],[0,4],[1,4],[3,5],[0,3],[1,5]],180:[[0],[1],[2],[3],[4],[5]]};
const slots = duration => patterns[duration].flatMap(ds => Array.from({length:25},(_,i)=>420+i*30)
  .filter(start => start + duration <=1140 && !(start <780 && start+duration >720))
  .map(start=>({days:ds,start,end:start+duration})));
let allocated;
for(let attempt=0;attempt<40;attempt++) {
  const bookings=[];
  const sectionBookings=Array.from({length:37},()=>[]);
  const facultyBookings=Array.from({length:56},()=>[]);
  const roomBookings=Array.from({length:18},()=>[]);
  const order=shuffled(classes).sort((a,b)=>b.duration-a.duration);
  for(const item of order) {
    let best=null,score=Infinity;
    for(const slot of shuffled(slots(item.duration))) {
      const people=[sectionBookings[item.section],facultyBookings[item.faculty]];
      if(people.some(list=>slot.days.some(day=>
        list.some(b=>b.days.includes(day)&&slot.start<b.end+15&&slot.end>b.start-15)
        || list.filter(b=>b.days.includes(day)).reduce((n,b)=>n+b.end-b.start,0)+item.duration>360)))continue;
      const room = shuffled(Array.from({length:18},(_,i)=>i))
        .filter(i=>!roomBookings[i].some(b=>b.days.some(d=>slot.days.includes(d))&&slot.start<b.end&&slot.end>b.start))
        .sort((a,b)=>roomBookings[a].length-roomBookings[b].length)[0];
      if(room===undefined)continue;
      const sameDay = sectionBookings[item.section].filter(b=>b.days.some(d=>slot.days.includes(d)));
      const gap = sameDay.reduce((n,b)=>n+Math.max(b.start-slot.end,slot.start-b.end,0),0);
      const candidateScore=random()*5+(slot.start<480?3:0)+(slot.end>1080?3:0)
        + (slot.days.includes(5)?1:0)+gap/180;
      if(candidateScore<score){score=candidateScore;best={...item,...slot,room};}
    }
    if(!best)break;
    bookings.push(best);sectionBookings[item.section].push(best);facultyBookings[item.faculty].push(best);roomBookings[best.room].push(best);
  }
  if(bookings.length===249){allocated=bookings;break;}
  console.log(`Placement attempt ${attempt+1}: ${bookings.length}/249`);
}
assert.ok(allocated,'Could not place all classes');
const clock = min => `${String(Math.floor(min/60)).padStart(2,'0')}${String(min%60).padStart(2,'0')}`;
for(const item of allocated) {
  sheet.getRange(`H${item.row}`).values=[[`${clock(item.start)}-${clock(item.end)}`]];
  sheet.getRange(`L${item.row}`).values=[[item.days.map(d=>days[d]).join('')]];
  sheet.getRange(`O${item.row}`).values=[[`CR${101+item.room}`]];
  sheet.getRange(`R${item.row}`).values=[[`${names[item.faculty%names.length]}, ${String.fromCharCode(65+Math.floor(item.faculty/names.length))}.`]];
}
for(const a of allocated) {
  assert.equal((a.end-a.start)*a.days.length,180);
  assert.ok(!(a.start<780&&a.end>720));
  for(const b of allocated) if(a.row<b.row&&a.days.some(d=>b.days.includes(d))&&a.start<b.end&&a.end>b.start)
    assert.ok(a.room!==b.room&&a.faculty!==b.faculty&&a.section!==b.section);
}
wb.recalculate();
console.log((await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#NUM!',options:{useRegex:true,maxResults:10},maxChars:800})).ndjson);
const preview=await wb.render({sheetName:sheet.name,range:'A1:Y17',scale:1,format:'png'});
await fs.writeFile(`${out}realistic-preview.png`,new Uint8Array(await preview.arrayBuffer()));
await (await SpreadsheetFile.exportXlsx(wb)).save(`${out}CRIM_Realistic_Schedule_249_Classes.xlsx`);
console.log(JSON.stringify({classes:allocated.length,sections:37,rooms:18,teachers:new Set(allocated.map(x=>x.faculty)).size,
  singleMeetings:allocated.filter(x=>x.duration===180).length,
  twiceWeekly:allocated.filter(x=>x.duration===90).length,
  starts:[...new Set(allocated.map(x=>clock(x.start)))].sort(),
  classesPerDay:days.map((day,i)=>[day,allocated.filter(x=>x.days.includes(i)).length])}));
