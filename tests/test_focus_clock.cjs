const {createClock}=require('../web/focus-clock.js');
const assert=require('node:assert/strict');
function fixture(){
 let time=Date.parse('2026-10-19T20:00:00Z'),serial=0,tail=Promise.resolve(),offline=false;
 const values=new Map(),events=new Map(),batches=[];
 const ctx={roomId:'one',courseId:'course',lessonId:'first',courseVersion:'1',noteId:'',view:'study',title:'Tema'};
 const options={storage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)},now:()=>time,uuid:()=>`id-${++serial}`,
   context:()=>({...ctx}),visible:()=>true,timezone:()=> 'America/Argentina/Buenos_Aires',
   lock:fn=>{const next=tail.then(fn);tail=next.catch(()=>{});return next;},
   send:async(room,body)=>{batches.push(body);if(offline)throw Error('offline');for(const e of [...body.segments,...body.sessions]){if(events.has(e.id))assert.deepEqual(events.get(e.id),e);events.set(e.id,e);}}};
 return {clock:createClock(options),options,ctx,events,batches,advance:n=>{time+=n*1000;},offline:v=>{offline=v;},segments:()=>[...events.values()].filter(e=>e.startedAt)};
}
const config={mode:'pomodoro',focusSeconds:60,breakSeconds:60,goal:'Comprender'};
(async()=>{
 {const f=fixture();await f.clock.start(config);f.advance(20);await f.clock.tick();await f.clock.pause();f.advance(10);await f.clock.resume();f.advance(40);await f.clock.tick();await f.clock.flush();
  assert.equal(f.clock.snapshot().session.status,'ready');assert.equal(f.clock.snapshot().remainingSeconds,0);
  assert.equal(f.segments().filter(e=>e.phase==='focus').reduce((s,e)=>s+(Date.parse(e.endedAt)-Date.parse(e.startedAt))/1000,0),60);
  assert.equal(f.segments().filter(e=>e.phase==='pause').length,1);
  await f.clock.transition('break');f.advance(30);await f.clock.flush();assert.equal(f.clock.snapshot().remainingSeconds,30);assert(f.segments().some(e=>e.phase==='break'));
  await f.clock.finish({rating:'okay'});assert.equal(f.clock.snapshot().session,null);assert([...f.events.values()].some(e=>e.action==='finish'&&e.rating==='okay'));
 }
 {const f=fixture();await f.clock.start({...config,mode:'free'});f.advance(20);await f.clock.flush();const restored=createClock(f.options);f.advance(10);await restored.visibilityChanged();await restored.flush();
  assert.equal(restored.snapshot().elapsedSeconds,30);assert.equal(f.segments().reduce((s,e)=>s+(Date.parse(e.endedAt)-Date.parse(e.startedAt))/1000,0),30);
  // Simultaneous tabs share one cursor; an old tab cannot append another copy.
  f.advance(20);await Promise.all([f.clock.tick(),restored.tick(),f.clock.flush(),restored.flush()]);
  assert.equal(f.segments().reduce((s,e)=>s+(Date.parse(e.endedAt)-Date.parse(e.startedAt))/1000,0),50);
 }
 {const f=fixture();await f.clock.start({...config,mode:'free'});f.advance(20);f.ctx.lessonId='second';f.ctx.view='notes';f.ctx.noteId='note';await f.clock.contextChanged();f.advance(15);await f.clock.flush();
  assert(f.segments().some(e=>e.lessonId==='first'&&e.view==='study'));assert(f.segments().some(e=>e.noteId==='note'&&e.view==='notes'));
  f.ctx.roomId='two';await f.clock.contextChanged();f.advance(10);await f.clock.flush();assert(f.segments().some(e=>e.roomId==='two'));
 }
 {const f=fixture();await f.clock.start({...config,mode:'free'});f.advance(10);f.options.visible=()=>false;await f.clock.visibilityChanged();f.advance(15);await f.clock.tick();f.options.visible=()=>true;await f.clock.visibilityChanged();
  assert.equal(f.clock.snapshot().elapsedSeconds,25);assert(f.segments().some(e=>e.visible===false));assert(f.segments().some(e=>e.visible===true));
 }
 {const f=fixture();await f.clock.start(config);f.offline(true);f.advance(20);await f.clock.flush();const pending=f.clock.snapshot().pendingCount;assert(pending>0);const ids=JSON.parse(f.options.storage.getItem('glosa-focus-v1')).queue.map(e=>e.value.id);f.offline(false);await f.clock.sync();
  assert.equal(f.clock.snapshot().pendingCount,0);ids.forEach(id=>assert(f.events.has(id)));const n=f.events.size;await f.clock.sync();assert.equal(f.events.size,n);
 }
 {const f=fixture();await f.clock.start(config);f.advance(10);await f.clock.tick();f.advance(600);await f.clock.tick();assert(f.clock.snapshot().uncertain);assert.equal(f.clock.snapshot().session.status,'paused');
  await f.clock.resolveGap({count:true});assert.equal(f.clock.snapshot().session.status,'ready');assert(f.segments().some(e=>e.uncertain&&e.phase==='focus'));
  assert.equal(f.segments().filter(e=>e.phase==='focus').reduce((s,e)=>s+(Date.parse(e.endedAt)-Date.parse(e.startedAt))/1000,0),60);
 }
 {const f=fixture();await f.clock.start(config);f.advance(600);await f.clock.tick();await f.clock.resolveGap({count:false});assert.equal(f.clock.snapshot().elapsedSeconds,0);assert(f.segments().some(e=>e.phase==='pause'));await f.clock.resume();f.advance(-60);await f.clock.tick();assert(f.clock.snapshot().uncertain);}
 console.log('OK: deadline, pause/break, reload, concurrent tabs, context segmentation, offline queue, absence review and clock changes.');
})().catch(e=>{console.error(e);process.exitCode=1;});
