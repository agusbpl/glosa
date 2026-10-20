'use strict';
// Only identifiers and viewport offsets are persisted, scoped by GlosaRoom.storage.
window.ViewPosition=(()=>{
  let pending=null,frame=0,observer=null,deadline=null;
  const selectors=['.note-editor','#pdf-scroll','.notes-sidebar','.source-reader'];
  const number=value=>Number.isFinite(value)&&value>=0?value:0;
  const context=()=>({view,course:cid||'',item:view==='notes'?(window.ClassNotes?.currentId()||''):lid||''});
  const key=c=>'view-position:'+JSON.stringify([c.view,c.course,c.item]);
  function read(c=context()){try{return JSON.parse(GlosaRoom.storage.getItem(key(c))||'null');}catch{return null;}}
  function cancel(){if(pending)pending=null;cancelAnimationFrame(frame);observer?.disconnect();observer=null;clearTimeout(deadline);}
  function capture(){
    const c=context();if(c.view==='notes'&&!c.item)return;
    const panes={};for(const selector of selectors){const el=document.querySelector(selector);if(el)panes[selector]={top:number(el.scrollTop),left:number(el.scrollLeft)};}
    // A fast return may happen before layout finishes. Preserve the intended
    // position, but still remember the actual note that was opened.
    const position=pending&&pending.identity===key(c)?{...(pending.position||{top:0,left:0,panes:{}})}:{top:number(scrollY),left:number(scrollX),panes};
    if(c.view==='notes'){position.reader=window.ClassNotes?.readerPosition();try{GlosaRoom.storage.setItem('view-position-active-note',c.item);}catch{}}
    try{GlosaRoom.storage.setItem(key(c),JSON.stringify(position));}catch{}
  }
  function apply(){
    if(!pending)return;const {position,identity}=pending;if(key(context())!==identity){cancel();return;}
    window.scrollTo({top:number(position?.top),left:number(position?.left),behavior:'instant'});
    for(const [selector,p] of Object.entries(position?.panes||{})){const el=document.querySelector(selector);if(el){el.scrollTop=number(p.top);el.scrollLeft=number(p.left);}}
  }
  function restore({fresh=false}={}){
    cancel();pending={position:fresh?null:read(),identity:key(context())};
    // Editors and PDF pages finish laying out after their container mounts.
    const root=document.getElementById('main');observer=new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(apply);});if(root)observer.observe(root);
    frame=requestAnimationFrame(()=>{apply();frame=requestAnimationFrame(apply);});
    deadline=setTimeout(()=>{apply();cancel();},2500);
  }
  function settled(){if(pending){cancelAnimationFrame(frame);frame=requestAnimationFrame(apply);}}
  // An intentional user scroll always wins over a delayed layout restoration.
  for(const event of ['wheel','touchstart','pointerdown','keydown'])window.addEventListener(event,()=>cancel(),{passive:true});
  window.addEventListener('pagehide',capture);
  return {capture,restore,cancel,settled,read,activeNote:()=>GlosaRoom.storage.getItem('view-position-active-note')};
})();
