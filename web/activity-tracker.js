/* Active foreground use; no keystrokes, text or clipboard content are collected. */
(() => {
  const idleMs=60000, key='glosa-active-time-pending';
  let queue=[],lastInput=0,cursor=Date.now(),prior=null,sending=false;
  const sessionId=crypto.randomUUID(),deviceId='activity-browser';
  try { queue=JSON.parse(sessionStorage.getItem(key)||'[]'); } catch (_) {}
  const persist=()=>{try{sessionStorage.setItem(key,JSON.stringify(queue));}catch(_){}};
  function context(){
    if(document.hidden||!document.hasFocus()||document.querySelector('#home-dialog[open]'))return null;
    return window.GlosaActivityContext?.()||null;
  }
  async function send(){
    if(sending||!queue.length)return;sending=true;
    try {
      while(queue.length){const roomId=queue[0].roomId,batch=queue.filter(s=>s.roomId===roomId).slice(0,25);
        const response=await fetch('/api/study-segments',{method:'POST',headers:{'Content-Type':'application/json','X-Glosa-Room':roomId},keepalive:true,body:JSON.stringify({segments:batch.map(({roomId,...s})=>s)})});
        if(!response.ok)break;
        const ids=new Set(batch.map(s=>s.id));queue=queue.filter(s=>!ids.has(s.id));persist();
      }
    }catch(_){}finally{sending=false;}
  }
  function checkpoint(){
    const now=Date.now(),end=Math.min(now,lastInput+idleMs);
    // A suspended timer does not prove activity during the missing interval.
    if(prior&&end>cursor&&now-cursor<90000){queue.push({id:crypto.randomUUID(),sessionId,deviceId,tracking:'automatic',mode:'free',plannedSeconds:0,phase:'focus',visible:true,uncertain:false,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,startedAt:new Date(cursor).toISOString(),endedAt:new Date(end).toISOString(),...prior});persist();}
    cursor=now;prior=context();send();
  }
  function input(){const now=Date.now();if(!prior||now-lastInput>idleMs||JSON.stringify(prior)!==JSON.stringify(context()))checkpoint();lastInput=now;}
  for(const event of ['pointerdown','keydown','input','wheel','touchstart'])document.addEventListener(event,input,{passive:true,capture:true});
  for(const event of ['focus','blur','pagehide'])window.addEventListener(event,checkpoint);
  document.addEventListener('visibilitychange',checkpoint);
  window.addEventListener('online',send);
  setInterval(checkpoint,60000);
  send();
})();
