'use strict';
window.WorkspaceKeys=(()=>{
  let mode='NORMAL',prefix='',hint='',hints=[],lastInput=null,panel=null,pending=Promise.resolve();
  let leaderSheet=null,visualRoot=null,visualKind='character';
  const profile=()=>state?.settings?.keyboardProfile||'modal';
  const isText=el=>el?.matches('input:not([type=radio]):not([type=checkbox]):not([type=range]),textarea,[contenteditable=true]');
  const shown=el=>el.getClientRects().length&&!el.disabled&&!el.hidden&&!el.classList.contains('vim-source');
  const activeDialog=()=>[...document.querySelectorAll('dialog[open]')].at(-1);
  let returnFocus=null;
  function closePanels(restore=true){
    const wasOpen=document.body.classList.contains('outline-open')||document.body.classList.contains('tutor-open');
    document.body.classList.remove('outline-open','tutor-open','focus-tutor');window.ClassNotes?.closeList();
    document.getElementById('course-outline').inert=true;document.getElementById('tutor-panel').inert=true;
    document.getElementById('outline-button').setAttribute('aria-expanded','false');document.getElementById('tutor-dock').setAttribute('aria-expanded','false');
    document.getElementById('panel-backdrop').hidden=true;panel=null;
    if(restore&&wasOpen)(returnFocus?.isConnected&&shown(returnFocus)?returnFocus:document.getElementById('main')).focus({preventScroll:true});
  }
  function openPanel(kind,focus=true){
    const origin=document.activeElement;closePanels(false);returnFocus=origin;
    const id=kind==='outline'?'course-outline':'tutor-panel';
    document.body.classList.add(kind+'-open');document.getElementById(id).inert=false;
    document.getElementById(kind==='outline'?'outline-button':'tutor-dock').setAttribute('aria-expanded','true');
    document.getElementById('panel-backdrop').hidden=false;
    panel=document.getElementById(id);panel.tabIndex=-1;
    if(focus)document.getElementById(kind==='outline'?'lesson-search':'chat-input').focus();
  }
  function sync(){
    if(!state)return;
    if(state.settings.focusMode){leaderSheet?.remove();leaderSheet=null;}
    if(profile()!=='modal')cancelLeader();
    window.VimEditors?.setProfile(profile()==='modal');
    document.body.classList.toggle('global-focus',state.settings.focusMode);
    document.getElementById('global-focus-button').textContent=state.settings.focusMode?'Foco activo':'Foco';
    document.getElementById('global-focus-button').setAttribute('aria-pressed',String(!!state.settings.focusMode));
    document.body.dataset.workspaceView=view;
    document.getElementById('environment-context').hidden=view==='notes';
    document.getElementById('notes-heading').hidden=view!=='notes';
    document.getElementById('workspace-context').textContent=(course()?.title||'')+' / '+(view==='notes'?'Apuntes':lesson()?.unit||'Lecciones');
    document.getElementById('global-keyboard-profile').value=profile();
    document.getElementById('global-mode').textContent=profile()==='modal'?mode:'Teclado libre';
    const kind=VimEditors.get(document.activeElement)?.visualKind()||(visualRoot?visualKind:null);
    document.getElementById('global-mode').title=mode==='VISUAL'?({character:'Selección por carácter',line:'Selección por línea',block:'Selección rectangular'}[kind]||'Selección de texto'):'';
    document.getElementById('global-keyboard-hint').textContent=profile()==='modal'?'Espacio n/e/t · Espacio z Foco · Espacio : Comandos':'Tab · Vimium';
  }
  async function preference(change){
    pending=pending.catch(()=>{}).then(async()=>{
      const next={keyboardProfile:profile(),focusMode:state.settings.focusMode,...change};
      const saved=await api('/api/preferences',next);state.settings={...state.settings,...saved};sync();
    });
    try{await pending;}catch(e){notify(e.message);sync();}
  }
  async function toggleFocus(){await preference({focusMode:!state.settings.focusMode});}
  async function go(next){
    window.ViewPosition?.capture();if(view==='notes')await ClassNotes.flush();await flushTime();endVisual();cancelLeader();view=next;render();
    closePanels(false);mode='NORMAL';sync();if(next==='notes')ClassNotes.focusBody();else document.getElementById('main').focus({preventScroll:true});if(window.ViewPosition)ViewPosition.restore();else window.scrollTo({top:0});
  }
  function focusPanel(selector){
    const el=document.querySelector(selector);if(!el)return;
    if(selector==='#tutor-panel')openPanel('tutor',false);
    if(selector==='.sidebar')openPanel('outline',false);
    if(selector==='#main')closePanels(false);
    if(selector==='.notes-sidebar')ClassNotes.openList();
    panel=el;el.tabIndex=-1;el.focus();el.scrollIntoView({block:'nearest'});
  }
  function input(){const el=view==='notes'?ClassNotes.edit():(lastInput?.isConnected&&shown(lastInput)&&isText(lastInput)?lastInput:document.querySelector('#main textarea'));if(el){const details=el.closest('details');if(details)details.open=true;el.focus();VimEditors.enterInsert(document.activeElement);mode='INSERTAR';sync();}}
  function leaveEditor(element){
    const source=VimEditors.sourceFor(element);if(view==='notes'&&source?.matches('#class-note-content,.note-cell-content'))ClassNotes.followCursor();
    element.blur();mode='NORMAL';prefix='';
    const dialog=activeDialog();if(dialog){dialog.close();sync();return;}
    closePanels(false);
    if(view==='notes'){const reader=document.querySelector('.source-reader');focusPanel(reader&&shown(reader)?'.source-reader':'.note-editor');}else{const target=element.closest('.exercise-group,#tutor-panel')||document.getElementById('main');target.tabIndex=-1;target.focus({preventScroll:true});}
    sync();
  }
  function leaderCommands(){return [
    ['n','Apuntes',()=>go('notes')],['e','Estudiar',()=>go('study')],['c','Cuaderno',()=>go('notebook')],['p','Plan',()=>go('plan')],
    ['/',view==='notes'?'Buscar apuntes':'Índice de lecciones',()=>view==='notes'?ClassNotes.openList():openPanel('outline')],
    ['t','Tutor',()=>view==='notes'?ClassNotes.openTutor():openPanel('tutor')],
    ['x','Contexto del tutor',async()=>{if(view==='notes'){await ClassNotes.flush();await TutorContext.open(ClassNotes.contextTarget());}else await TutorContext.open(TutorContext.studyTarget(),document.getElementById('chat-input').value);}],
    ['v','Visual · caracteres',()=>selectVisual()],['V','Visual · líneas',()=>selectVisual('line')],
    ['f','Abrir PDF',async()=>{if(view!=='notes')await go('notes');await ClassNotes.openPdf();}],
    ...(view==='notes'&&ClassNotes.mode()==='parallel'?[['q','Cerrar PDF',()=>ClassNotes.closePdf()],['b','Nueva celda',()=>ClassNotes.newPageCell()]]:[]),
    ['z',state.settings.focusMode?'Salir de Foco':'Foco',toggleFocus],[':','Comandos',palette],['a','Ajustes',showSettings],['m','Cambiar de modo',()=>document.getElementById('workspace-mode-button').click()]
  ];}
  async function leader(key){
    try{await leaderCommands().find(command=>command[0]===key)?.[2]();}catch(error){notify(error.message);}
  }
  function cancelLeader(){if(prefix==='leader')prefix='';leaderSheet?.remove();leaderSheet=null;}
  function showLeader(){
    if(state.settings.focusMode)return;
    leaderSheet=E('aside',{class:'leader-cheatsheet','aria-label':'Atajos de la tecla líder'},
      E('div',{class:'leader-cheatsheet-heading'},E('kbd',{},'Espacio'),E('span',{},'Atajos')),
      E('div',{class:'leader-cheatsheet-keys'},...leaderCommands().map(([key,label])=>E('button',{type:'button',onclick:()=>{cancelLeader();leader(key);}},E('kbd',{},key),E('span',{},label)))),
      E('p',{},'Esc cerrar'));
    // Keep the editor's cursor and render above a modal when its text field owns Vim.
    leaderSheet.addEventListener('pointerdown',event=>event.preventDefault());
    (activeDialog()||document.body).append(leaderSheet);
  }
  function clearHints(){for(const h of hints)h.badge.remove();hints=[];hint='';if(mode==='ENLACES')mode='NORMAL';sync();}
  function linkHints(){
    clearHints();const root=activeDialog()||document;
    const controls=[...root.querySelectorAll('button,[role=button],a[href],input:not([type=hidden]),select,textarea,summary,[contenteditable=true]')].filter(el=>{const r=el.getBoundingClientRect();return shown(el)&&!el.closest('[inert]')&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;});
    const letters='asdfghjklqwertyuiopzxcvbnm';
    const width=Math.max(2,Math.ceil(Math.log(Math.max(1,controls.length))/Math.log(letters.length)));
    controls.forEach((el,i)=>{let n=i,code='';for(let j=0;j<width;j++){code=letters[n%letters.length]+code;n=Math.floor(n/letters.length);}const rect=el.getBoundingClientRect();const badge=E('span',{class:'key-hint',style:`top:${Math.max(0,rect.top)}px;left:${Math.max(0,rect.left)}px`},code);(activeDialog()||document.body).append(badge);hints.push({code,el,badge});});
    mode='ENLACES';sync();
  }
  function activateHint(key){hint+=key;const matches=hints.filter(h=>h.code.startsWith(hint));for(const h of hints)h.badge.hidden=!matches.includes(h);
    if(!matches.length){clearHints();return;}
    const exact=matches.find(h=>h.code===hint);if(exact){const el=exact.el;clearHints();el.focus();if(el.matches('button,[role=button],a,summary,input[type=radio],input[type=checkbox]'))el.click();}
  }
  function endVisual(save=false){if(!visualRoot)return;if(save)Promise.resolve(captureReadingHighlight()).catch(error=>notify(error.message));window.getSelection()?.removeAllRanges();visualRoot=null;mode='NORMAL';}
  function selectVisual(kind='character'){
    let editor=VimEditors.get(document.activeElement);
    if(!editor&&view==='notes'&&!document.activeElement?.closest('.source-reader'))editor=VimEditors.get([...document.querySelectorAll('.note-editor .cm-content')].find(shown));
    if(editor){editor.enterVisual(kind);return;}
    const root=view==='notes'?document.querySelector('.textLayer'):document.activeElement?.closest('.theory')||document.querySelector('.theory');
    if(!root){notify('No hay texto seleccionable en este panel.');return;}
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let text=walker.nextNode();while(text&&!text.textContent.trim())text=walker.nextNode();if(!text)return;
    const s=window.getSelection();
    if(s.isCollapsed||!root.contains(s.anchorNode)||!root.contains(s.focusNode)){
      const range=document.createRange();range.setStart(text,0);range.setEnd(text,Math.min(1,text.length));s.removeAllRanges();s.addRange(range);
    }
    visualRoot=root;visualKind=kind;if(kind==='line')s.modify?.('extend','forward','lineboundary');mode='VISUAL';sync();
  }
  function moveVisual(key){
    const selection=window.getSelection();if(!selection.modify){notify('Usá Shift+flechas para extender la selección en este navegador.');return;}
    const saved=[selection.anchorNode,selection.anchorOffset,selection.focusNode,selection.focusOffset];
    const backward=['h','k','b','0'].includes(key);
    selection.modify('extend',backward?'backward':'forward',['0','$'].includes(key)?'lineboundary':['w','b'].includes(key)?'word':['j','k'].includes(key)?'line':'character');
    if(visualKind==='line')selection.modify('extend',backward?'backward':'forward','lineboundary');
    if(!visualRoot.contains(selection.focusNode))selection.setBaseAndExtent(...saved);
  }
  function annotate(){if(view==='notes')ClassNotes.annotate(true);else if(view==='study')openStudyAnnotation();}
  function commands(){return [
     ['Abrir Margen','g o',()=>GlosaRoom.open()],['Contexto y evidencia de la última respuesta','',showTutorDetails],['Feedback de la lección','',()=>document.getElementById('feedback-dialog').showModal()],['Primer trazo · Tutorial','',()=>GlosaRoom.activate('primer-trazo')],
    ['Cambiar de modo','g m',()=>document.getElementById('workspace-mode-button').click()],['Estudiar','g e',()=>go('study')],['Notas de clase y lectura','g n',()=>go('notes')],['Cuaderno de dudas','g c',()=>go('notebook')],['Mi plan','g p',()=>go('plan')],
    ['Iniciar / pausar sesión de estudio','',toggleStudySession],['Perfil de teclado','',()=>{showSettings();document.getElementById('global-keyboard-profile').focus();}],
    ['Alternar foco','z',toggleFocus],['Ajustes globales','g a',showSettings],['Exportar historial','',()=>document.getElementById('export-dialog').showModal()],
    ['Índice de lecciones','g l /',async()=>{if(view==='notes')await go('study');openPanel('outline');}],
    ['Ir al tutor','g t',async()=>{if(view==='notes'){ClassNotes.openTutor();return;}await go('study');openPanel('tutor');}],
    ['Gestionar contexto del tutor','g x',async()=>{if(view==='notes'){await ClassNotes.flush();await TutorContext.open(ClassNotes.contextTarget());}else await TutorContext.open(TutorContext.studyTarget(),document.getElementById('chat-input').value);}],
    ['Agregar / abrir celda de página','g b',async()=>{await go('notes');ClassNotes.newPageCell();}],
    ['Abrir PDF','g f',async()=>{await go('notes');await ClassNotes.openPdf();}],['Renombrar apunte','g r',async()=>{if(view!=='notes')await go('notes');ClassNotes.rename();}],['Propiedades del apunte','',()=>ClassNotes.properties()],['Eliminar apunte','',()=>ClassNotes.deleteNote()],['Descargar apunte Markdown','',()=>ClassNotes.exportNote()],
    ['Nueva nota','',async()=>{await go('notes');await ClassNotes.create();}],['Adjuntar PDF a la nota','',async()=>{await go('notes');if(!document.getElementById('class-note-content'))await ClassNotes.create();ClassNotes.upload();}],
    ...(view==='notes'&&ClassNotes.mode()==='parallel'?[['Cerrar PDF y volver a Markdown','',()=>ClassNotes.closePdf()]]:[]),
['Preguntar al tutor sobre el apunte','Ctrl+Shift+Enter',()=>ClassNotes.askCurrent()],['Anotar selección / página','a',annotate],['Seleccionar texto','v',selectVisual],
    ['Consultas del apunte','',()=>ClassNotes.showRecords('history')],['Anotaciones del apunte','',()=>ClassNotes.showRecords('anchors')],
    ['Redimensionar libro y notas','r',()=>{if(view==='notes'&&ClassNotes.startResize()){mode='REDIMENSIONAR';sync();}}],['Equilibrar libro y notas','',()=>ClassNotes.resetSplit()],
    ['Acercar PDF','+',()=>ClassNotes.zoomBy(1)],['Alejar PDF','-',()=>ClassNotes.zoomBy(-1)],
    ['Página anterior del PDF','[',()=>ClassNotes.changePage(-1)],['Página siguiente del PDF',']',()=>ClassNotes.changePage(1)],
    ['Ayuda de teclado','?',help]
  ];}
  function palette(){
    if(activeDialog())return;const dialog=E('dialog',{class:'command-palette'}),search=E('input',{type:'search','aria-label':'Buscar comando',placeholder:'Escribí un comando…'}),list=E('div');
    let results=[],index=0;
    function group(name){if(/PDF|página|celda|libro|Markdown/.test(name))return 'PDF y lectura';if(/apunte|nota|Anot|Propiedades|Eliminar|Descargar/.test(name))return 'Escritura';if(/tutor|Contexto|conversación|Feedback/.test(name))return 'Tutor';return 'Navegación y entorno';}
    function draw(){results=commands().filter(c=>c[0].toLowerCase().includes(search.value.toLowerCase()));index=Math.min(index,Math.max(0,results.length-1));const rows=[];let previous='';results.forEach((c,i)=>{const section=group(c[0]);if(section!==previous){rows.push(E('div',{class:'command-group-label'},section));previous=section;}rows.push(E('button',{class:'command-item'+(i===index?' active':''),onclick:()=>run(c)},c[0],E('kbd',{},c[1])));});list.replaceChildren(...rows);}
    async function run(c){dialog.close();try{await c[2]();}catch(e){notify(e.message);}}
    search.addEventListener('input',()=>{index=0;draw();});search.addEventListener('keydown',e=>{if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();index=(index+(e.key==='ArrowDown'?1:results.length-1))%Math.max(1,results.length);draw();}else if(e.key==='Enter'&&results[index]){e.preventDefault();run(results[index]);}});
    dialog.append(search,list,E('p',{class:'muted'},'↑ ↓ elegir · Enter ejecutar · Esc cerrar'));dialog.addEventListener('close',()=>{dialog.remove();mode='NORMAL';sync();});document.body.append(dialog);dialog.showModal();draw();search.focus();
  }
  function help(){
    const section=(title,text)=>E('details',{class:'keyboard-help-section'},E('summary',{},title),E('p',{},text));
    const dialog=E('dialog',{class:'keyboard-help-dialog'},E('h2',{},'Ayuda de teclado'),E('p',{class:'muted'},'Atajos organizados por tarea. Tab y Shift+Tab también recorren los controles.'),
      section('Navegación y entorno','g e Estudiar · g n Notas · g c Cuaderno · g p Plan · g a Ajustes · g l Índice. Espacio muestra atajos rápidos; : abre comandos con búsqueda; f activa controles visibles. z alterna Foco. Ctrl+Espacio y h/l cambia de panel; j/k desplaza el panel. El perfil Vimium / estándar deja estos atajos a la extensión.'),
      section('Escritura','i entra en INSERTAR y Esc vuelve a NORMAL dentro del texto; un segundo Esc devuelve el foco a la plataforma. Ctrl+s guarda la nota; Ctrl+Enter envía el formulario. En Vim: v selecciona caracteres, V líneas, Ctrl+v bloques; h/j/k/l y w/b mueven; y copia, d borra y c cambia. Espacio y : abren la paleta; dentro del editor : abre Ex y :w guarda.'),
      section('PDF y lectura','g f abre un PDF al lado de las notas; g b abre una celda de página. [/] cambia de página o lección. +/− acerca o aleja el PDF; h/l desplaza horizontalmente; j/k pasa de página al llegar al borde. r ajusta el ancho del libro y las notas; h/l ajusta, Shift+h/l da pasos mayores, = equilibra y Esc o Enter termina. También podés arrastrar o hacer doble clic en la separación.'),
      section('Tutor','g t abre la conversación y g x gestiona el contexto. Ctrl+Shift+Enter guarda y pregunta desde el apunte o una anotación. a permite anotar una selección. El canal elegido en Ajustes determina si se envía por API o queda pendiente para MCP.'),
      E('p',{class:'muted'},'Vim integrado también habilita movimientos y modos en apuntes, respuestas y mensajes. Espacio es la tecla líder en NORMAL; Esc cierra esta ayuda.'),E('button',{class:'primary',onclick:()=>dialog.close()},'Cerrar'));
    dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
  }
  document.addEventListener('focusin',e=>{cancelLeader();prefix='';if(mode==='REDIMENSIONAR'&&!e.target.matches('.notes-splitter')){ClassNotes.endResize();mode='NORMAL';}if(e.target.matches('.source-reader,#pdf-scroll'))panel=e.target.closest('.source-reader');if(isText(e.target)){lastInput=e.target;mode=VimEditors.get(e.target)?.mode()||'INSERTAR';}else if(mode==='INSERTAR')mode='NORMAL';sync();});
  document.addEventListener('glosa-vim-mode',e=>{if(profile()==='modal'&&e.detail.element===document.activeElement){mode=e.detail.mode;if(mode==='INSERTAR'){cancelLeader();prefix='';}sync();}});
  document.addEventListener('pointerdown',e=>{if(!leaderSheet?.contains(e.target))cancelLeader();},true);
  window.addEventListener('blur',cancelLeader);
  // Capture the application leader before Vim interprets Space as a text motion.
  document.addEventListener('keydown',async e=>{
    if(state&&e.ctrlKey&&e.key==='Enter'&&!e.shiftKey&&!e.altKey&&!e.metaKey&&!e.isComposing&&VimEditors.get(e.target)){
      const group=e.target.closest('.exercise-group'),form=e.target.closest('form');
      if(group||form){e.preventDefault();e.stopImmediatePropagation();if(group)group.querySelector('.group-conversation')?.click();else form.requestSubmit();return;}
    }
    if(!state||profile()!=='modal')return;
    if(e.isComposing||e.altKey||e.metaKey||e.ctrlKey){cancelLeader();return;}
    const editor=VimEditors.get(e.target),inContent=editor&&editor.element===e.target;
    if(inContent)e.glosaVimBefore=editor.mode();
    if(prefix==='leader'){if(['Shift','Control','Alt','Meta'].includes(e.key))return;e.preventDefault();e.stopImmediatePropagation();cancelLeader();if(e.key!=='Escape')await leader(e.shiftKey?e.key.toUpperCase():e.key);return;}
    const nativeSpace=e.target.matches('button,input[type=radio],input[type=checkbox],select,summary,[role=button]');
    if(e.key===' '&&!nativeSpace&&(inContent?editor.mode()==='NORMAL':!isText(e.target)&&!activeDialog()&&mode==='NORMAL')){e.preventDefault();e.stopImmediatePropagation();prefix='leader';showLeader();}
  },true);
  document.addEventListener('keydown',async e=>{
    if(state&&view==='notes'&&e.ctrlKey&&e.shiftKey&&e.key==='Enter'&&!e.isComposing&&!e.altKey&&!e.metaKey){
      const dialog=activeDialog(),form=e.target.closest('form'),ask=form?.querySelector('[data-ask-tutor]');
      if(ask){e.preventDefault();if(!ask.disabled)form.requestSubmit(ask);return;}
      if(!dialog){e.preventDefault();ClassNotes.askCurrent();return;}
    }
    if(state&&view==='notes'&&e.ctrlKey&&e.key.toLowerCase()==='s'&&!e.isComposing&&!e.altKey&&!e.metaKey){e.preventDefault();ClassNotes.followCursor();try{await ClassNotes.flush();}catch(err){notify(err.message);}return;}
    if(!state||profile()!=='modal'||e.isComposing||e.altKey||e.metaKey)return;
    if(e.target.closest?.('.cm-editor')){
      if(e.key==='Escape'&&e.glosaVimBefore==='NORMAL'){e.preventDefault();leaveEditor(e.target);return;}
      if(e.defaultPrevented||e.key==='Escape')return;
    }
    if(panel&&!panel.isConnected)panel=null;
    const ctrl=e.ctrlKey,key=e.key;
    if(mode==='REDIMENSIONAR'&&!activeDialog()){
      if(key==='Escape'||key==='Enter'){e.preventDefault();ClassNotes.endResize();mode='NORMAL';prefix='';focusPanel('.source-reader');sync();return;}
      if(!ctrl){e.preventDefault();if(['h','H','ArrowLeft'].includes(key))ClassNotes.resizeSplit(e.shiftKey?-.1:-.02);else if(['l','L','ArrowRight'].includes(key))ClassNotes.resizeSplit(e.shiftKey ? 0.1 : 0.02);else if(key==='='||key==='0')ClassNotes.resetSplit();sync();return;}
    }
    if(key==='Escape'){endVisual(true);clearHints();cancelLeader();prefix='';mode='NORMAL';const dialog=activeDialog();if(dialog){e.preventDefault();dialog.close();}else{if(view==='notes'&&e.target.matches?.('#class-note-content,.note-cell-content'))ClassNotes.followCursor();const editor=view==='notes'&&e.target.closest?.('.note-editor');e.target.blur?.();closePanels();if(editor){e.preventDefault();const reader=document.querySelector('.source-reader');focusPanel(reader&&shown(reader)?'.source-reader':'.note-editor');}}sync();return;}
    if(ctrl&&key==='Enter'&&isText(e.target)){const group=e.target.closest('.exercise-group');if(group){e.preventDefault();group.querySelector('.group-conversation')?.click();return;}const form=e.target.closest('form');if(form){e.preventDefault();form.requestSubmit();}return;}
    if(mode==='ENLACES'&&!ctrl){e.preventDefault();activateHint(key.toLowerCase());return;}
    if(ctrl&&!e.shiftKey&&(key===' '||e.code==='Space')&&!activeDialog()){e.preventDefault();ClassNotes.endResize();if(view==='notes'&&e.target.matches?.('#class-note-content,.note-cell-content'))ClassNotes.followCursor();panel=e.target.closest?.('.notes-sidebar,.source-reader,.note-editor,.sidebar,#main,#tutor-panel')||panel;e.target.blur?.();mode='NORMAL';prefix='panel';sync();return;}
    if(isText(e.target)||e.target.matches?.('select')||activeDialog())return;
    if(ctrl)return;
    if(prefix){e.preventDefault();const p=prefix;prefix='';if(p==='g'){const dest={e:'study',n:'notes',c:'notebook',p:'plan'}[key];if(dest)try{await go(dest);}catch(err){notify(err.message);}if(key==='b'){await go('notes');ClassNotes.newPageCell();}if(key==='f'){await go('notes');await ClassNotes.openPdf();}if(key==='r'&&view==='notes')ClassNotes.rename();if(key==='o')await GlosaRoom.open();if(key==='a')showSettings();if(key==='m')document.getElementById('workspace-mode-button').click();if(key==='x'){if(view==='notes'){await ClassNotes.flush();await TutorContext.open(ClassNotes.contextTarget());}else await TutorContext.open(TutorContext.studyTarget(),document.getElementById('chat-input').value);}if(key==='t'){if(view==='notes')ClassNotes.openTutor();else{await go('study');openPanel('tutor');}}if(key==='l'){if(view==='notes')await go('study');openPanel('outline');}}else if(p==='panel'){if(key==='r'&&view==='notes'){if(ClassNotes.startResize())mode='REDIMENSIONAR';sync();return;}const selectors=view==='notes'?['.notes-sidebar','.source-reader','.note-editor']:['.sidebar','#main','#tutor-panel'];const panels=selectors.map(s=>document.querySelector(s)).filter(p=>p&&shown(p));let idx=panels.findIndex(p=>p===panel);if(idx<0&&view==='notes'){idx=panels.findIndex(p=>p.matches('.source-reader'));if(idx<0)idx=panels.findIndex(p=>p.matches('.note-editor'));}idx=key==='h'?Math.max(0,idx-1):key==='l'?Math.min(panels.length-1,idx+1):(idx+1)%panels.length;focusPanel(selectors.find(s=>document.querySelector(s)===panels[idx]));}return;}
    if(mode==='NORMAL'&&view==='notes'&&key==='r'){e.preventDefault();if(ClassNotes.startResize())mode='REDIMENSIONAR';sync();return;}
    if(mode==='NORMAL'&&view==='notes'&&['+','=','-'].includes(key)&&document.getElementById('pdf-scroll')&&(!panel||panel.matches('.source-reader'))){e.preventDefault();await ClassNotes.zoomBy(key==='-'?-1:1);sync();return;}
    if(mode==='VISUAL'&&visualRoot){
      if(['h','l','j','k','w','b','0','$'].includes(key)){e.preventDefault();moveVisual(key);return;}
      if(key==='y'){e.preventDefault();const text=window.getSelection().toString();try{await navigator.clipboard.writeText(text);endVisual(true);sync();}catch(error){notify('No se pudo copiar la selección: '+error.message);}return;}
      if(key==='v'&&visualKind==='character'||key==='V'&&visualKind==='line'){e.preventDefault();endVisual(true);sync();return;}
    }
    if(['g','i','f',':','?','z','v','V','a','/','j','k','h','l','[',']'].includes(key))e.preventDefault();else return;
    if(key==='g')prefix='g';else if(key==='i')input();else if(key==='f')linkHints();else if(key===':')palette();else if(key==='?')help();else if(key==='z')toggleFocus();else if(key==='v'||key==='V')selectVisual(key==='V'?'line':'character');else if(key==='a')annotate();
    else if(key==='/'){if(view!=='notes')openPanel('outline');else ClassNotes.openList();}
    else if(key==='j'||key==='k'){if(view==='notes'&&panel?.matches('.note-editor')&&document.getElementById('note-notebook')){ClassNotes.moveCell(key==='j'?1:-1);sync();return;}if(view==='notes'&&document.getElementById('pdf-scroll')&&(!panel||panel.matches('.source-reader'))){try{await ClassNotes.readStep(key==='j'?1:-1);}catch(err){notify(err.message);}sync();return;}const target=panel||document.getElementById(view==='notes'?'pdf-scroll':'main');if(target&&target.scrollHeight>target.clientHeight)target.scrollBy({top:key==='j'?100:-100});else window.scrollBy({top:key==='j'?100:-100});}
    else if(key==='h'||key==='l'){const reader=view==='notes'&&document.getElementById('pdf-scroll');if(reader&&(!panel||panel.matches('.source-reader'))){reader.scrollBy({left:key==='h'?-100:100,behavior:'instant'});sync();return;}const root=panel||document.getElementById('main');const items=[...root.querySelectorAll('button,a,input,select,textarea,summary,.theory,[contenteditable=true]')].filter(shown);const idx=items.indexOf(document.activeElement);items[(idx+(key==='l'?1:items.length-1))%items.length]?.focus();}
    else if(view==='notes'){try{await ClassNotes.changePage(key==='['?-1:1);}catch(err){notify(err.message);}}else if(view==='study'){const lessons=course().lessons,index=lessons.findIndex(l=>l.id===lid);const next=lessons[index+(key==='['?-1:1)];if(next)await chooseLesson(next.id);}
    sync();
  });
  document.getElementById('note-name-button').addEventListener('click',()=>ClassNotes.rename());
  document.getElementById('notes-list-button').addEventListener('click',()=>document.body.classList.contains('notes-list-open')?ClassNotes.closeList():ClassNotes.openList());
  document.getElementById('global-focus-button').addEventListener('click',toggleFocus);
  document.getElementById('global-keyboard-profile').addEventListener('change',e=>preference({keyboardProfile:e.target.value}));
  document.getElementById('global-help-button').addEventListener('click',help);
  document.getElementById('global-command-button').addEventListener('click',palette);
  document.getElementById('outline-button').addEventListener('click',async()=>{if(view==='notes')await go('study');document.body.classList.contains('outline-open')?closePanels():openPanel('outline');});
  document.getElementById('tutor-dock').addEventListener('click',()=>openPanel('tutor'));
  for(const id of ['outline-close','tutor-close','panel-backdrop'])document.getElementById(id).addEventListener('click',()=>closePanels());
  // Escape also dismisses panels when the browser/Vimium owns the other keys.
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&profile()!=='modal'){const dialog=activeDialog();if(dialog){e.preventDefault();dialog.close();}else closePanels();}});
  return {sync,go,help,palette,clearVisual:()=>{endVisual();sync();},closePanels,leaveEditor,profile,openTutor:(focus=true)=>openPanel('tutor',focus)};
})();
