'use strict';
// One persisted clock per browser origin. Web Locks serialize all read/modify/write operations.
(function(root){
  function createClock(options){
    const storage=options.storage,now=options.now||Date.now,uuid=options.uuid||(()=>crypto.randomUUID());
    const key='glosa-focus-v1',tabId=uuid(),listeners=new Set();
    let error='',syncing=false;
    const read=()=>{const raw=storage.getItem(key);return raw?JSON.parse(raw):{session:null,queue:[]};};
    const write=data=>storage.setItem(key,JSON.stringify(data));
    const context=()=>({...options.context(),visible:options.visible(),timezone:options.timezone()});
    const lock=fn=>options.lock(()=>fn(read()));
    function emit(){const s=snapshot();listeners.forEach(fn=>fn(s));}
    function enqueue(data,type,value,roomId){data.queue.push({type,value,roomId});}
    function segment(data,s,start,end,phase=s.phase,uncertain=false){
      if(end<=start)return;
      if(end-start>86400000){
        for(let at=start;at<end;at+=86400000)segment(data,s,at,Math.min(end,at+86400000),phase,uncertain);
        return;
      }
      enqueue(data,'segments',{id:uuid(),sessionId:s.id,deviceId:s.deviceId,mode:s.mode,plannedSeconds:s.plannedSeconds,goal:s.goal,
        startedAt:new Date(start).toISOString(),endedAt:new Date(end).toISOString(),phase,uncertain,...s.context},s.context.roomId);
    }
    function checkpoint(data,s,time,force=false){
      if(s.status!=='running')return;
      const end=s.mode==='free'&&s.phase==='focus'?time:Math.min(time,s.cursor+Math.max(0,s.plannedSeconds*1000-s.elapsedMs));
      if(end<s.cursor){s.gap={start:s.cursor,end:time,clockChanged:true};s.status='paused';return;}
      if(force||end-s.cursor>=15000||end<time||end-s.cursor+s.elapsedMs>=s.plannedSeconds*1000&&s.mode!=='free'){
        segment(data,s,s.cursor,end);s.elapsedMs+=end-s.cursor;s.cursor=end;
      }
      if(!(s.mode==='free'&&s.phase==='focus')&&s.elapsedMs>=s.plannedSeconds*1000){
        if(s.phase==='focus')s.cycles+=1;
        s.status='ready';
      }
    }
    function advance(data,{claim=false,force=false}={}){
      const s=data.session;if(!s)return;
      const time=now(),ctx=context(),owner=s.owner===tabId;
      if(!owner&&!claim)return;
      if(s.status==='running'&&(time-s.lastSeenAt>120000||time<s.lastSeenAt)){
        checkpoint(data,s,s.lastSeenAt,true);
        if(s.status==='running'){s.gap={start:s.cursor,end:time,clockChanged:time<s.lastSeenAt};s.status='paused';}
      }
      if(claim)s.owner=tabId;
      const changed=JSON.stringify(ctx)!==JSON.stringify(s.context);
      checkpoint(data,s,time,force||changed);
      if(changed&&!s.gap)s.context=ctx;
      s.lastSeenAt=time;
    }
    async function sync(){
      if(syncing)return;syncing=true;
      try{
        for(let n=0;n<5;n++){
          const data=read();if(!data.queue.length)break;
          const roomId=data.queue[0].roomId,batch=data.queue.filter(e=>e.roomId===roomId).slice(0,25);
          const body={segments:batch.filter(e=>e.type==='segments').map(e=>e.value),sessions:batch.filter(e=>e.type==='sessions').map(e=>e.value)};
          await options.send(roomId,body);
          const ids=new Set(batch.map(e=>e.value.id));await lock(latest=>{latest.queue=latest.queue.filter(e=>!ids.has(e.value.id));write(latest);});
        }
        error='';
      }catch(e){error='Hay registros pendientes de guardar. Se reintentará al recuperar la conexión.';}
      finally{syncing=false;emit();}
    }
    async function change(action,{claim=true}={}){
      try{await lock(data=>{advance(data,{claim,force:true});action(data);write(data);});error='';}
      catch(e){error=e.message||'No se pudo guardar la sesión en este navegador.';emit();throw e;}
      emit();await sync();
    }
    function snapshot(){
      try{
        const data=read(),s=data.session;
        let elapsed=s?.elapsedMs||0;
        if(s?.status==='running')elapsed+=Math.max(0,now()-s.cursor);
        if(s&&!(s.mode==='free'&&s.phase==='focus'))elapsed=Math.min(elapsed,s.plannedSeconds*1000);
        return {session:s,elapsedSeconds:elapsed/1000,remainingSeconds:s?Math.max(0,s.plannedSeconds-elapsed/1000):0,pendingCount:data.queue.length,uncertain:!!s?.gap,error};
      }catch(e){return {session:null,elapsedSeconds:0,remainingSeconds:0,pendingCount:0,uncertain:false,error:'El navegador no permite recuperar la sesión.'};}
    }
    function sessionEvent(data,s,action,extra={}){
      enqueue(data,'sessions',{id:uuid(),sessionId:s.id,deviceId:s.deviceId,mode:s.mode,plannedSeconds:s.mode==='free'?0:s.focusSeconds,goal:s.goal,
        timestamp:new Date(now()).toISOString(),courseId:s.context.courseId,lessonId:s.context.lessonId,timezone:s.context.timezone,action,...extra},s.context.roomId);
    }
    const api={context:options.context,snapshot,subscribe(fn){listeners.add(fn);fn(snapshot());return()=>listeners.delete(fn);},
      async start(config){
        if(!['free','pomodoro'].includes(config.mode)||!Number.isFinite(config.focusSeconds)||config.focusSeconds<60||config.focusSeconds>14400||!Number.isFinite(config.breakSeconds)||config.breakSeconds<60||config.breakSeconds>3600)throw Error('Elegí duraciones válidas para foco y descanso.');
        if(typeof config.goal!=='string'||config.goal.length>500)throw Error('El objetivo admite hasta 500 caracteres.');
        await change(data=>{
          if(data.session)throw Error('Ya hay una sesión en curso.');
          let deviceId=storage.getItem('glosa-focus-device');if(!deviceId){deviceId=uuid();storage.setItem('glosa-focus-device',deviceId);}
          const time=now(),s={id:uuid(),deviceId,mode:config.mode,focusSeconds:config.focusSeconds,breakSeconds:config.breakSeconds,goal:config.goal,
            phase:'focus',status:'running',plannedSeconds:config.mode==='free'?0:config.focusSeconds,elapsedMs:0,cursor:time,lastSeenAt:time,owner:tabId,context:context(),cycles:0};
          data.session=s;sessionEvent(data,s,'start');
        });
      },
      pause:()=>change(data=>{const s=data.session;if(s?.status==='running')s.status='paused';}),
      resume:()=>change(data=>{const s=data.session;if(!s||s.status!=='paused')return;if(s.gap)throw Error('Revisá primero el tramo pendiente.');segment(data,s,s.cursor,now(),'pause');s.cursor=now();s.lastSeenAt=now();s.status='running';}),
      transition:phase=>change(data=>{const s=data.session;if(!s)return;if(s.gap)throw Error('Revisá primero el tramo pendiente.');if(!['focus','break'].includes(phase))throw Error('Fase inválida.');
        s.phase=phase;s.plannedSeconds=phase==='focus'?(s.mode==='free'?0:s.focusSeconds):s.breakSeconds;s.elapsedMs=0;s.cursor=now();s.lastSeenAt=now();s.status='running';}),
      finish:(result={})=>change(data=>{const s=data.session;if(!s)return;if(s.gap)throw Error('Revisá el tramo pendiente antes de finalizar.');if(s.status==='paused')segment(data,s,s.cursor,now(),'pause');sessionEvent(data,s,'finish',result);data.session=null;}),
      resolveGap:({count})=>change(data=>{const s=data.session;if(!s?.gap)return;
        const gap=s.gap;if(!gap.clockChanged&&gap.end>gap.start){
          const end=s.mode==='free'&&s.phase==='focus'?gap.end:Math.min(gap.end,gap.start+Math.max(0,s.plannedSeconds*1000-s.elapsedMs));
          segment(data,s,gap.start,end,count?s.phase:'pause',true);
          if(count)s.elapsedMs+=end-gap.start;
        }
        delete s.gap;s.cursor=now();s.lastSeenAt=now();
        if(!(s.mode==='free'&&s.phase==='focus')&&s.elapsedMs>=s.plannedSeconds*1000){s.status='ready';if(s.phase==='focus')s.cycles+=1;}
      }),
      async tick(){
        await lock(data=>{
          const s=data.session;if(!s)return;
          const claim=s.owner!==tabId&&options.visible()&&now()-s.lastSeenAt>8000;
          advance(data,{claim});if(s.owner===tabId)write(data);
        });emit();
      },
      async flush(){await change(()=>{});},
      async visibilityChanged(){await change(()=>{},{claim:options.visible()});},
      async contextChanged(){await change(()=>{},{claim:false});},
      refresh:emit,sync
    };
    return api;
  }
  if(typeof module!=='undefined'&&module.exports)module.exports={createClock};
  else root.FocusClockFactory={createClock};
})(typeof window!=='undefined'?window:globalThis);
