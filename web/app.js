'use strict';
const $ = id => document.getElementById(id);
const E = (tag, attrs={}, ...children) => {
  const node=document.createElement(tag);
  for(const [k,v] of Object.entries(attrs)) {
    if(k==='class') node.className=v;
    else if(k.startsWith('on')) node.addEventListener(k.slice(2),v);
    else if(k==='text') node.textContent=v;
    else if(v!==undefined) node.setAttribute(k,v);
  }
  for(const child of children.flat()) if(child!==null && child!==undefined) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
};
// SVG compartidos: nombres accesibles y tooltip en cada control.
function actionIcon(name){
  const paths={edit:'M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L9 17l-4 1 1-4Z',trash:'M3 6h18 M9 6V4h6v2 M5 6l1 14h12l1-14 M10 10v6 M14 10v6',tutor:'M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-3 2 2-6a8.5 8.5 0 1 1 18-4.5Z',folder:'M3 7V4h6l2 3h10v13H3Z',download:'M12 3v12 m-5-5 5 5 5-5 M4 16v5h16v-5',link:'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',book:'M12 5C8 3 4 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-2-1-6-1-10 1Z M12 5v15',note:'M5 3h10l4 4v14H5z M15 3v5h4 M8 12h8 M8 16h5 M20 3v4 M18 5h4'};
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  for(const [key,value] of Object.entries({viewBox:'0 0 24 24',width:'18',height:'18',fill:'none',stroke:'currentColor','stroke-width':'1.7','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true',focusable:'false'}))svg.setAttribute(key,value);
  const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[name]);svg.append(path);return svg;
}
function iconAction(label,icon,attrs={}){return E('button',{type:'button',...attrs,class:(attrs.class||'text-button')+' icon-action','aria-label':label,title:label},actionIcon(icon));}
let state, cid=GlosaRoom.storage.getItem('study-course'), lid=GlosaRoom.storage.getItem('study-lesson'), view='study', filter='important', selection=null, noteSelection=null, editingAnnotation=null, busy=false;
let activeStarted=Date.now(), clockLesson=null, timer=null, studying=false;
// Resaltados: paleta compartida con el servidor (server.py HIGHLIGHT_COLORS).
const HIGHLIGHT_COLORS=[['yellow','Amarillo'],['green','Verde'],['blue','Azul'],['pink','Rosa']];
const highlightColor=value=>HIGHLIGHT_COLORS.some(([c])=>c===value)?value:'yellow';
const isHighlight=item=>!!item?.data&&(item.data.type==='highlight'||item.data.highlight===true);
// Actualiza un resaltado en su lugar: quitar o recolorear no debe rehacer toda la
// página (eso perdía la posición de lectura y el foco). Solo se tocan los nodos
// del resaltado afectado, y únicamente si el mismo target sigue visible.
const annotationMarks=id=>[...document.querySelectorAll('mark[data-annotation-id="'+CSS.escape(id)+'"]')];
const notebookItems=id=>[...document.querySelectorAll('.notebook-item[data-annotation-id="'+CSS.escape(id)+'"]')];
// Apariencia: tema y color de acento elegidos por la persona, guardados en este navegador
// (clave global, no por pliego) para que sobrevivan al recargar y valgan en todos los pliegos.
const THEME_MODES=['auto','light','dark','omarchy'], ACCENTS=[['forest','Bosque'],['ocean','Océano'],['violet','Amatista'],['amber','Ámbar'],['graphite','Grafito']];
const appearance=()=>({theme:THEME_MODES.includes(localStorage.getItem('glosa-theme'))?localStorage.getItem('glosa-theme'):'auto',accent:ACCENTS.some(([a])=>a===localStorage.getItem('glosa-accent'))?localStorage.getItem('glosa-accent'):'forest'});
let omarchyPalette=null;
const darkQuery=window.matchMedia?.('(prefers-color-scheme: dark)');
function resolvedTheme(){const {theme}=appearance();return theme==='omarchy'?(omarchyPalette?.mode||(darkQuery?.matches?'dark':'light')):theme==='auto'?(darkQuery?.matches?'dark':'light'):theme;}
function applyAppearance(){
  const {theme,accent}=appearance(),root=document.documentElement;
  root.dataset.theme=resolvedTheme();root.dataset.themeMode=theme;root.dataset.accent=accent;
  root.style.colorScheme=resolvedTheme();
  const palette=theme==='omarchy'&&omarchyPalette?.available?omarchyPalette:null;
  document.body.dataset.omarchy=String(!!palette);
  for(const key of ['--bg','--paper','--ink','--muted','--green','--accent-ink','--accent-solid','--on-accent','--line','--pale','--panel']){
    if(palette)document.body.style.setProperty(key,palette.variables[key]);
    else document.body.style.removeProperty(key);
  }
  const option=document.getElementById('omarchy-theme-option');
  if(option)option.hidden=!omarchyPalette?.available&&theme!=='omarchy';
  const input=option?.querySelector('input');if(input)input.disabled=!omarchyPalette?.available;
  const status=document.getElementById('omarchy-theme-status');
  if(status){status.hidden=theme!=='omarchy';status.textContent=palette?'Sigue los colores de Omarchy de esta instalación. El acento lo define Omarchy.':'La paleta de Omarchy no está disponible. Se usa el tema del sistema hasta que vuelva.';}
  document.querySelectorAll('input[name="accent-color"]').forEach(input=>{input.disabled=!!palette;});
  document.querySelectorAll('input[name="theme-mode"]').forEach(input=>{input.checked=input.value===theme;});
  document.querySelectorAll('input[name="accent-color"]').forEach(input=>{input.checked=input.value===accent;});
}
function setAppearance(change){const next={...appearance(),...change};if(THEME_MODES.includes(next.theme))localStorage.setItem('glosa-theme',next.theme);if(ACCENTS.some(([a])=>a===next.accent))localStorage.setItem('glosa-accent',next.accent);applyAppearance();}
darkQuery?.addEventListener?.('change',()=>{if(appearance().theme==='auto'||(appearance().theme==='omarchy'&&!omarchyPalette?.available))applyAppearance();});
applyAppearance();
async function refreshOmarchyTheme(){
  try{omarchyPalette=await api('/api/appearance/omarchy');applyAppearance();}catch{}
}
refreshOmarchyTheme();
setInterval(()=>{if(!document.hidden)refreshOmarchyTheme();},15000);
window.addEventListener('focus',refreshOmarchyTheme);
// Canal del tutor elegido por la persona: conversación integrada por API o registro
// pendiente para un cliente externo con el MCP de tutor (sin clave ni costo de Glosa).
// Se guarda en este navegador, como el tema, para que sobreviva al recargar.
const TUTOR_CHANNELS=['api','mcp'];
const tutorChannel=()=>TUTOR_CHANNELS.includes(localStorage.getItem('glosa-tutor-channel'))?localStorage.getItem('glosa-tutor-channel'):'api';
function syncTutorChannelUI(){document.querySelectorAll('input[name="tutor-channel"]').forEach(input=>{input.checked=input.value===tutorChannel();});}
function setTutorChannel(value){if(!TUTOR_CHANNELS.includes(value))return;localStorage.setItem('glosa-tutor-channel',value);syncTutorChannelUI();if(state&&typeof renderChat==='function'&&course())renderChat();}
// Refresca la conversación desde el servidor sin recargar la página: conserva los
// borradores locales (en Apuntes se guarda antes) y no reconstruye el editor.
async function refreshTutorConversation(){
  try{
    if(view==='notes')await ClassNotes.flush?.();
    const fresh=await api('/api/state');
    // Se actualizan solo los datos de la conversación: no se reemplaza el apunte
    // activo del editor, para no perder el borrador ni invalidar su revisión.
    state.events=fresh.events;if(state.library)state.library.noteTutor=fresh.library.noteTutor;state.tutorConnected=fresh.tutorConnected;
    if(view==='notes')ClassNotes.refreshTutorHistory?.();else renderChat();
    notify('Conversación actualizada.');
  }catch(error){notify(error.message);}
}
window.GlosaTutorChannel={current:tutorChannel,set:setTutorChannel,refresh:refreshTutorConversation};
const statusLabel={unseen:'Por explorar',pending:'Por comprobar',with_help:'Con ayuda',independent:'Comprobación independiente',self_review:'Revisada por vos'};
const kindLabel={annotation:'Anotación',answer:'Respuesta',chat_message:'Tu mensaje',tutor_reply:'Tutor',assessment:'Evaluación',feedback:'Feedback',study_time:'Tiempo de estudio',visit:'Lectura iniciada',self_review:'Revisión personal',self_review_cancel:'Revisión personal deshecha',annotation_resolved:'Duda marcada como resuelta',course_version:'Cambio de curso',schedule_updated:'Cambio de disponibilidad'};
kindLabel.tutor_note='Apunte del tutor';
kindLabel.continuation_requested='Continuación solicitada';
async function api(path,body) {
  const response=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok) throw new Error(data.error || 'No se completó la operación.');
  return data;
}
async function tutorStream(path,body,onText){
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,stream:true})});
  if(!response.ok){const error=await response.json();throw Error(error.error||'No se completó la consulta.');}
  if(!response.headers.get('Content-Type')?.includes('application/x-ndjson'))return response.json();
  const reader=response.body.getReader(),decoder=new TextDecoder();let pending='',result,finished=false;
  const consume=line=>{
    if(!line.trim())return;
    const event=JSON.parse(line);
    if(event.type==='error')throw Error(event.error);
    if(event.type==='text')onText?.(event.text);
    if(event.type==='done'){result=event.result;finished=true;}
  };
  try{
    while(true){const {value,done}=await reader.read();pending+=decoder.decode(value||new Uint8Array(),{stream:!done});let end;
      while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+1);consume(line);}
      if(done)break;
    }
    if(pending.trim())consume(pending);
    if(!finished)throw Error('La respuesta se interrumpió. Recargá la conversación antes de reintentar.');
    return result;
  }finally{reader.releaseLock();}
}
function notify(message) { $('notice').textContent=message; $('notice').style.display='block';clearTimeout(timer);timer=setTimeout(()=>$('notice').style.display='none',6500); }
function course() { return state.courses.find(c=>c.id===cid); }
function lesson() { return course()?.lessons.find(l=>l.id===lid); }
function records(kind=null,onlyLesson=true) {return state.events.filter(e=>e.courseId===cid && (!onlyLesson || e.lessonId===lid) && (!kind || e.kind===kind));}
function activeReviews(lessonId=lid){
  const version=course().version,events=records(null,false).filter(e=>(e.data.courseVersion||version)===version);
  const cancelled=new Set(events.filter(e=>e.kind==='self_review_cancel').flatMap(e=>Array.isArray(e.data.reviewIds)?e.data.reviewIds:[]));
  return events.filter(e=>e.kind==='self_review'&&e.lessonId===lessonId&&!cancelled.has(e.id));
}
async function undoReview(lessonId=lid){
  const ids=activeReviews(lessonId).map(e=>e.id);if(!ids.length)return;
  await api('/api/event',{id:crypto.randomUUID(),kind:'self_review_cancel',courseId:cid,lessonId,data:{reviewIds:ids,note:'El estudiante deshizo la marca de revisión; no debe contarse como lectura ni comprensión.'}});
  await reload();notify('Marca de revisión quitada.');
}
function dateLabel(iso) {return new Date(iso).toLocaleString('es-AR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});}
async function reload() { state=await api('/api/state');if(!state.courses.length){cid=null;lid=null;}else{if(!course()) cid=state.courses[0].id;if(!lesson()) lid=state.room?.tutorial?course().lessons[0].id:state.recommendations[cid].lessonId;}render(); }
async function saveEvent(kind,data,target={courseId:cid,lessonId:lid},id=crypto.randomUUID()) {
  const item=await api('/api/event',{id,kind,...target,data});if(!state.events.some(e=>e.id===item.id))state.events.push(item);return item;
}
function render() {
  window.WorkspaceKeys?.sync();
  window.FocusClock?.contextChanged().catch(e=>notify(e.message));
  document.title='Glosa · '+(state.room?.title||course()?.title||'Margen');
  $('environment-context').textContent=course()?.title||state.room?.title||'Glosa';
  $('main').classList.toggle('plan-view',view==='plan');
  document.body.classList.toggle('exam-active',view==='study'&&!!lesson()&&isExamLesson(lesson()));
  $('workspace-mode-button').textContent=({study:'ESTUDIAR',notes:'NOTAS',notebook:'CUADERNO',plan:'PLAN'}[view]||'ESTUDIO')+(state.settings.keyboardProfile==='modal'?' · g m':'');
  if(view==='notes'){document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));ClassNotes.render();return;}
  ClassNotes.leave();
  if(!course()){
    $('course-select').replaceChildren();$('lesson-nav').replaceChildren();$('progress').replaceChildren();$('course-description').textContent='';$('note-count').textContent='';
    $('main').replaceChildren(E('span',{class:'eyebrow'},'UN PLIEGO EN BLANCO'),E('h1',{},state.room?.title||'Tu pliego'),E('p',{class:'lede'},'Escribí un apunte o pedile a tu agente que cree un pliego completo desde tu carpeta de materiales. Abrilo desde GLOSA → Margen.'),E('div',{class:'pliego-actions'},E('button',{class:'quiet',onclick:()=>{view='notes';render();}},'Escribir un apunte'),E('button',{class:'quiet',onclick:()=>GlosaRoom.open()},'Abrir Margen'),E('button',{class:'text-button',onclick:()=>GlosaRoom.activate('primer-trazo')},'Volver a Primer trazo')));
    $('tutor-dock').hidden=true;return;
  }
  $('tutor-dock').hidden=false;
  GlosaRoom.storage.setItem('study-course',cid);GlosaRoom.storage.setItem('study-lesson',lid);
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  $('course-select').replaceChildren(...state.courses.map(c=>E('option',{value:c.id},c.title)));$('course-select').value=cid;
  $('course-description').textContent=course().description || '';
  const statuses=state.recommendations[cid].statuses;
  const done=course().lessons.filter(l=>statuses[l.id]==='independent').length;
  $('progress').replaceChildren(E('div',{class:'muted'},`${done} de ${course().lessons.length} lecciones comprobadas`),E('div',{class:'progress-track'},E('div',{class:'progress-fill',style:`width:${Math.round(100*done/course().lessons.length)}%`})));
  const nav=[];let unit='';
  for(const l of course().lessons) {
    if(l.unit!==unit){unit=l.unit;nav.push(E('div',{class:'unit-label'},unit));}
    const status=statuses[l.id];
    nav.push(E('button',{class:'lesson-link'+(l.id===lid?' active':''),'aria-current':l.id===lid?'page':'false',onclick:()=>chooseLesson(l.id)},E('span',{class:'lesson-marker'+(status==='independent'?' done':'')},status==='independent'?'✓':status==='with_help'?'◐':status==='pending'?'·':'○'),l.title));
  }
  $('lesson-nav').replaceChildren(...nav);
  $('note-count').textContent=records('annotation',false).filter(e=>!e.data.removed).length || '';
  if(view==='study') renderStudy();else if(view==='notebook') renderNotebook();else renderPlan();
  renderChat();
}
async function chooseLesson(id) {
  window.ViewPosition?.capture();window.ViewPosition?.cancel();
  await flushTime();window.WorkspaceKeys?.closePanels(false);lid=id;view='study';clockLesson=lid;activeStarted=Date.now();render();
  await saveEvent('visit',{courseVersion:course().version});
  if(window.ViewPosition)ViewPosition.restore({fresh:true});else window.scrollTo({top:0,behavior:'smooth'});
}
function safeSourceUrl(source,page) {const u=source.url || '';return (u.startsWith('/sources/') || /^\/documents\/[A-Za-z0-9_.-]{1,100}$/.test(u) || u.startsWith('https://'))?GlosaRoom.url(u)+(page?`#page=${page}`:''):null;}
function renderStudy() {
  const l=lesson(), recommendation=state.recommendations[cid];
  if(isExamLesson(l)){renderExam(l);return;}
  const days=Math.max(0,Math.round((Date.parse(state.settings.examDate)-Date.parse(state.localDate))/86400000));
  const nodes=[E('div',{class:'lesson-meta'},E('span',{class:'eyebrow'},l.unit)),E('h1',{},l.title),E('p',{class:'lede'},l.intro),E('details',{class:'reading-details'},E('summary',{},`${days} min de lectura · Recorrido y fuentes`),E('p',{class:'muted'},`${days} días hasta el parcial. `+(l.id===recommendation.lessonId?recommendation.reason:`La recomendación actual es «${course().lessons.find(x=>x.id===recommendation.lessonId)?.title}».`)),E('p',{class:'muted'},'Seleccioná texto para resaltarlo; al hacer clic en el resaltado podés generar una nota. Desde el teclado, v selecciona y a anota. Las fuentes figuran debajo de cada bloque.'))];
  if(state.room?.tutorial){
    nodes[4]=E('details',{class:'reading-details'},E('summary',{},`${l.minutes} min · Probá a tu ritmo`),E('p',{class:'muted'},'Tus prácticas del tutorial quedan separadas de los pliegos. No hay un examen asociado a esta guía.'));
    nodes.push(E('div',{class:'pliego-actions'},E('button',{class:'text-button',onclick:()=>GlosaRoom.open()},'Abrir Margen'),E('button',{class:'text-button',onclick:()=>$('workspace-mode-button').click()},'Explorar modos · g m')));
  }
  if(l.warning) nodes.push(E('div',{class:'source-warning'},l.warning));
  function theorySection(b) {
    const text=E('div',{class:'theory','data-block-id':b.id,tabindex:0,'aria-label':b.title||'Bloque de teoría'});
    const annotations=records('annotation').filter(a=>a.data.blockId===b.id && a.data.courseVersion===course().version);
    highlight(text,b.text,annotations);
    const section=E('section',{class:'theory-section'},E('h2',{},b.title),text);
    if(b.references?.length) {
      const links=b.references.map(ref=>{const s=course().sources.find(x=>x.id===ref.sourceId);const url=s&&safeSourceUrl(s,ref.page);return url?E('a',{href:url,target:'_blank',rel:'noopener'},`${s.title.replace('.pdf','')} · pág. PDF ${ref.page} ↗`):null;});
      section.append(E('div',{class:'source-list'},...links));
    }
    for(const a of annotations.filter(a=>!a.data.removed&&a.data.comment?.trim())) section.append(E('div',{class:'note-inline','data-note-annotation-id':a.id},a.data.comment,E('div',{class:'muted'},a.data.shareWithTutor?'Compartida con el tutor':'Nota personal · fuera del contexto del tutor'),annotationActions(a)));
    for(const visual of (l.visuals||[]).filter(v=>v.blockId===b.id)) section.append(LearningVisuals.render(visual));
    return section;
  }
  const extras=[];
  for(const visual of (l.visuals||[]).filter(v=>!v.blockId)) extras.push(LearningVisuals.render(visual));
  if(l.interactive) extras.push(InteractivePractice.render(l.interactive,course(),l));
  if(l.simulation) extras.push(renderSimulation(l.simulation));
  for(const r of l.resources || []) {
    const resource=E('section',{},E('h2',{},r.title),E('p',{class:'muted'},r.task));
    if(r.kind==='video')resource.append(E('video',{src:r.src+(r.startSeconds?`#t=${r.startSeconds}`:''),class:'video-frame',controls:'',preload:'metadata',poster:r.src==='/media/glosa-demo.mp4'?'/media/glosa-demo-poster.jpg':undefined,'aria-label':r.title,playsinline:''}));
    else{
      const src=`https://www.youtube-nocookie.com/embed/${encodeURIComponent(r.videoId)}?start=${Math.max(0,r.startSeconds||0)}`;
      // YouTube requires a Referer; override no-referrer only for this embed, sending the origin.
      resource.append(E('iframe',{src,class:'video-frame',title:r.title,allow:'fullscreen',loading:'lazy',referrerpolicy:'strict-origin-when-cross-origin'}));
    }
    extras.push(resource);
  }
  const parts=l.sequence?l.sequence.map(part=>part.type==='block'?{node:theorySection(l.blocks.find(b=>b.id===part.id))}:{exercise:l.exercises.find(ex=>ex.id===part.id)}):[...l.blocks.map(b=>({node:theorySection(b)})),...extras.map(node=>({node})),...l.exercises.map(ex=>({exercise:ex}))];
  let group=[];
  const flush=()=>{if(!group.length)return;nodes.push(renderExerciseGroup(group));group=[];};
  for(const part of parts){if(part.exercise)group.push(part.exercise);else{flush();nodes.push(part.node);}}
  flush();if(l.sequence)nodes.push(...extras);
  const idx=course().lessons.findIndex(x=>x.id===lid);
  const reviewed=activeReviews().length>0;
  const target={courseId:cid,lessonId:lid},version=course().version,nextLesson=course().lessons[idx+1];
  nodes.push(E('footer',{class:'lesson-footer'},E('button',{class:'primary',onclick:async e=>{
    const button=e.currentTarget;button.disabled=true;
    try{
      if(!reviewed)await saveEvent('self_review',{courseVersion:version,note:'El estudiante siguió estudiando; registra revisión personal, no comprensión independiente.'},target);
      if(cid!==target.courseId||lid!==target.lessonId||view!=='study')return;
      await reload();
      if(cid!==target.courseId||lid!==target.lessonId||view!=='study')return;
      if(nextLesson)await chooseLesson(nextLesson.id);else{view='plan';render();}
    }catch(err){notify(err.message);}finally{button.disabled=false;}
  }},nextLesson?'Seguir estudiando →':'Ver pendientes →')));
  const applied=new Set(records('continuation_applied',false).map(e=>e.data.requestId));
  const pending=records('continuation_requested').some(e=>e.data.courseVersion===course().version&&!applied.has(e.id));
  nodes.push(E('details',{class:'continuation-handoff'},E('summary',{},pending?'Continuación solicitada':'Pedir continuación'),E('p',{class:'muted'},'El agente puede preparar un refuerzo con tus respuestas y dudas cuando retomes el trabajo con él.'),E('button',{class:'text-button',disabled:pending?'disabled':undefined,onclick:async e=>{e.target.disabled=true;try{await saveEvent('continuation_requested',{});renderStudy();notify('Solicitud guardada. Retomá con tu agente para preparar la continuación.');}catch(err){e.target.disabled=false;notify(err.message);}}},pending?'Continuación pendiente del agente':'Preparar continuación')));
  $('main').replaceChildren(...nodes);
}
const nativeNotePattern=()=>/\[([^\]]+)\]\(#note=([A-Za-z0-9_.-]{1,100})\)/g;
function visibleReadingText(text) { return (text||'').replace(nativeNotePattern(),'$1'); }
function nativeNoteAnchor(target){
  const anchor=target.closest?.('a[href]');if(!anchor)return null;
  try{const url=new URL(anchor.href,location.href);return url.origin===location.origin&&url.pathname===location.pathname&&/^#note=[A-Za-z0-9_.-]{1,100}$/.test(url.hash)?anchor:null;}catch{return null;}
}
const NativeNotePreview=(()=>{
  let panel=null,anchor=null,showTimer=null,hideTimer=null;
  function close(){clearTimeout(showTimer);clearTimeout(hideTimer);anchor?.removeAttribute('aria-describedby');panel?.remove();panel=null;anchor=null;}
  function keep(){clearTimeout(hideTimer);}
  function later(){clearTimeout(showTimer);clearTimeout(hideTimer);hideTimer=setTimeout(close,180);}
  function show(next){
    if(!next.isConnected||getSelection()?.toString()||document.querySelector('dialog[open]'))return;
    const id=new URL(next.href).hash.slice(6),note=state.library.notes.find(n=>n.id===id&&!n.deletedAt);if(!note)return;
    close();anchor=next;
    const body=E('div',{class:'native-note-preview-body note-markdown'});
    body.append(NoteMarkdown.render(note.content||'Este apunte todavía no tiene contenido.'));
    panel=E('aside',{id:'native-note-preview',class:'native-note-preview',role:'dialog','aria-label':'Vista previa: '+note.title},
      E('header',{},E('strong',{},note.title),E('a',{href:'#note='+id},'Abrir nota'),iconAction('Quitar enlace del texto','link',{onclick:()=>{close();showNoteLinkActions(next,id);}})),body);
    panel.addEventListener('pointerenter',keep);panel.addEventListener('pointerleave',later);
    panel.addEventListener('focusin',keep);panel.addEventListener('focusout',event=>{if(!panel?.contains(event.relatedTarget))later();});
    document.body.append(panel);anchor.setAttribute('aria-describedby',panel.id);
    const rect=anchor.getBoundingClientRect(),box=panel.getBoundingClientRect(),gap=6;
    const top=rect.bottom+gap+box.height<=innerHeight-8?rect.bottom+gap:Math.max(8,rect.top-gap-box.height);
    panel.style.left=Math.max(8,Math.min(rect.left,innerWidth-box.width-8))+'px';panel.style.top=top+'px';
  }
  function schedule(next){keep();clearTimeout(showTimer);if(anchor===next&&panel)return;showTimer=setTimeout(()=>show(next),300);}
  document.addEventListener('pointerover',event=>{if(event.pointerType==='touch'||event.buttons)return;const next=nativeNoteAnchor(event.target);if(next&&!next.closest('.native-note-preview'))schedule(next);});
  document.addEventListener('pointerout',event=>{const next=nativeNoteAnchor(event.target);if(next&&!next.contains(event.relatedTarget)&&!panel?.contains(event.relatedTarget))later();});
  document.addEventListener('focusin',event=>{const next=nativeNoteAnchor(event.target);if(next&&!next.closest('.native-note-preview'))schedule(next);});
  document.addEventListener('focusout',event=>{if(nativeNoteAnchor(event.target)&&!panel?.contains(event.relatedTarget))later();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')close();});
  document.addEventListener('pointerdown',event=>{if(!panel?.contains(event.target))close();});
  window.addEventListener('scroll',event=>{if(!panel?.contains(event.target))close();},true);
  window.addEventListener('resize',close);
  return {close};
})();
document.addEventListener('click',async event=>{
  const anchor=nativeNoteAnchor(event.target);if(!anchor)return;
  event.preventDefault();
  NativeNotePreview.close();
  const id=new URL(anchor.href).hash.slice(6);
  if(!state.library.notes.some(n=>n.id===id&&!n.deletedAt)){showNoteLinkActions(anchor,id);return;}
  try{await WorkspaceKeys.go('notes');await ClassNotes.select(id);}catch(error){notify(error.message);}
});
function showNoteLinkActions(anchor,id){
  const blockId=anchor.closest('.theory')?.dataset.blockId;
  if(view!=='study'||!blockId){notify('No se encontró el apunte.');return;}
  const target={courseId:cid,lessonId:lid,version:course().version,blockId,noteId:id};
  const message=E('p',{},'Podés quitar el enlace y conservar el término como texto. La nota, si existe, permanece en Notas.');
  const dialog=E('dialog',{'aria-label':'Enlace a nota',class:'note-link-dialog'},E('h2',{},'Enlace a nota'),message,
    E('div',{class:'dialog-actions'},E('button',{type:'button',class:'quiet',onclick:()=>dialog.close()},'Cancelar'),E('button',{type:'button',class:'primary',onclick:async e=>{
      e.currentTarget.disabled=true;
      try{await api('/api/note-link/remove',target);state=await api('/api/state');dialog.close();render();notify('Enlace quitado. El texto se conserva.');}
      catch(error){message.textContent=error.message;e.currentTarget.disabled=false;}
    }},'Quitar enlace')));
  dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
}
function highlight(node,text,annotations) {
  const spans=[];
  for(const a of annotations){const d=a.data;if(d.removed)continue;if(Number.isInteger(d.start)&&Number.isInteger(d.end)&&d.end>d.start&&text.slice(d.start,d.end)===d.quote)spans.push({start:d.start,end:d.end,item:a});}
  const links=[...text.matchAll(nativeNotePattern())].map(m=>({start:m.index,labelStart:m.index+1,labelEnd:m.index+1+m[1].length,end:m.index+m[0].length,id:m[2]}));
  const bounds=[...new Set([0,text.length,...spans.flatMap(s=>[s.start,s.end]),...links.flatMap(l=>[l.start,l.labelStart,l.labelEnd,l.end])])].sort((a,b)=>a-b);node.replaceChildren();
  for(let i=0;i<bounds.length-1;i++){
    const start=bounds[i],end=bounds[i+1],item=spans.findLast(s=>s.start<=start&&s.end>=end)?.item,value=text.slice(start,end);
    const link=links.find(l=>l.start<=start&&l.end>=end);
    if(link&&(end<=link.labelStart||start>=link.labelEnd)){node.append(E('span',{hidden:true},value));continue;}
    const parent=link?E('a',{href:'#note='+link.id}):node;
    if(link)node.append(parent);
    if(!item){parent.append(document.createTextNode(value));continue;}
    const mark=E('mark',{tabindex:0,role:'button','data-annotation-id':item.id,'data-color':highlightColor(item.data.color),'aria-label':'Resaltado: '+visibleReadingText(item.data.quote),onkeydown:e=>{if(e.key==='Enter'){e.preventDefault();mark.click();}},onclick:event=>!event.target.closest('a')&&showReadingActions(mark,{note:()=>editAnnotation(item),create:()=>{noteSelection={courseId:item.courseId,lessonId:item.lessonId,version:item.data.courseVersion,blockId:item.data.blockId,quote:item.data.quote,start:item.data.start,end:item.data.end};createStudyNoteFromSelection({manual:true});},generate:()=>{noteSelection={courseId:item.courseId,lessonId:item.lessonId,version:item.data.courseVersion,blockId:item.data.blockId,quote:item.data.quote,start:item.data.start,end:item.data.end};createStudyNoteFromSelection();},tutor:()=>askTutor('Ayudame a entender este fragmento:\n\n'+visibleReadingText(item.data.quote)),hasNote:!!item.data.comment,color:highlightColor(item.data.color),onColor:color=>recolorAnnotation(item,color),onDelete:()=>removeAnnotation(item)})},value);if(link){mark.removeAttribute('role');mark.removeAttribute('tabindex');mark.removeAttribute('aria-label');}parent.append(mark);
  }
}
// Barra compacta anclada al fragmento y siempre dentro del viewport.
function showReadingActions(anchor,{note,create,generate,tutor,hasNote=false,color='yellow',onColor,onDelete}={}){
  document.querySelector('.reading-highlight-actions')?.close();const rect=anchor.getBoundingClientRect();
  const dialog=E('dialog',{class:'reading-highlight-actions','aria-label':'Acciones del resaltado'});
  if(onColor){
    const swatches=E('div',{class:'highlight-colors',role:'group','aria-label':'Color del resaltado'});
    for(const [value,label] of HIGHLIGHT_COLORS)swatches.append(E('button',{type:'button',class:'highlight-swatch','data-color':value,'aria-label':'Color '+label,'aria-pressed':String(value===color),onclick:()=>{dialog.close();Promise.resolve().then(()=>onColor(value)).catch(error=>notify(error.message));}}));
    dialog.append(swatches);
  }
  const noteAction=hasNote&&note?note:create||note;
  if(noteAction)dialog.append(iconAction(hasNote?'Editar nota':create?'Crear nota de concepto':'Dejar una nota','edit',{class:'text-button'+(create?' create-concept-note':''),onclick:()=>{dialog.close();Promise.resolve().then(noteAction).catch(error=>notify(error.message));}}));
  if(generate)dialog.append(iconAction('Generar nota sobre ello','note',{onclick:()=>{dialog.close();Promise.resolve().then(generate).catch(error=>notify(error.message));}}));
  if(tutor)dialog.append(iconAction('Consultar al tutor','tutor',{onclick:()=>{dialog.close();Promise.resolve().then(tutor).catch(error=>notify(error.message));}}));
  if(onDelete)dialog.append(iconAction('Quitar resaltado','trash',{class:'text-button danger','data-remove-highlight':'true',onclick:()=>{dialog.close();Promise.resolve().then(onDelete).catch(error=>notify(error.message));}}));
  const dismiss=event=>{if(!dialog.contains(event.target)&&!anchor.contains(event.target))dialog.close();};
  dialog.addEventListener('close',()=>{document.removeEventListener('pointerdown',dismiss,true);window.removeEventListener('resize',close);window.removeEventListener('scroll',close,true);dialog.remove();if(anchor.isConnected)anchor.focus({preventScroll:true});});
  const close=()=>dialog.close();document.body.append(dialog);dialog.show();const box=dialog.getBoundingClientRect();
  const left=Math.max(8,Math.min(innerWidth-box.width-8,rect.left)),preferred=rect.bottom+box.height+12<innerHeight?rect.bottom+8:rect.top-box.height-8;
  dialog.style.left=left+'px';dialog.style.top=Math.max(8,Math.min(Math.max(8,innerHeight-box.height-8),preferred))+'px';
  document.addEventListener('pointerdown',dismiss,true);window.addEventListener('resize',close);window.addEventListener('scroll',close,true);
}
async function recolorAnnotation(item,color){
  const value=highlightColor(color);if(value===highlightColor(item.data.color))return;
  // Si el usuario cambió de lección mientras se guardaba, no se toca el DOM
  // nuevo: solo se actualiza el registro local.
  const stillHere=()=>view==='study'&&cid===item.courseId&&lid===item.lessonId;
  try{
    await api('/api/annotation',{action:'recolor',id:item.id,color:value,expectedRevision:item.data.annotationRevision||0});
    item.data.color=value;item.data.annotationRevision=(item.data.annotationRevision||0)+1;
    if(stillHere())for(const mark of annotationMarks(item.id))mark.dataset.color=value;
    document.querySelectorAll('.reading-highlight-actions .highlight-swatch').forEach(s=>s.setAttribute('aria-pressed',String(s.dataset.color===value)));
    for(const group of notebookItems(item.id))for(const swatch of group.querySelectorAll('.highlight-swatch'))swatch.setAttribute('aria-pressed',String(swatch.dataset.color===value));
    notify('Color del resaltado actualizado.');
  }catch(error){notify(error.message);}
}
async function removeAnnotation(item){
  const stillHere=()=>view==='study'&&cid===item.courseId&&lid===item.lessonId;
  try{
    await api('/api/annotation',{action:'remove',id:item.id,expectedRevision:item.data.annotationRevision||0});
    item.data.removed=true;item.data.annotationRevision=(item.data.annotationRevision||0)+1;
    if(stillHere()){
      // Quitar el resaltado en el lugar: se conserva el texto y la posición de
      // lectura. Si el foco estaba en el fragmento, se traslada al bloque sin
      // desplazar la vista.
      const marks=annotationMarks(item.id),activeWasMark=marks.includes(document.activeElement);
      let focusTarget=null;
      for(const mark of marks){focusTarget=focusTarget||mark.closest('.theory');mark.replaceWith(document.createTextNode(mark.textContent));}
      for(const note of document.querySelectorAll('[data-note-annotation-id="'+CSS.escape(item.id)+'"]'))note.remove();
      if(activeWasMark&&focusTarget?.isConnected)focusTarget.focus({preventScroll:true});
      $('note-count').textContent=records('annotation',false).filter(e=>!e.data.removed).length || '';
    }
    for(const group of notebookItems(item.id)){
      group.querySelector('.annotation-actions')?.remove();
      if(filter!=='all')group.remove();
      else if(!group.querySelector('.removed-note'))group.append(E('p',{class:'muted removed-note'},'Quitado del resaltado. El fragmento y sus revisiones siguen en tu historial.'));
    }
    notify('Resaltado quitado. El fragmento y sus revisiones quedan en tu historial.');
  }catch(error){notify(error.message);}
}
function readingSelection(root){
  const selected=window.getSelection();if(!selected||selected.isCollapsed||!selected.rangeCount)return null;const range=selected.getRangeAt(0);
  if(!root?.contains(range.startContainer)||!root.contains(range.endContainer))return null;
  const quote=range.toString();if(!quote.trim()||quote.length>20000)return null;
  const prefix=range.cloneRange();prefix.selectNodeContents(root);prefix.setEnd(range.startContainer,range.startOffset);const start=prefix.toString().length;return {range,quote,start,end:start+quote.length};
}
function createStudyNoteFromSelection({manual=false}={}){
  if(view!=='study'||document.querySelector('dialog[open]'))return;
  const anchor=window.getSelection()?.anchorNode,root=(anchor?.nodeType===Node.ELEMENT_NODE?anchor:anchor?.parentElement)?.closest('.theory');let chosen=readingSelection(root);
  if(!chosen&&noteSelection?.courseId===cid&&noteSelection.lessonId===lid&&noteSelection.version===course()?.version){chosen=noteSelection;}
  if(!chosen){notify('Seleccioná un término o fragmento de la lección para crear su nota.');return;}
  const block=lesson()?.blocks.find(b=>b.id===(root?.dataset.blockId||chosen.blockId));if(!block)return;
  const expected={courseId:cid,lessonId:lid,version:course().version,blockId:block.id,quote:chosen.quote,start:chosen.start,end:chosen.end,context:block.text};noteSelection=null;
  window.getSelection().removeAllRanges();window.WorkspaceKeys?.clearVisual();
  const title=E('input',{required:'required',maxlength:160,'aria-label':'Título del apunte'});title.value=chosen.quote.trim().split(/\s+/).slice(0,8).join(' ').replace(/[.!?]+$/,'');
  const instructions=E('textarea',{rows:3,maxlength:4000,'aria-label':'Orientación opcional',placeholder:'Opcional: ¿qué querés entender mejor?'}),output=E('div',{class:'note-tutor-output','aria-live':'polite'}),requestId=crypto.randomUUID(),noteId='study-'+requestId.replaceAll('-','');
  const linkSelection=E('input',{type:'checkbox','aria-label':'Enlazar el término con esta nota'});linkSelection.checked=true;
  const ownContent=E('textarea',{rows:8,maxlength:20000,required:'required','aria-label':'Contenido de la nota',placeholder:'Escribí tu definición, ejemplo o explicación. Podés usar Markdown.'});
  const titleKey=value=>value.normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase();
  let existingNote=null;
  const identity=E('p',{class:'muted'});
  function resolveTitle(){
    const next=state.library.notes.find(n=>!n.deletedAt&&titleKey(n.title)===titleKey(title.value));
    if(next?.id===existingNote?.id)return;
    existingNote=next||null;
    if(manual){ownContent.value=existingNote?.content||'';}
    identity.textContent=existingNote?'Editando la nota existente. Se conserva su historial.':'';
  }
  title.addEventListener('change',resolveTitle);title.addEventListener('blur',resolveTitle);resolveTitle();
  const dialog=E('dialog',{class:'note-tutor-dialog concept-note-dialog','aria-label':manual?'Crear nota de concepto':'Generar apunte'},E('form',{onsubmit:async e=>{
    e.preventDefault();const button=e.submitter;if(button.disabled)return;button.disabled=true;
    const currentLesson=course()?.lessons.find(x=>x.id===expected.lessonId),currentBlock=currentLesson?.blocks.find(x=>x.id===expected.blockId);
    if(cid!==expected.courseId||lid!==expected.lessonId||course()?.version!==expected.version||!currentBlock||currentBlock.text.slice(expected.start,expected.end)!==expected.quote){output.replaceChildren(E('p',{role:'alert'},'La lección cambió; no se creó el apunte.'));button.disabled=false;return;}
    if(!manual&&(tutorChannel()==='mcp'||!state.tutorConnected)){output.replaceChildren(E('p',{role:'alert'},tutorChannel()==='mcp'?'La generación automática requiere el tutor conectado por API.':'Conectá el tutor en Ajustes para generar un apunte.'));button.disabled=false;return;}
    output.replaceChildren(E('p',{role:'status'},manual?'Guardando tu nota…':'Preparando el apunte…'));
    try{
      let content=ownContent.value.trim();
      if(!manual){
      const prompt=`Generá un apunte breve y útil para estudiar, en Markdown, sobre la selección exacta. Priorizá el contexto de la lección; no inventes fuentes ni atribuyas dominio al estudiante. Si falta información, decilo.\n\nLección: ${currentLesson.title}\nSección: ${currentBlock.title||''}\nContexto:\n${expected.context}\n\nSelección: ${expected.quote}${instructions.value.trim()?`\n\nOrientación: ${instructions.value.trim()}`:''}`;
      const result=await tutorStream('/api/tutor',{courseId:expected.courseId,lessonId:expected.lessonId,message:prompt,contextRevision:window.TutorContext?.revision({kind:'study',courseId:expected.courseId,lessonId:expected.lessonId})},text=>output.replaceChildren(E('div',{class:'eyebrow'},'TUTOR · ESCRIBIENDO…'),tutorContent(text)));
      content=typeof result==='string'?result:result?.reply||result?.content||'';if(!content.trim())throw Error('El tutor no devolvió contenido; no se guardó ninguna nota.');
      }
      if(!content)throw Error('Escribí el contenido de la nota antes de guardar.');
      const note=await api('/api/study-note',{requestId,courseId:expected.courseId,lessonId:expected.lessonId,version:expected.version,blockId:expected.blockId,quote:expected.quote,start:expected.start,end:expected.end,title:title.value.trim()||expected.quote.slice(0,80),content,linkSelection:linkSelection.checked,...(existingNote?{existingNoteId:existingNote.id,existingNoteRevision:existingNote.revision}:{})});
      dialog.close();
      const position={x:scrollX,y:scrollY};
      try{const fresh=await api('/api/state');state=fresh;if(cid===expected.courseId&&lid===expected.lessonId&&view==='study'){render();scrollTo(position.x,position.y);}}
      catch(error){notify('La nota se guardó, pero no se pudo actualizar la vista. Recargá para verla.');}
    }catch(error){output.replaceChildren(E('p',{role:'alert'},error.message),E('p',{class:'muted'},'Si el guardado de la nota terminó pero falló el enlace, la nota se conserva en la biblioteca; no se borra automáticamente.'));}
    finally{button.disabled=false;}
  }},E('div',{class:'eyebrow'},(manual?'TU NOTA · ':'APUNTE GENERADO · ')+lesson().title),E('h2',{},manual?'Crear nota de concepto':'Generar apunte'),E('blockquote',{},visibleReadingText(chosen.quote)),E('label',{},'Título',title),identity,manual?E('label',{},'Tu explicación',ownContent):E('label',{},'Orientación opcional',instructions),E('label',{class:'concept-note-link-choice'},linkSelection,' Enlazar el término con esta nota'),E('p',{class:'muted'},'La nota se guarda en Notas como un apunte independiente. Si quitás el enlace, la nota permanece.'),E('div',{class:'dialog-actions'},E('button',{type:'button',class:'quiet',onclick:()=>dialog.close()},'Cancelar · Esc'),E('button',{type:'submit',class:'primary'},manual?'Guardar nota':'Generar apunte')),output));
  dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();title.focus();
}
window.createStudyNoteFromSelection=createStudyNoteFromSelection;
async function captureReadingHighlight(){
  if(document.querySelector('dialog[open]'))return;
  if(view==='notes')return ClassNotes.highlightSelection();
  if(view!=='study'||document.body.classList.contains('tutor-open')||document.body.classList.contains('outline-open'))return;
  const anchor=window.getSelection()?.anchorNode,root=(anchor?.nodeType===Node.ELEMENT_NODE?anchor:anchor?.parentElement)?.closest('.theory'),chosen=readingSelection(root);if(!chosen)return;
  const block=lesson().blocks.find(b=>b.id===root.dataset.blockId);if(!block)return;const target={courseId:cid,lessonId:lid},version=course().version;
  noteSelection={...chosen,courseId:target.courseId,lessonId:target.lessonId,version,blockId:block.id};
  const duplicate=records('annotation').some(e=>!e.data.removed&&e.data.courseVersion===version&&e.data.blockId===block.id&&e.data.start===chosen.start&&e.data.end===chosen.end);window.getSelection().removeAllRanges();window.WorkspaceKeys?.clearVisual();if(duplicate)return;
  try{await saveEvent('annotation',{blockId:block.id,quote:chosen.quote,start:chosen.start,end:chosen.end,type:'highlight',highlight:true,color:'yellow',comment:'',shareWithTutor:false},target);if(root.isConnected&&cid===target.courseId&&lid===target.lessonId)highlight(root,block.text,records('annotation').filter(e=>e.data.courseVersion===version&&e.data.blockId===block.id));}catch(error){notify(error.message);}
}
function renderExam(l){
  const target={courseId:cid,lessonId:lid},version=course().version;
  const calendarUnit=/^(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|d[ií]a de la madre|sesi[oó]n familiar)\b/i.test(l.unit||'');
  const context=l.examTopics||(calendarUnit?course().title:l.unit);
  const forms=l.exercises.map((ex,i)=>renderExercise(ex,true,i,l.exercises.length));
  const progress=E('p',{class:'exam-progress',role:'status','aria-live':'polite'});
  const status=E('p',{class:'exam-status',role:'status','aria-live':'polite'});
  const button=E('button',{type:'button',class:'primary group-conversation'},'Entregar y corregir simulacro');
  const answered=form=>{const a=form.answerPayload();return a.text.trim()!==''&&(a.selectedIndex===null||a.reasoning.trim()!=='');};
  const index=E('nav',{class:'exam-index','aria-label':'Preguntas del simulacro'});
  forms.forEach((form,i)=>{
    form.id='exam-question-'+i;
    const link=E('button',{type:'button',class:'text-button',onclick:()=>{form.scrollIntoView({behavior:'smooth',block:'start'});form.querySelector('textarea').focus({preventScroll:true});}},`Pregunta ${i+1}`);
    index.append(link);
    form.addEventListener('input',update);form.addEventListener('change',update);
  });
  function update(){
    const count=forms.filter(answered).length;progress.textContent=`${count} de ${forms.length} preguntas con respuesta`;
    [...index.children].forEach((link,i)=>{link.textContent=`${i+1} · ${answered(forms[i])?'Con respuesta':'Sin responder'}`;link.setAttribute('aria-label',`Pregunta ${i+1}: ${answered(forms[i])?'con respuesta':'sin responder'}`);});
  }
  const prior=records('chat_message').findLast(e=>e.data.examSubmission&&e.data.courseVersion===version);
  if(prior)status.textContent='Entrega registrada. Revisá la conversación del tutor para consultar la devolución o su estado pendiente.';
  let sending=false;
  async function submit(){
    if(sending||busy){notify('El tutor está respondiendo. Esperá para entregar.');return;}
    sending=true;button.disabled=true;forms.forEach(form=>form.inert=true);
    status.textContent='Guardando tus respuestas…';
    try{
      const answers=forms.map(form=>form.answerPayload());
      for(let i=0;i<forms.length;i++)await forms[i].saveAnswer(answers[i],false);
      if(cid!==target.courseId||lid!==target.lessonId||course().version!==version){notify('Respuestas guardadas en el simulacro original. Volvé a abrirlo para entregar.');return;}
      status.textContent=tutorChannel()==='mcp'?'Registrando la entrega…':'Solicitando corrección…';
      const message='Entrego mis respuestas al simulacro. Las preguntas sin responder están indicadas.\n\n'+answers.map((a,i)=>`Pregunta ${i+1} [${a.exerciseId}]: ${a.question}\nRespuesta: ${a.text.trim()||'(sin responder)'}${a.reasoning?'\nJustificación: '+a.reasoning:''}`).join('\n\n');
      const result=await askTutor(message,null,{examSubmission:true});
      status.textContent=({pending:'Entrega registrada. La corrección está pendiente del tutor externo; recargá la conversación cuando responda.',offline:'Respuestas guardadas. Conectá el tutor en Ajustes o elegí MCP para solicitar la corrección.',corrected:'El tutor respondió. Revisá la devolución en la conversación.',error:'La corrección se interrumpió. Tus respuestas están guardadas; podés volver a solicitarla.'})[result]||'Tus respuestas siguen guardadas.';
      if(!status.isConnected&&cid===target.courseId&&lid===target.lessonId){const current=document.querySelector('.exam-status');if(current)current.textContent=status.textContent;}
    }catch(error){status.textContent='No se completó la entrega: '+error.message+'. El texto sigue en esta pantalla; revisá la conexión y reintentá.';}
    finally{sending=false;button.disabled=false;forms.forEach(form=>form.inert=false);}
  }
  button.addEventListener('click',()=>{
    if(sending||busy||document.querySelector('.exam-confirmation[open]'))return;
    const missing=forms.flatMap((form,i)=>answered(form)?[]:[i+1]);
    const dialog=E('dialog',{class:'exam-confirmation','aria-label':'Confirmar entrega'},E('h2',{},'¿Entregar el simulacro?'),E('p',{},missing.length?`Quedan sin responder las preguntas ${missing.join(', ')}. Podés revisarlas o entregar así; lo que falta no contará como evidencia de comprensión.`:'El tutor recibirá tus respuestas para corregirlas.'),E('div',{class:'dialog-actions'},E('button',{type:'button',class:'quiet',onclick:()=>dialog.close()},'Revisar respuestas'),E('button',{type:'button',class:'primary',onclick:()=>{dialog.close();submit();}},'Confirmar entrega')));
    dialog.addEventListener('close',()=>{dialog.remove();button.focus();});document.body.append(dialog);dialog.showModal();
  });
  update();
  const sources=E('details',{class:'exam-sources'},E('summary',{},'Consultar fuentes'));
  for(const source of course().sources){const url=safeSourceUrl(source);if(url)sources.append(E('p',{},E('a',{href:url,target:'_blank',rel:'noopener'},source.title)));}
  const follow=E('details',{class:'continuation-handoff'},E('summary',{},'Seguir después del simulacro'),E('p',{class:'muted'},'Podés revisar la devolución y consultar dudas en la conversación del tutor.'),E('button',{type:'button',class:'text-button',onclick:()=>window.WorkspaceKeys?.openTutor(false)},'Consultar al tutor'),E('button',{type:'button',class:'text-button',onclick:()=>WorkspaceKeys.go('plan')},'Ver plan de estudio'),E('button',{type:'button',class:'text-button',onclick:async()=>{try{await saveEvent('continuation_requested',{},target);notify('Refuerzo solicitado. Retomá con tu agente para prepararlo con tus respuestas reales.');}catch(error){notify(error.message);}}},'Solicitar refuerzo al agente'));
  $('main').replaceChildren(E('section',{class:'exam-view'},E('div',{class:'eyebrow'},context),E('h1',{},l.title),E('p',{class:'muted'},`${l.exercises.length} preguntas · Respondé con tus palabras. Al finalizar, entregá tus respuestas para recibir una devolución.`),E('p',{class:'muted'},'Práctica no oficial. El formato y la duración del examen real pueden ser diferentes.'),progress,index,E('section',{class:'exercise-group'},...forms,E('div',{class:'group-conversation-actions'},button),status),follow,sources));
}

function isExamLesson(l){return l.mode==='exam'||(!l.mode&&/\bsimulacro\b/i.test(l.title));}
function renderExercise(ex, exam=false, index=0, total=1) {
  const target={courseId:cid,lessonId:lid};
  const key=`draft:${cid}:${course().version}:${lid}:${ex.id}`;
  const prior=records('answer').filter(e=>e.data.exerciseId===ex.id).at(-1);
  const form=E('form',{class:'activity'},E('div',{class:'eyebrow'},exam?`PREGUNTA ${index+1} DE ${total}`:ex.type==='choice'?'DISTINGUIR Y JUSTIFICAR':ex.type==='explain'?'CON TUS PALABRAS':'ARGUMENTAR Y APLICAR'),E(exam?'h2':'h3',{},ex.question));
  let input;
  if(ex.type==='choice') {
    const order=ex.orderedOptions?ex.options.map((_,i)=>i):ChoiceOrder.forAttempt(key,ex.options.length);
    for(const i of order){const opt=ex.options[i];
      const radio=E('input',{type:'radio',name:ex.id,value:i,required:'required'});radio.checked=String(GlosaRoom.storage.getItem(key)??prior?.data.selectedIndex)===String(i);
      if(!exam)radio.addEventListener('change',()=>GlosaRoom.storage.setItem(key,radio.value));
      form.append(E('label',{class:'choice-option'},radio,E('span',{class:'choice-text'},opt)));
    }
    input=E('textarea',{rows:3,placeholder:'¿Por qué elegiste esa opción? Una frase alcanza para empezar.','aria-label':'Justificación de la opción'});input.value=GlosaRoom.storage.getItem(key+':reason')??prior?.data.reasoning??'';
    if(!exam)input.addEventListener('input',()=>GlosaRoom.storage.setItem(key+':reason',input.value));
  } else {
    input=E('textarea',{rows:4,required:'required',placeholder:exam?'Escribí tu explicación acá...':'Escribí tu explicación. También podés decir qué parte todavía no entendés.','aria-label':exam?`Respuesta a la pregunta ${index+1}`:'Tu respuesta'});input.value=GlosaRoom.storage.getItem(key)??prior?.data.text??'';
    if(!exam)input.addEventListener('input',()=>GlosaRoom.storage.setItem(key,input.value));
  }
  form.append(input);
  if(exam){
    const saved=E('p',{class:'muted draft-status',role:'status'});form.append(saved);
    const persist=()=>{try{
      GlosaRoom.storage.setItem(ex.type==='choice'?key+':reason':key,input.value);
      const selected=form.querySelector('input:checked');if(selected)GlosaRoom.storage.setItem(key,selected.value);
      saved.textContent='Borrador guardado en este navegador.';
    }catch{saved.textContent='No se pudo guardar el borrador. Conservá una copia antes de salir.';}};
    input.addEventListener('input',persist);
    for(const radio of form.querySelectorAll('input[type=radio]'))radio.addEventListener('change',persist);
  }
  const feedback=E('div');
  form.answerPayload=()=>{
    const selected=form.querySelector('input:checked');
    const payload={exerciseId:ex.id,question:ex.question,text:ex.type==='choice'?(selected?ex.options[Number(selected.value)]:''):input.value,reasoning:ex.type==='choice'?input.value:'',selectedIndex:ex.type==='choice'?(selected?Number(selected.value):null):null,presentationOrder:ex.type==='choice'?(ex.orderedOptions?ex.options.map((_,i)=>i):ChoiceOrder.forAttempt(key,ex.options.length)):null,randomizationMethod:ex.type==='choice'?(ex.orderedOptions?'semantic-order':'crypto.getRandomValues / Fisher-Yates'):null};
    return payload;
  };
  let attempt=null;
  form.saveAnswer=async(payload=form.answerPayload(), reveal=true)=>{
    if(exam){
      const signature=JSON.stringify(payload);
      if(attempt?.signature!==signature)attempt={signature,id:crypto.randomUUID()};
      await saveEvent('answer',payload,target,attempt.id);
    }else await saveEvent('answer',payload,target);
    if(ex.type==='choice'&&reveal) {
      const correct=payload.selectedIndex===ex.correctIndex;
      feedback.replaceChildren(E('div',{class:'answer-feedback'},(correct?'La opción coincide con el criterio. ':'Revisá esta distinción. ')+(ex.explanation||'Ahora justificá la respuesta.'),' Una opción por sí sola no demuestra comprensión.'));
      await saveEvent('feedback',{exerciseId:ex.id,kind:'choice_check',correct,explanation:ex.explanation,helpProvided:reveal},target);
    }
  };
  form.addEventListener('submit',ev=>{ev.preventDefault();form.closest('.exercise-group')?.querySelector('.group-conversation')?.click();});
  form.append(feedback);
  if(!exam&&ex.type==='choice'&&!ex.orderedOptions)form.append(E('button',{type:'button',class:'text-button',onclick:async()=>{GlosaRoom.storage.setItem(key,'');GlosaRoom.storage.setItem(key+':reason','');GlosaRoom.storage.removeItem(key+':order');await saveEvent('feedback',{exerciseId:ex.id,kind:'practice_restart',helpProvided:!!prior});renderStudy();}},'Empezar otro intento'));
  return form;
}
function renderExerciseGroup(exercises){
  const target={courseId:cid,lessonId:lid};
  const forms=exercises.map(ex=>renderExercise(ex)),button=E('button',{type:'button',class:'primary group-conversation'},'Consultar al tutor');
  button.addEventListener('click',async()=>{
    if(busy){notify('El tutor está respondiendo.');return;}
    if(forms.some(form=>!form.reportValidity()))return;
    const answers=forms.map(form=>form.answerPayload());button.disabled=true;
    forms.forEach(form=>form.inert=true);
    try{
      for(let i=0;i<forms.length;i++)await forms[i].saveAnswer(answers[i]);
      if(cid!==target.courseId||lid!==target.lessonId){notify('Respuestas guardadas en la lección original.');return;}
      const message=answers.map(a=>a.question+'\n'+a.text+(a.reasoning?'\nMi justificación: '+a.reasoning:'')).join('\n\n');
      await askTutor(message,answers.length===1?answers[0].exerciseId:null);
    }catch(err){notify(err.message);}finally{button.disabled=false;forms.forEach(form=>form.inert=false);}
  });
  return E('section',{class:'exercise-group'},E('div',{class:'eyebrow'},'AHORA, HACÉ TUYA LA IDEA'),...forms,E('div',{class:'group-conversation-actions'},button));
}
// Old saved replies may contain an entire JSON envelope, including a cut-off tail.
// Decode for display only: preserve the original record for export and auditing.
function tutorVisibleText(raw){
  return raw.replace(/<(think|analysis|reasoning)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').split(/<(?:think|analysis|reasoning)\b[^>]*>/i)[0].split(/<\/(?:think|analysis|reasoning)\s*>/i).at(-1).trim();
}
function internalTutorText(text){return /^(?:#{1,6}\s*)?(?:analysis\b|reasoning\b|thinking\b|análisis\s*:|razonamiento\s*:|el estudiante (?:envió|ha enviado|respondió|escribió)|analicemos contra la rúbrica|(?:i|we) (?:need to|must)\b|let.s (?:analyze|think)\b)/i.test(text);}
function readableTutor(raw,record={}){
  if(typeof raw!=='string')return '';
  const fallback='El tutor no devolvió una respuesta final completa. Podés reintentar; tu trabajo sigue guardado.';
  const clean=tutorVisibleText(raw).replace(/^```(?:json)?\s*\n?/,'').replace(/\s*```$/,'');
  const visible=reply=>{const text=tutorVisibleText(reply);return text&&!internalTutorText(text)?text:fallback;};
  // Read only an explicit final reply, even when an old provider put analysis
  // before its JSON. This changes presentation, never the persisted event.
  for(const match of clean.matchAll(/\{/g)){
    let depth=0,quoted=false,escaped=false;
    for(let i=match.index;i<clean.length;i++){
      const ch=clean[i];if(quoted){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quoted=false;continue;}
      if(ch==='"')quoted=true;else if(ch==='{')depth++;else if(ch==='}'&&!--depth){
        try{const parsed=JSON.parse(clean.slice(match.index,i+1));if(typeof parsed.reply==='string'&&parsed.reply.trim())return visible(parsed.reply);}catch{}break;
      }
    }
  }
  const envelope=clean.search(/\{\s*"reply"\s*:/),json=clean.startsWith('{')?clean:envelope>=0?clean.slice(envelope):null;
  if(json){
    const match=json.match(/"reply"\s*:\s*("(?:[^"\\]|\\.)*")/s);
    if(match){try{return visible(JSON.parse(match[1]));}catch{}}
    const start=json.match(/"reply"\s*:\s*(".*)$/s);
    if(start){for(let trim=0;trim<7;trim++){try{return visible(JSON.parse((trim?start[1].slice(0,-trim):start[1])+'"'));}catch{}}}
    return fallback;
  }
  if(record.structured===false||!clean||internalTutorText(clean))return fallback;
  return clean;
}
function tutorContent(raw,record={}){
  const node=E('div',{class:'tutor-answer-text'}),text=readableTutor(raw,record);
  if(window.NoteMarkdown)node.append(NoteMarkdown.render(text,{images:false}));
  else node.textContent=text;
  return node;
}
function renderChat() {
  if(!course())return;
  const latest=records('tutor_reply').at(-1)?.data;
  const channel=tutorChannel();
  $('tutor-preview').textContent=latest?.followUp||readableTutor(latest?.reply,latest)||'Una duda también es un buen comienzo.';
  const external=records('tutor_reply').some(e=>e.data.source==='external-mcp');
  const provider=tutorProviders.find(p=>p.id===(state.settings.provider||'openrouter'))?.name||'Tutor';
  $('tutor-status').textContent=channel==='mcp'?(external?'MCP · agente externo':'MCP · pendiente externo'):state.tutorConnected?'API · conectado · '+provider:'API · sin conexión';
  $('chat-hint').textContent=channel==='mcp'?'MCP externo · la consulta se guardará pendiente para tu cliente; no requiere clave.':state.tutorConnected?'API · conectado a '+provider+'; el mensaje se guarda y se envía.':'API · sin conexión: el mensaje se guardará, no se enviará. Configurá el tutor o elegí MCP.';
  const messages=records().filter(e=>['chat_message','tutor_reply'].includes(e.kind));
  const answered=new Set(records('tutor_reply').map(e=>e.id));
  if(!messages.length) $('tutor-chat').replaceChildren();
  else $('tutor-chat').replaceChildren(...messages.map(e=>{
    const student=e.kind==='chat_message',d=e.data;
    const label=student?'Vos':(d.source==='external-mcp'?'Agente externo'+(d.model?' · '+d.model:''):'Tutor');
    const m=E('div',{class:'message '+(student?'student':'assistant')},E('div',{class:'message-label'},label),student?d.message:tutorContent(d.reply,d));
    if(student&&d.pendingExternal&&!answered.has(e.id.replace(/-pregunta$/,'')))m.append(E('p',{class:'muted'},'Pendiente para el canal MCP externo. Usá «Recargar conversación» cuando tu agente responda.'));
    if(!student&&d.followUp)m.append(E('p',{},d.followUp));
    return m;
  }));
  $('tutor-chat').scrollTop=messages.length?$('tutor-chat').scrollHeight:0;
}
function showTutorDetails(){
  const data=course()?records('tutor_reply').at(-1)?.data:null;
  const dialog=E('dialog',{class:'tutor-details-dialog'},E('h2',{},'Contexto y evidencia'),E('button',{type:'button',class:'text-button',onclick:()=>dialog.close()},'Cerrar · Esc'));
  if(!data)dialog.append(E('p',{},'Todavía no hay una respuesta del tutor en esta lección.'));
  else{
    if(data.truncated)dialog.append(E('p',{},'La respuesta llegó incompleta; no se acreditó comprensión.'));
    if(data.source==='external-mcp')dialog.append(E('p',{class:'muted'},'Respuesta de un agente externo con el MCP de tutor'+(data.model?' · modelo '+data.model:'')+'. Es una ayuda conversada; no acredita dominio independiente.'));
    if(data.tutorContext&&window.TutorContext)dialog.append(TutorContext.used(data.tutorContext));
    if(data.evidence?.length)dialog.append(E('ul',{},...data.evidence.map(x=>E('li',{},typeof x==='string'?x:(x.criterion||'Criterio')+': '+(x.quote||'')))));
    if(data.gaps?.length)dialog.append(E('p',{},'Pendiente: '+data.gaps.join(' · ')));
    if(data.reason)dialog.append(E('p',{},data.reason));
  }
  document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.showModal();
}
async function askTutor(message,exerciseId=null,metadata={}) {
  if(!course()){notify('Prepará o importá un curso para conversar sobre sus lecciones. Podés consultar al tutor desde un apunte en Notas.');return;}
  if(busy){notify('El tutor está respondiendo. Tu respuesta está guardada.');return;}
  const targetCid=cid,targetLid=lid;
  window.WorkspaceKeys?.openTutor(false);
  if(tutorChannel()==='mcp'){
    // Canal externo: la consulta queda como evento pendiente con un ID determinista
    // (`<request_id>-pregunta`) para que el MCP la responda sin duplicar la pregunta.
    const requestId=crypto.randomUUID();
    const item=await api('/api/event',{id:requestId+'-pregunta',kind:'chat_message',courseId:targetCid,lessonId:targetLid,data:{...metadata,message,exerciseId,channel:'mcp',pendingExternal:true}});
    if(!state.events.some(e=>e.id===item.id))state.events.push(item);
    renderChat();
    notify('Consulta guardada como pendiente. Un cliente con el MCP de tutor puede responderla; después usá «Recargar conversación».');
    return 'pending';
  }
  await saveEvent('chat_message',{...metadata,message,exerciseId});renderChat();
  if(!state.tutorConnected){notify('Respuesta guardada. Conectá el tutor en Ajustes, elegí el canal MCP o exportá para conversar fuera.');return 'offline';}
  busy=true;$('send-chat').disabled=true;$('send-chat').textContent='…';$('send-chat').setAttribute('aria-label','El tutor está respondiendo');
  const live=E('div',{class:'message assistant tutor-streaming'},E('div',{class:'message-label'},'Tutor · preparando respuesta…'));
  $('tutor-chat').append(live);$('tutor-chat').scrollTop=$('tutor-chat').scrollHeight;
  try{await tutorStream('/api/tutor',{courseId:targetCid,lessonId:targetLid,message,exerciseId,contextRevision:window.TutorContext?.revision({kind:'study',courseId:targetCid,lessonId:targetLid})},text=>{
    if(cid!==targetCid||lid!==targetLid||!live.isConnected)return;
    const chat=$('tutor-chat'),follow=chat.scrollHeight-chat.scrollTop-chat.clientHeight<100;
    live.replaceChildren(E('div',{class:'message-label'},'Tutor · escribiendo…'),tutorContent(text));
    if(follow)chat.scrollTop=chat.scrollHeight;
  });await reload();return 'corrected';}
  catch(err){live.append(E('p',{class:'muted'},'Respuesta interrumpida · no es una evaluación final.'));notify(err.message);return 'error';}
  finally{busy=false;$('send-chat').disabled=false;$('send-chat').textContent='↑';$('send-chat').setAttribute('aria-label','Conversar ↗');}
}
function renderNotebook() {
  const all=records(null,false), resolved=new Set(all.filter(e=>e.kind==='annotation_resolved').map(e=>e.data.annotationId));
  const visible=all.filter(e=>{if(e.kind==='annotation'&&e.data.removed)return filter==='all';return filter==='important'?['annotation','tutor_note'].includes(e.kind):filter==='all'?['annotation','tutor_note','answer','feedback','assessment','tutor_reply'].includes(e.kind):filter==='doubts'?(e.kind==='annotation'&&!resolved.has(e.id)&&['doubt','unclear','disagree'].includes(e.data.type))||(e.kind==='tutor_note'&&e.data.kind==='doubt'):e.kind===filter;});
  const filterButton=(k,v)=>E('button',{class:'quiet'+(filter===k?' active':''),onclick:()=>{filter=k;renderNotebook();}},v);
  const nodes=[E('div',{class:'eyebrow'},'LO QUE VALE LA PENA RETOMAR'),E('h1',{},'Tu cuaderno'),E('p',{class:'lede'},'Tus anotaciones y los hallazgos importantes que el tutor propone conservar. Cada apunte remite a tu evidencia; una síntesis no acredita comprensión.'),E('div',{class:'filter-buttons'},filterButton('important','Lo importante'),filterButton('doubts','Dudas pendientes')),E('details',{class:'notebook-history'},E('summary',{},'Consultar registro completo'),E('p',{class:'muted'},'Las respuestas originales y las conversaciones se conservan para respaldos y para el agente que prepara la continuación.'),filterButton('all','Todo el registro'),filterButton('answer','Respuestas'),filterButton('feedback','Feedback'))];
  if(!visible.length)nodes.push(E('div',{class:'empty-state'},'Todavía no hay apuntes relevantes en esta vista. Anotá una duda; el tutor agregará solo lo que convenga retomar.'));
  for(const ev of visible.toReversed()) {
    const d=ev.data,l=course().lessons.find(x=>x.id===ev.lessonId);
    const item=E('article',{class:'notebook-item','data-annotation-id':ev.kind==='annotation'?ev.id:undefined},E('div',{class:'eyebrow'},`${kindLabel[ev.kind]} · ${dateLabel(ev.timestamp)}`),E('h3',{},l?.title||ev.lessonId));
    if(d.removed)item.append(E('p',{class:'muted'},'Quitado del resaltado. El fragmento y sus revisiones siguen en tu historial.'));
    if(d.quote)item.append(E('blockquote',{},visibleReadingText(d.quote)));
    item.append(E('p',{},d.comment||d.text||(ev.kind==='tutor_reply'?readableTutor(d.reply,d):d.reply)||d.reason||d.explanation||''));
    if(d.reasoning)item.append(E('p',{},'Tu justificación: '+d.reasoning));
    if(ev.kind==='tutor_note')item.append(E('p',{class:'muted'},({doubt:'Duda abierta',insight:'Relación conceptual',decision:'Decisión de repaso'}[d.kind]||'Síntesis')+' · Propuesto por el tutor. La cita es tuya; la síntesis no demuestra aprendizaje.'));
    if(d.courseVersion!==undefined && d.courseVersion!==course().version)item.append(E('p',{class:'muted'},'Esta anotación o respuesta pertenece a la versión '+d.courseVersion+'. Se conserva el fragmento original.'));
    if(ev.kind==='annotation') {
      item.append(E('span',{class:'muted'},d.shareWithTutor?'Compartida con el tutor':'Nota personal'),annotationActions(ev));
      if(!resolved.has(ev.id))item.append(E('button',{class:'text-button',onclick:async()=>{const old=lid;lid=ev.lessonId;try{await saveEvent('annotation_resolved',{annotationId:ev.id,note:'El estudiante la marca como resuelta.'});}finally{lid=old;}renderNotebook();}},' · Marcar como resuelta'));
      else item.append(E('span',{class:'muted'},' · Resuelta por vos'));
    }
    if(l)item.append(E('button',{class:'text-button',onclick:()=>chooseLesson(l.id)},'Volver a la lección →'));
    nodes.push(item);
  }
  nodes.push(E('button',{class:'primary',onclick:()=>$('export-dialog').showModal()},'Exportar historial completo'));
  $('main').replaceChildren(...nodes);
}
function renderPlan() { StudyPlan.render(); }

function renderSimulation(kind) {
  const box=E('section',{class:'simulation'},E('div',{class:'eyebrow'},'EXPERIMENTAR PARA ENTENDER'));
  if(kind==='integration') {
    box.append(E('h2',{},'Un pedido, tres versiones de la realidad'),E('p',{class:'muted'},'Modelo didáctico simplificado: el pedido reduce unidades disponibles. No representa todos los pasos contables de una venta real.'));
    const checkbox=E('input',{type:'checkbox'}), amount=E('input',{type:'range',min:0,max:20,value:5,'aria-label':'Unidades del pedido'}),output=E('div');
    const update=()=>{const n=Number(amount.value),shared=checkbox.checked;output.replaceChildren(E('div',{class:'flow-cells'},E('div',{class:'flow-cell'},'Ventas · disponible',E('strong',{},20-n)),E('div',{class:'flow-cell'},'Depósito · disponible',E('strong',{},shared?20-n:20)),E('div',{class:'flow-cell'},'Portal · disponible',E('strong',{},shared?20-n:20))),E('p',{},`Pedido: ${n} unidades. ${shared?'Los sistemas comparten el cambio.':'Depósito y portal no recibieron el cambio: podrían prometer stock ya reservado.'}`));};
    checkbox.addEventListener('change',update);amount.addEventListener('input',update);
    box.append(E('label',{class:'check'},checkbox,'Conectar los sistemas'),E('label',{},'Tamaño del pedido',amount),output,E('p',{class:'muted'},'Para pensar: ¿qué datos se deben compartir y en qué momento? ¿Alcanza con conectar sistemas si cada uno identifica al producto de forma diferente?'));update();
  } else {
    box.append(E('h2',{},'Un tablero puede decir cosas distintas'),E('p',{class:'muted'},'Datos ficticios: ventas de dos productos. Cambiá la medida y justificá qué decisión permite tomar.'));
    const select=E('select',{'aria-label':'Medida del tablero'},E('option',{value:'sales'},'Facturación'),E('option',{value:'margin'},'Margen de contribución')),out=E('div');
    const update=()=>{const values=select.value==='sales'?[10000,7000]:[1000,2800],max=Math.max(...values);out.replaceChildren(E('div',{class:'bar-chart'},...values.map((v,i)=>E('div',{class:'bar-column'},E('span',{},'$ '+v.toLocaleString('es-AR')),E('div',{class:'chart-bar',style:`height:${Math.round(v/max*85)}%`})))),E('div',{class:'flow-cells'},'Producto A','Producto B'),E('p',{},select.value==='sales'?'A factura más. ¿Eso implica que conviene promoverlo?':'B aporta más margen en este ejemplo. Faltan otros factores para decidir, como capacidad y demanda.'));};
    select.addEventListener('change',update);box.append(select,out,E('p',{class:'muted'},'Explicá por qué elegir una medida cambia la interpretación y qué relación tiene con el objetivo de negocio.'));update();
  }
  return box;
}
let tutorProviders=[
  {id:'openrouter',name:'OpenRouter',baseUrl:'https://openrouter.ai/api/v1',defaultModel:'openrouter/free'},
  {id:'freellmapi',name:'FreeLLMAPI',baseUrl:'http://localhost:3001/v1',defaultModel:'auto'},
  {id:'opencode',name:'OpenCode',baseUrl:'http://127.0.0.1:4096',defaultModel:'opencode/deepseek-v4.1-flash-free'},
  {id:'deepseek',name:'DeepSeek',baseUrl:'https://api.deepseek.com',defaultModel:'deepseek-flash'},
  {id:'compatible',name:'API compatible',baseUrl:'',defaultModel:''},
  {id:'intern',name:'Intern Discovery',baseUrl:'https://discovery-api.intern-ai.org.cn/v1',defaultModel:''}
];
function providerDetails(){return tutorProviders.find(p=>p.id===$('provider-select').value)||tutorProviders[0];}
function providerFields(){const p=providerDetails();return {provider:p.id,providerBaseUrl:['freellmapi','opencode','compatible'].includes(p.id)?$('provider-base-url').value.trim():p.baseUrl};}
let tutorModelCatalog=[];
function setModelOptions(models=[],selected=providerDetails().defaultModel){
  tutorModelCatalog=[...models];
  const isOpenCode=providerDetails().id==='opencode',filter=$('model-provider-filter');
  const previous=filter.value;
  const providers=isOpenCode?[...new Set([...models.map(m=>m.id),selected].filter(id=>id&&id!=='auto'&&id.includes('/')).map(id=>id.split('/')[0]))].sort():[];
  filter.replaceChildren(E('option',{value:''},'Todos los proveedores'),...providers.map(id=>E('option',{value:id},id)));
  filter.value=providers.includes(previous)?previous:'';
  $('model-provider-filter-label').hidden=!isOpenCode;
  renderModelOptions(selected);
}
function renderModelOptions(selected=$('model-select').value){
  const p=providerDetails(),options=[],filter=p.id==='opencode'?$('model-provider-filter').value:'';
  const matches=id=>!filter||id.startsWith(filter+'/');
  if(p.id==='openrouter')options.push(E('option',{value:'openrouter/free'},'Selección automática gratuita'));
  if(p.id==='freellmapi')options.push(E('option',{value:'auto'},'Selección automática (cadena de FreeLLMAPI)'));
  if(p.id==='opencode'&&!filter)options.push(E('option',{value:'auto'},'Modelo predeterminado de OpenCode'));
  if(['intern','compatible'].includes(p.id))options.push(E('option',{value:''},'Seleccioná o ingresá un ID de modelo'));
  for(const m of tutorModelCatalog)if(matches(m.id)&&!options.some(o=>o.value===m.id))options.push(E('option',{value:m.id},m.name));
  if(selected&&matches(selected)&&!options.some(o=>o.value===selected))options.push(E('option',{value:selected},selected));
  $('model-select').replaceChildren(...options);
  $('model-select').value=options.some(o=>o.value===selected)?selected:options[0]?.value||'';
}
$('model-provider-filter').addEventListener('change',()=>{$('custom-model').value='';renderModelOptions();});

function updateProvider(model=providerDetails().defaultModel){
  const p=providerDetails();$('provider-url-label').hidden=!['freellmapi','opencode','compatible'].includes(p.id);
  $('provider-url-title').textContent=p.id==='opencode'?'URL de OpenCode local':p.id==='compatible'?'URL base de la API (incluí /v1 si tu proveedor lo requiere)':'URL de API de FreeLLMAPI';
  $('provider-key-title').textContent=p.id==='opencode'?'Contraseña del servidor OpenCode (si requiere autenticación)':'Clave de API';
  $('api-key').placeholder=p.id==='opencode'?'Contraseña del servidor local':'Pegá la clave aquí, no en el chat';
  $('custom-model-label').hidden=p.id==='openrouter';$('custom-model').value='';
  $('model-label').textContent=p.id==='openrouter'?'Modelo gratuito':'Modelo';$('load-models').textContent=p.id==='openrouter'?'Buscar modelos gratuitos':'Buscar modelos';
  $('provider-info').textContent=p.id==='openrouter'?'Solo modelos con precio cero.':p.id==='freellmapi'?'Usá la URL de tu instancia y su clave unificada. La cadena y los proveedores habilitados se configuran en FreeLLMAPI.':'Creá una clave en Intern Discovery · Token Plan. El saldo y los límites dependen de tu cuenta.';
  if(p.id==='deepseek')$('provider-info').textContent='Conexión directa a DeepSeek. Pegá tu clave y elegí un modelo; el uso se factura en tu cuenta de DeepSeek.';
  if(p.id==='compatible')$('provider-info').textContent='Para APIs compatibles con Chat Completions. Indicá URL base, clave e ID del modelo. Podés escribir el ID aunque el proveedor no ofrezca un catálogo. Los costos dependen de tu proveedor.';
  if(p.id==='opencode')$('provider-info').textContent='Usa la terminal de OpenCode con una sesión temporal por consulta. DeepSeek V4.1 Flash Free fue comprobado; auto usa el modelo predeterminado de OpenCode. Los costos dependen del proveedor conectado.';
  $('quota-info').textContent='';$('model-provider-filter').value='';setModelOptions([],model);
}
async function connectProviderKey(fields){
  const key=$('api-key').value.trim();if(!key)return;
  await api('/api/key',{...fields,key});
  if(JSON.stringify(fields)===JSON.stringify(providerFields()))$('api-key').value='';
  const fresh=await api('/api/state');state.tutorConnected=fresh.tutorConnected;renderChat();
}
api('/api/providers').then(d=>{tutorProviders=d.providers;}).catch(()=>{});
function showSettings() {
  const s=state.settings;$('exam-date').value=s.examDate;$('weekday-minutes').value=s.weekdayMinutes;$('weekend-minutes').value=s.weekendMinutes;$('api-key').value='';applyAppearance();
  $('provider-select').value=s.provider||'openrouter';$('provider-base-url').value=s.providerBaseUrl||providerDetails().baseUrl;updateProvider(s.model);syncTutorChannelUI();
  $('override-list').textContent=Object.entries(s.dailyOverrides||{}).map(([d,m])=>`${d}: ${m} min`).join(' · ')||'Sin ajustes por fecha.';window.GlosaHome?.mountSettings($('settings-margin-content'));$('settings-dialog').showModal();
}
window.GlosaSettings={open(section){showSettings();if(section==='margen')requestAnimationFrame(()=>$('settings-margin').scrollIntoView({block:'start'}));}};
async function flushTime() {
  if(window.FocusClock) await window.FocusClock.flush();
}

function annotationActions(item){
  const highlight=isHighlight(item),removed=!!item.data.removed,pending=highlight&&!removed;
  const actions=[];
  if(pending){
    for(const [value,label] of HIGHLIGHT_COLORS)actions.push(E('button',{class:'text-button highlight-swatch','data-color':value,'aria-label':'Color '+label,'aria-pressed':String(highlightColor(item.data.color)===value),onclick:()=>recolorAnnotation(item,value)}));
  }
  actions.push(iconAction('Editar','edit',{onclick:()=>editAnnotation(item)}));
  actions.push(iconAction(pending?'Quitar resaltado':'Borrar','trash',{class:'text-button danger',onclick:()=>pending?removeAnnotation(item):deleteAnnotation(item)}));
  return E('span',{class:'annotation-actions'},...actions);
}
function editAnnotation(item){editingAnnotation=item;selection=null;$('selected-quote').textContent=visibleReadingText(item.data.quote);$('annotation-comment').value=item.data.comment||'';$('annotation-type').value=item.data.type==='highlight'?'personal':item.data.type||'doubt';$('annotation-share').checked=item.data.shareWithTutor!==false;$('annotation-dialog').showModal();$('annotation-comment').focus();}
function deleteAnnotation(item){const dialog=E('dialog',{},E('h2',{},'Borrar anotación'),E('p',{},'Se elimina el comentario y sus revisiones de la base actual. Los respaldos descargados previamente no cambian.'),E('div',{class:'dialog-actions'},E('button',{class:'quiet',onclick:()=>dialog.close()},'Cancelar'),E('button',{class:'primary',onclick:async()=>{try{await api('/api/annotation',{action:'delete',id:item.id,expectedRevision:item.data.annotationRevision||0});dialog.close();await reload();notify('Anotación borrada.');}catch(e){notify(e.message);}}},'Borrar anotación')));dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();}
function openStudyAnnotation(){
  if(view!=='study'||document.querySelector('dialog[open]')||document.body.classList.contains('tutor-open')||document.body.classList.contains('outline-open'))return;
  const s=window.getSelection();if(!s||s.isCollapsed||!s.rangeCount)return;
  const range=s.getRangeAt(0),start=range.startContainer.parentElement?.closest('.theory'),end=range.endContainer.parentElement?.closest('.theory');
  if(!start||start!==end)return;
  const quote=s.toString();if(!quote.trim())return;
  const prefix=range.cloneRange();prefix.selectNodeContents(start);prefix.setEnd(range.startContainer,range.startOffset);
  editingAnnotation=null;selection={blockId:start.dataset.blockId,quote,start:prefix.toString().length,end:prefix.toString().length+quote.length};
  $('selected-quote').textContent=visibleReadingText(quote);$('annotation-comment').value='';$('annotation-type').value='doubt';$('annotation-share').checked=true;$('annotation-dialog').showModal();$('annotation-comment').focus();
}
document.addEventListener('mouseup',event=>{if(!event.target.closest?.('mark[data-annotation-id],.pdf-highlight,.reading-highlight-actions,.notes-splitter'))captureReadingHighlight();});
$('annotation-form').addEventListener('submit',async ev=>{ev.preventDefault();try{const fields={comment:$('annotation-comment').value,type:$('annotation-type').value,shareWithTutor:$('annotation-share').checked};if(editingAnnotation){await api('/api/annotation',{...fields,action:'edit',id:editingAnnotation.id,expectedRevision:editingAnnotation.data.annotationRevision||0});}else{await saveEvent('annotation',{...selection,...fields});}$('annotation-dialog').close();editingAnnotation=null;window.getSelection()?.removeAllRanges();await reload();notify('Anotación guardada.');}catch(err){notify(err.message);}});
$('chat-form').addEventListener('submit',async ev=>{ev.preventDefault();const message=$('chat-input').value.trim();if(!message)return;$('chat-input').value='';try{await askTutor(message);}catch(err){$('chat-input').value=message;notify(err.message);}});
$('feedback-form').addEventListener('submit',async ev=>{ev.preventDefault();try{await saveEvent('feedback',{comment:$('feedback-text').value,kind:'lesson_feedback'});$('feedback-dialog').close();$('feedback-text').value='';notify('Feedback guardado para mejorar la continuación.');}catch(err){notify(err.message);}});
$('settings-form').addEventListener('submit',async ev=>{ev.preventDefault();try{
  const s={...state.settings,examDate:$('exam-date').value,weekdayMinutes:Number($('weekday-minutes').value),weekendMinutes:Number($('weekend-minutes').value),...providerFields(),model:$('custom-model').value.trim()||$('model-select').value,dailyOverrides:{...state.settings.dailyOverrides}};
  if($('override-date').value && $('override-minutes').value!=='')s.dailyOverrides[$('override-date').value]=Number($('override-minutes').value);
  await api('/api/settings',s);if($('api-key').value.trim())await api('/api/key',{...providerFields(),key:$('api-key').value.trim()});$('api-key').value='';$('settings-dialog').close();await reload();notify('Ajustes guardados.');
}catch(err){notify(err.message);}});
$('provider-select').addEventListener('change',()=>{$('provider-base-url').value=providerDetails().baseUrl;$('api-key').value='';updateProvider();});
$('provider-base-url').addEventListener('input',()=>{$('api-key').value='';$('quota-info').textContent='';});
$('model-select').addEventListener('change',()=>{$('custom-model').value='';});
$('load-models').addEventListener('click',async ev=>{
  ev.target.disabled=true;const fields=providerFields();
  try{await connectProviderKey(fields);const d=await api('/api/models?'+new URLSearchParams(fields));
    if(JSON.stringify(fields)!==JSON.stringify(providerFields()))return;
    const selected=$('model-select').value;setModelOptions(d.models,selected);notify('Catálogo de modelos actualizado.');
  }catch(err){notify(err.message);}finally{ev.target.disabled=false;}
});
$('check-quota').addEventListener('click',async()=>{
  const fields=providerFields();try{await connectProviderKey(fields);const d=await api('/api/quota?'+new URLSearchParams(fields));
    if(JSON.stringify(fields)!==JSON.stringify(providerFields()))return;
    $('quota-info').replaceChildren(document.createTextNode(d.freeRequests?`${d.freeRequests.remaining} consultas restantes de ${d.freeRequests.limit} en el día UTC.`:d.message||'OpenRouter no informó la cuota diaria de esta cuenta.'));
    if(d.url)$('quota-info').append(' ',E('a',{href:d.url,target:'_blank',rel:'noopener noreferrer'},'Abrir panel'));
  }catch(err){$('quota-info').textContent=err.message;}
});
$('disconnect-key').addEventListener('click',async()=>{try{await api('/api/key',{...providerFields(),key:''});$('api-key').value='';$('quota-info').textContent='Clave desconectada para este proveedor.';await reload();}catch(err){notify(err.message);}});
$('course-select').addEventListener('change',async()=>{window.ViewPosition?.capture();window.ViewPosition?.cancel();await flushTime();cid=$('course-select').value;lid=course().lessons[0].id;clockLesson=lid;render();window.ViewPosition?.restore({fresh:true});});
document.querySelectorAll('[data-view]').forEach(b=>b.addEventListener('click',()=>{$('mode-dialog').close();WorkspaceKeys.go(b.dataset.view).catch(e=>notify(e.message));}));
$('workspace-mode-button').addEventListener('click',()=>{$('mode-dialog').showModal();document.querySelector('#mode-dialog [data-view="'+view+'"]')?.focus();});
$('mode-export-lessons').addEventListener('click',()=>{$('mode-dialog').close();LessonExport.open();});
$('mode-settings').addEventListener('click',()=>{$('mode-dialog').close();showSettings();});
document.querySelectorAll('input[name="theme-mode"]').forEach(input=>input.addEventListener('change',()=>{if(input.checked)setAppearance({theme:input.value});}));
document.querySelectorAll('input[name="accent-color"]').forEach(input=>input.addEventListener('change',()=>{if(input.checked)setAppearance({accent:input.value});}));
document.querySelectorAll('input[name="tutor-channel"]').forEach(input=>input.addEventListener('change',()=>{if(input.checked)setTutorChannel(input.value);}));
$('mode-dialog').addEventListener('keydown',ev=>{if(state.settings.keyboardProfile!=='modal')return;if(ev.ctrlKey||ev.altKey||ev.metaKey)return;const buttons=[...document.querySelectorAll('#mode-dialog [data-view],#mode-export-lessons,#mode-settings')];if(['j','k','ArrowDown','ArrowUp'].includes(ev.key)){ev.preventDefault();const index=buttons.indexOf(document.activeElement),delta=['j','ArrowDown'].includes(ev.key)?1:-1;buttons[(index+delta+buttons.length)%buttons.length]?.focus();}const dest={e:'study',n:'notes',c:'notebook',p:'plan'}[ev.key];if(dest){ev.preventDefault();document.querySelector('#mode-dialog [data-view='+dest+']').click();}if(ev.key==='a'){ev.preventDefault();$('mode-settings').click();}});
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$ (b.dataset.close).close()));
$('settings-button').addEventListener('click',showSettings);$('export-button').addEventListener('click',()=>$('export-dialog').showModal());$('feedback-button').addEventListener('click',()=>$('feedback-dialog').showModal());
$('refresh-tutor').addEventListener('click',()=>refreshTutorConversation());
$('import-button').addEventListener('click',()=>$('course-file').click());
$('course-file').addEventListener('change',async ev=>{try{const file=ev.target.files[0];if(!file)return;if(file.size>8_000_000)throw new Error('El archivo supera 8 MB.');const data=JSON.parse(await file.text());if(data.courses&&data.events){await api('/api/restore',data);notify('Historial incorporado, sin duplicar eventos.');}else{const result=await api('/api/course',data);cid=result.id;lid=null;notify('Curso importado. Se conserva tu historial anterior.');}await reload();}catch(err){notify(err.message);}finally{ev.target.value='';}});
reload().then(async()=>{clockLesson=lid;activeStarted=Date.now();await GlosaHome.boot();}).catch(async err=>{$('main').replaceChildren(E('h1',{},'No se pudo abrir el pliego'),E('p',{},err.message),E('button',{class:'quiet',onclick:()=>GlosaRoom.open()},'Abrir Margen'),E('button',{class:'text-button',onclick:()=>GlosaRoom.activate('primer-trazo')},'Volver a Primer trazo'));await GlosaHome.show();});

$('lesson-search').addEventListener('input',e=>{for(const b of document.querySelectorAll('.lesson-link'))b.hidden=!b.textContent.toLowerCase().includes(e.target.value.toLowerCase());});

const focusClock = FocusClockFactory.createClock({
  storage: localStorage,
  lock: async fn => {
    if(!navigator.locks) throw Error('Este navegador no permite coordinar el reloj entre pestañas.');
    return navigator.locks.request('glosa-focus-writer', fn);
  },
  context: () => {
    const note=view==='notes'?window.ClassNotes?.current?.():null;
    const selectedCourse=state?course():null,selectedLesson=selectedCourse?lesson():null;
    return {roomId:GlosaRoom.id,courseId:selectedCourse?.id||'',lessonId:note?'':selectedLesson?.id||'',
      courseVersion:selectedCourse?.version||'',noteId:note?.id||'',view:document.getElementById('home-dialog')?.open?'margen':view,
      title:note?.title||selectedLesson?.title||state?.room?.title||'Mi estudio'};
  },
  timezone:()=>Intl.DateTimeFormat().resolvedOptions().timeZone||'America/Argentina/Buenos_Aires',
  visible:()=>!document.hidden,
  send: async (roomId,body) => {
    const response=await fetch('/api/study-segments',{method:'POST',headers:{'Content-Type':'application/json','X-Glosa-Room':roomId},body:JSON.stringify(body),keepalive:true});
    if(!response.ok) throw Error('No se pudo guardar el tiempo.');
  }
});
window.FocusClock=focusClock;
const focusPanel=FocusPanel.mount(focusClock);
async function toggleStudySession(){focusPanel.open();}
$('session-button').textContent='Abrir temporizador';
$('session-clock').textContent='Foco, descansos y estadísticas';
$('session-button').addEventListener('click',()=>toggleStudySession().catch(e=>notify(e.message)));
setInterval(()=>focusClock.tick().catch(e=>notify(e.message)),1000);
setInterval(()=>focusClock.sync(),15000);
document.addEventListener('visibilitychange',()=>focusClock.visibilityChanged().catch(e=>notify(e.message)));
window.addEventListener('pagehide',()=>focusClock.flush().catch(()=>{}));
window.addEventListener('online',()=>focusClock.sync());
window.addEventListener('storage',event=>{if(event.key==='glosa-focus-v1')focusClock.refresh();});
focusClock.visibilityChanged().catch(e=>notify(e.message));

$('chat-input').addEventListener('input',()=>{const input=$('chat-input');input.style.height='auto';input.style.height=Math.min(160,input.scrollHeight)+'px';});

// Activity metadata only; the tracker never reads the contents of a note.
window.GlosaActivityContext=()=>{
  if(!state||!['study','notes','notebook'].includes(view))return null;
  const note=view==='notes'?window.ClassNotes?.current?.():null;
  return {roomId:GlosaRoom.id,courseId:view==='study'?cid||'':'',lessonId:view==='study'?lid||'':'',courseVersion:view==='study'?course()?.version||'':'',view,noteId:note?.id||''};
};
