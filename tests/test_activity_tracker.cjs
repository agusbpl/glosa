const vm=require('vm'),fs=require('fs'),assert=require('assert/strict');
(async()=>{
 let time=Date.parse('2026-10-19T15:00:00Z'),tick,focused=true,hidden=false,seq=0,view='study',home=false;
 const listeners={},sent=[],store=new Map();
 class ClockDate extends Date{constructor(...args){super(...(args.length?args:[time]));}static now(){return time;}}
 const doc={get hidden(){return hidden;},hasFocus:()=>focused,querySelector:()=>home?{}:null,addEventListener:(n,fn)=>listeners[n]=fn};
 const context={Date:ClockDate,Intl,JSON,crypto:{randomUUID:()=>String(++seq)},document:doc,sessionStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},setInterval:fn=>tick=fn,
  fetch:async(url,options)=>{sent.push(JSON.parse(options.body));return{ok:true};}};
 context.window={addEventListener:(n,fn)=>listeners[n]=fn,GlosaActivityContext:()=>({roomId:'r',courseId:'c',lessonId:'l',view,noteId:view==='notes'?'n':''})};
 vm.runInNewContext(fs.readFileSync(require('path').join(__dirname,'../web/activity-tracker.js'),'utf8'),context);
 const settle=()=>new Promise(r=>setImmediate(r)),segments=()=>sent.flatMap(b=>b.segments),seconds=()=>segments().reduce((s,v)=>s+(Date.parse(v.endedAt)-Date.parse(v.startedAt))/1000,0);
 listeners.keydown();for(let i=0;i<10;i++){time+=1000;listeners.input();}assert.equal(sent.length,0,'typing is not logged per keystroke');
 time+=50000;tick();await settle();assert.equal(seconds(),60);
 time+=60000;tick();await settle();assert.equal(seconds(),70,'idle stops one minute after last input');
 time+=60000;tick();await settle();assert.equal(seconds(),70);
 view='notes';listeners.input();time+=10000;hidden=true;listeners.visibilitychange();await settle();assert.equal(seconds(),80);assert.equal(segments().at(-1).noteId,'n');
 time+=60000;tick();await settle();assert.equal(seconds(),80,'hidden tabs do not accrue time');
 hidden=false;home=true;listeners.input();time+=60000;tick();await settle();assert.equal(seconds(),80,'Margen is not study time');
 home=false;listeners.input();time+=180000;tick();await settle();assert.equal(seconds(),80,'suspended timers do not fill missing time');
 assert(segments().every(s=>s.tracking==='automatic'&&s.visible&&!s.uncertain));
 assert(!JSON.stringify(sent).includes('content'));
 console.log('PASS: active typing/reading, idle cutoff, notes context, hidden/home/suspension exclusions');
})().catch(e=>{console.error(e);process.exitCode=1;});
