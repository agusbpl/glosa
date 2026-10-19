'use strict';
// Requests carry their room explicitly: two tabs can study different rooms safely.
const GlosaRoom = (() => {
  let id=localStorage.getItem('glosa-active-room')||'primer-trazo';
  const prefix=id==='local'?'':'glosa:'+id+':';
  const storage={getItem:key=>localStorage.getItem(prefix+key),setItem:(key,value)=>localStorage.setItem(prefix+key,value),removeItem:key=>localStorage.removeItem(prefix+key)};
  const originalFetch=window.fetch.bind(window);
  let redirecting=false;
  const url=path=>{
    const target=new URL(path,location.origin);
    if(target.origin===location.origin&&/^\/(api|sources|documents)\//.test(target.pathname))target.searchParams.set('room',id);
    return target.origin===location.origin?target.pathname+target.search+target.hash:target.href;
  };
  // A retired installation keeps no 'local' room: the server marks the response
  // and the client just moves to the room it points at (the tutorial), so stale
  // 'local' selections never render a phantom local card.
  const followRoom=response=>{const next=response.headers.get('X-Glosa-Room-Redirect');if(next&&next!==id&&!redirecting){redirecting=true;localStorage.setItem('glosa-active-room',next);location.reload();}return response;};
  window.fetch=(input,options={})=>{
    const target=new URL(typeof input==='string'?input:input.url,location.origin);
    if(target.origin===location.origin&&/^\/(api|sources|documents)\//.test(target.pathname)){
      const headers=new Headers(options.headers||(input instanceof Request?input.headers:undefined));
      if(!headers.has('X-Glosa-Room'))headers.set('X-Glosa-Room',id);
      options={...options,headers};
    }
    return originalFetch(input,options).then(followRoom);
  };
  async function activate(next){
    // Flush note autosaves and session time in the OLD room before reloading.
    if(typeof ClassNotes!=='undefined')await ClassNotes.flush();
    if(typeof flushTime==='function')await flushTime();
    if(!sessionStorage.getItem('glosa-home-intent'))sessionStorage.setItem('glosa-home-intent',JSON.stringify({roomId:next}));
    localStorage.setItem('glosa-active-room',next);location.hash='';location.reload();
  }
  document.addEventListener('DOMContentLoaded',()=>{
    document.getElementById('rooms-button').addEventListener('click',()=>GlosaHome.show());
    document.querySelectorAll('a[href^="/api/export"]').forEach(a=>a.href=url(a.getAttribute('href')));
  });
  return {id,storage,url,open:()=>GlosaHome.show(),activate};
})();
