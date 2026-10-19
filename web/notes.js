'use strict';
window.ClassNotes=(()=>{
  let currentId=null, current=null, pristineId=null, baseline=null, saveTimer=null, serial=Promise.resolve(), saving=false, generation=0;
  let documentLoad=null, documentGeneration=0;
  let cursorTimer=null,resizeTimer=null,readerObserver=null;
  let liveEditor=null,prefaceEditor=null;
  let query='', folder='', pdf=null, loadingPdf=null, renderTask=null, pdfId=null, pageNumber=1, zoom=1, pdfSelection=null;
  const data=()=>state.library;
  const conversations=()=>data()?.noteTutor||[];
  function questionContext(anchor=null){if(!anchor)followNoteCursor(activeWritingInput(),false);const scope=anchor?(anchor.scope||'page'):document.activeElement.closest?.('.note-preface')?'general':writingScope();return {noteId:current.id,anchorId:anchor?.id||null,scope,page:anchor?.page??(scope==='page'?(current.page||1):null)};}
  function conversationItem(q){
    const context=q.context,label=context.scope==='page'?'Página PDF '+context.page:'Apunte general / independiente';
    return E('details',{class:'note-tutor-entry'},E('summary',{},label+' · '+dateLabel(q.createdAt)),E('p',{class:'muted'},'Ayuda recibida · no acredita comprensión independiente'),E('p',{class:'note-tutor-question'},q.message),q.reply?tutorContent(q.reply):E('p',{},q.error||(q.channel==='mcp'?'Consulta pendiente para el canal MCP externo.':'Consulta pendiente o interrumpida. Podés preguntar de nuevo.')),q.truncated?E('p',{class:'muted'},'La respuesta llegó incompleta. Podés pedirle que continúe.'):null,q.tutorContext&&window.TutorContext?TutorContext.used(q.tutorContext):null);
  }
  function renderTutorHistory(){
    const target=document.getElementById('note-tutor-history');if(!target||!current)return;
    const records=conversations().filter(q=>q.noteId===current.id);
    target.replaceChildren();if(records.length)target.append(E('details',{},E('summary',{},'Consultas del apunte · '+records.length),...records.map(conversationItem)));
  }
  function showRecords(kind){
    const target=document.getElementById(kind==='history'?'note-tutor-history':'note-anchors');if(!target)return;
    const origin=target.parentElement,next=target.nextSibling,focus=document.activeElement;
    const dialog=E('dialog',{class:'note-records-dialog'},E('h2',{},kind==='history'?'Consultas del apunte':'Anotaciones del apunte'),target,E('button',{type:'button',class:'text-button',onclick:()=>dialog.close()},'Cerrar · Esc'));
    if(!target.hasChildNodes())target.append(E('p',{class:'muted'},'Todavía no hay registros.'));
    dialog.addEventListener('close',()=>{if(origin.isConnected)origin.insertBefore(target,next?.parentElement===origin?next:null);dialog.remove();if(focus?.isConnected)focus.focus({preventScroll:true});});
    document.body.append(dialog);dialog.showModal();
  }
  async function sendQuestion(context,message,output,button){
    if(button.disabled)return;button.disabled=true;
    const channel=window.GlosaTutorChannel?.current?.()||'api';
    output.replaceChildren(E('p',{role:'status'},channel==='mcp'?'Guardando la consulta para el canal MCP externo…':'Guardando y consultando al tutor…'));
    try{
      if(current?.id===context.noteId){if(current.id===pristineId)changes();await flush();}
      const note=data().notes.find(n=>n.id===context.noteId);if(!note)throw Error('No se encontró el apunte.');
      if(channel==='mcp'){
        // Sin clave ni costo: la consulta queda pendiente para el MCP de tutor.
        const pending=await api('/api/note-tutor',{...context,noteRevision:note.revision,requestId:crypto.randomUUID(),message,channel:'mcp',contextRevision:window.TutorContext?.revision({kind:'note',noteId:context.noteId})});
        data().noteTutor??=[];if(!data().noteTutor.some(q=>q.id===pending.id))data().noteTutor.push(pending);
        output.replaceChildren(E('div',{class:'eyebrow'},'MCP EXTERNO · CONSULTA PENDIENTE'),E('p',{class:'note-tutor-question'},pending.message),E('p',{class:'muted'},'Un cliente con el MCP de tutor puede responderla. Usá «Actualizar conversación» cuando lo haya hecho.'));
        return;
      }
      const result=await tutorStream('/api/note-tutor',{...context,noteRevision:note.revision,requestId:crypto.randomUUID(),message,contextRevision:window.TutorContext?.revision({kind:'note',noteId:context.noteId})},text=>{output.replaceChildren(E('div',{class:'eyebrow'},'TUTOR · ESCRIBIENDO…'),tutorContent(text));});
      data().noteTutor??=[];if(!data().noteTutor.some(q=>q.id===result.id))data().noteTutor.push(result);
      output.replaceChildren(E('div',{class:'eyebrow'},'TUTOR · '+(result.context.documentTitle?result.context.documentTitle+' · PDF '+result.context.page:'APUNTE GENERAL')),E('p',{class:'note-tutor-question'},result.message),tutorContent(result.reply),result.truncated?E('p',{class:'muted'},'La respuesta llegó incompleta. Podés pedirle que continúe.'):null,result.tutorContext&&window.TutorContext?TutorContext.used(result.tutorContext):null);
    }catch(error){
      output.replaceChildren(E('p',{role:'alert'},error.message),E('p',{class:'muted'},'Tu texto sigue guardado. Podés volver a preguntar.'),E('button',{type:'button',class:'text-button',onclick:showSettings},'Abrir Ajustes del tutor'));
      // Failed attempts are retained too, so a continuation agent can see the doubt.
      try{const fresh=await api('/api/state');data().noteTutor=fresh.library.noteTutor||[];state.tutorConnected=fresh.tutorConnected;}catch{}
    }finally{button.disabled=false;renderTutorHistory();}
  }
  function openTutor(initial='',context=null,sendImmediately=false){
    if(!current){notify('Creá un apunte antes de consultar al tutor.');return;}
    context??=questionContext();const originalFocus=document.activeElement;
    const question=E('textarea',{required:'required',maxlength:20000,rows:4,'aria-label':'Pregunta sobre el apunte',placeholder:'¿Qué parte querés aclarar?'});question.value=initial;
    const output=E('div',{class:'note-tutor-output','aria-live':'polite'}),ask=E('button',{type:'submit',class:'primary','data-ask-tutor':'true'},'Preguntar al tutor');
    const refreshTutor=E('button',{type:'button',class:'text-button',onclick:async()=>{try{const fresh=await api('/api/state');data().noteTutor=fresh.library.noteTutor||[];state.tutorConnected=fresh.tutorConnected;renderTutorHistory();output.replaceChildren(E('p',{class:'muted'},'Conversación actualizada.'));}catch(error){notify(error.message);}}},'Actualizar conversación');
    const dialog=E('dialog',{class:'note-tutor-dialog'},E('form',{onsubmit:e=>{e.preventDefault();sendQuestion(context,question.value,output,ask);}},E('div',{class:'eyebrow'},context.scope==='page'?'APUNTE · PÁGINA PDF '+context.page:'APUNTE GENERAL'),E('h2',{},'Aclarar esta duda'),E('p',{class:'muted'},'Se envía este texto y su contexto al tutor. Compartir el apunte con el agente autor es una elección aparte.'),question,E('div',{class:'dialog-actions'},refreshTutor,E('button',{type:'button',class:'quiet',onclick:()=>dialog.close()},'Cerrar · Esc'),ask),output));
    dialog.querySelector('form').insertBefore(E('button',{type:'button',class:'text-button',onclick:async()=>{try{if(current?.id===context.noteId){if(current.id===pristineId)changes();await flush();}await TutorContext.open({kind:'note',...context},question.value);}catch(e){notify(e.message);}}},'Contexto'),question);
    dialog.addEventListener('close',()=>{const restore=document.activeElement===document.body||dialog.contains(document.activeElement);dialog.remove();if(restore&&originalFocus?.isConnected)originalFocus.focus({preventScroll:true});});document.body.append(dialog);dialog.showModal();question.focus();
    if(sendImmediately&&initial.trim())dialog.querySelector('form').requestSubmit(ask);
  }
  function askCurrent(){
    if(!current)return;const input=activeWritingInput();followNoteCursor(input,false);
    const selected=input?.selectionEnd>input?.selectionStart?input.value.slice(input.selectionStart,input.selectionEnd):VimEditors.get(input)?.selectedText()||'';
    const text=selected||(input?.closest('.note-preface')?generalText():continuous()?(current.pageNotes?.[current.documentId]?.[String(current.page||1)]||''):writingText());if(text.length>20000){notify('Seleccioná una duda o un fragmento de hasta 20.000 caracteres.');return;}
    openTutor(text,questionContext(),true);
  }
  const writingScope=()=>current?.documentId?'page':'general';
  const continuous=()=>writingScope()==='page';
  function activeWritingInput(){const focused=VimEditors.sourceFor(document.activeElement);if(focused?.matches('#class-note-content,.note-cell-content')||focused?.closest('.note-preface'))return focused;return continuous()?document.querySelector(`.note-page-cell[data-page="${current.page||1}"] .note-cell-content`)||document.getElementById('class-note-content'):liveEditor?.element||document.getElementById('class-note-content');}
  function showMarkdown(){
    liveEditor?.setText(writingText());prefaceEditor?.setText(generalText());
  }
  function reading(read){
    const preview=document.getElementById('note-markdown-preview'),input=document.getElementById('class-note-content');if(!preview||!input)return;
    if(read)showMarkdown();preview.hidden=!read;input.hidden=read;
  }
  function edit(){
    const input=activeWritingInput();if(!input)return null;
    const raw=input.closest('.note-raw-editor');if(raw)raw.hidden=false;
    if(!continuous()&&liveEditor){reading(true);if(current.id===pristineId){liveEditor.enterInsert();liveEditor.setSelection(2);}return liveEditor.element;}
    return input;
  }
  function editMarkdown(){const input=document.getElementById('class-note-content');if(!input)return;const raw=input.closest('.note-raw-editor');if(raw)raw.hidden=false;else reading(false);input.focus();}
  function validPage(page){const doc=data().documents.find(d=>d.id===current?.documentId);return Number.isSafeInteger(page)&&page>=1&&(!doc?.pages||page<=doc.pages);}
  function selectNotePage(page,focus=false){
    if(!current?.documentId||!validPage(page))return;
    current.pageNotes??={};current.pageNotes[current.documentId]??={};current.pageNotes[current.documentId][String(page)]??='';
    const changed=current.page!==page;current.page=page;changes();syncWritingLabels();syncNotebook(focus);renderAnchors();
    const raw=document.getElementById('class-note-content');if(raw&&raw!==document.activeElement&&!current.markdownDraft)raw.value=pageMarkdown();
    if(changed&&mode()!=='page')loadPdf(current.documentId,page,{preserveWriting:true}).catch(pdfError);
    if(focus)document.querySelector(`.note-page-cell[data-page="${page}"] .note-cell-content`)?.focus({preventScroll:true});
  }
  function notebook(){return E('div',{id:'note-notebook',class:'note-notebook','aria-label':'Celdas por página del PDF'});}
  function syncNotebook(reveal=false){
    const target=document.getElementById('note-notebook');if(!target||!continuous())return;
    const pages={...(current.pageNotes?.[current.documentId]||{})};pages['1']??='';pages[String(current.page||1)]??='';
    const ids=Object.keys(pages).sort((a,b)=>Number(a)-Number(b));
    for(const cell of target.querySelectorAll('.note-page-cell'))if(!ids.includes(cell.dataset.page))cell.remove();
    for(const p of ids){
      let cell=[...target.children].find(c=>c.dataset.page===p);
      if(!cell){
        const body=E('textarea',{class:'note-cell-content',rows:4,'aria-label':'Notas de la página '+p,placeholder:'Tus notas…',onfocus:e=>followNoteCursor(e.target),oninput:e=>{current.pageNotes??={};current.pageNotes[current.documentId]??={};current.pageNotes[current.documentId][p]=e.target.value;changes();const raw=document.getElementById('class-note-content');if(raw&&!current.markdownDraft)raw.value=pageMarkdown();scheduleCursorFollow(e.target);}});
        body.value=pages[p];body.addEventListener('keydown',e=>{
          if(e.key!=='Enter'||e.shiftKey||e.ctrlKey||e.altKey||e.metaKey||e.isComposing||body.selectionStart!==body.selectionEnd)return;
          const start=body.value.lastIndexOf('\n',body.selectionStart-1)+1,end=body.value.indexOf('\n',body.selectionStart),line=body.value.slice(start,end<0?body.value.length:end),match=line.match(/^#([1-9][0-9]*)[ \t]*$/);
          if(!match||!validPage(Number(match[1])))return;
          e.preventDefault();body.value=(body.value.slice(0,start)+body.value.slice(end<0?body.value.length:end+1)).replace(/\n{1,2}$/,'');current.pageNotes[current.documentId][p]=body.value;changes();selectNotePage(Number(match[1]),true);
        });
        for(const event of ['select','keyup','click','compositionend'])body.addEventListener(event,()=>scheduleCursorFollow(body));
        cell=E('section',{class:'note-page-cell','data-page':p,tabindex:0,'aria-label':'Celda de la página '+p,onfocus:e=>{if(e.target===e.currentTarget)selectNotePage(Number(p));}},E('button',{type:'button',class:'note-cell-heading','aria-label':'Ir a la página '+p,onclick:()=>selectNotePage(Number(p),true)},'#'+p),body);
      }else{const body=cell.querySelector('textarea');if(body!==document.activeElement&&body.value!==pages[p])body.value=pages[p];}
      cell.classList.toggle('active',Number(p)===current.page);cell.querySelector('button').setAttribute('aria-current',Number(p)===current.page?'true':'false');
      const at=ids.indexOf(p);if(target.children[at]!==cell)target.insertBefore(cell,target.children[at]||null);
    }
    if(reveal)target.querySelector('.active')?.scrollIntoView({block:'nearest'});
  }
  function newPageCell(){
    if(!current?.documentId){openPdf().catch(e=>notify(e.message));return;}
    const input=E('input',{type:'text','aria-label':'Número de página',placeholder:'#29',required:'required',inputmode:'numeric'});
    const dialog=E('dialog',{},E('form',{onsubmit:e=>{e.preventDefault();const page=Number(input.value.replace(/^#/,''));if(!validPage(page)){notify('Elegí una página existente del PDF.');return;}dialog.close();current.writingScope='page';if(!document.getElementById('note-notebook'))render();selectNotePage(page,true);}},E('h2',{},'Página del apunte'),input,E('div',{class:'dialog-actions'},E('button',{type:'button',class:'text-button',onclick:()=>dialog.close()},'Cancelar · Esc'),E('button',{type:'submit',class:'quiet'},'Abrir celda'))));dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();input.focus();
  }
  function moveCell(delta){const cells=[...document.querySelectorAll('.note-page-cell')],index=cells.findIndex(c=>Number(c.dataset.page)===current?.page),cell=cells[Math.max(0,Math.min(cells.length-1,index+delta))];if(!cell)return;selectNotePage(Number(cell.dataset.page));cell.scrollIntoView({block:'nearest'});cell.focus({preventScroll:true});}
  function pageMarkdown(){const pages={...(current.pageNotes?.[current.documentId]||{})};pages['1']??='';pages[String(current.page||1)]??='';return (current.content?current.content+'\n\n':'')+Object.entries(pages).sort((a,b)=>Number(a[0])-Number(b[0])).map(([p,t])=>`#${p}\n\n${t}`).join('\n\n');}
  function normalizeHeaders(text){
    text=text.replace(/^# pag([1-9][0-9]*)[ \t]*$/gm,'#$1');
    if(!/^#1[ \t]*$/m.test(text)){
      const preface=current.content?current.content+'\n\n':'';
      const pos=preface&&text.startsWith(preface)?preface.length:0;
      const active=(current.page||1)>1&&!/^#[1-9][0-9]*[ \t]*$/m.test(text)?`#${current.page}\n\n`:'';
      text=text.slice(0,pos)+'#1\n\n'+active+text.slice(pos);
    }
    return text;
  }
  const generalText=()=>current?.contentFormat==='markdown'?current.content:current?'# '+current.title+'\n\n'+current.content:'';
  function writingText(){return current?.markdownDraft?.documentId===current?.documentId?normalizeHeaders(current.markdownDraft.text):continuous()?pageMarkdown():generalText();}
  function setTitle(title,note=current){
    note.title=title;
    if(note.contentFormat==='markdown')note.content=/^ {0,3}#(?:[ \t]|$)/.test(note.content)?note.content.replace(/^[^\n]*/,'# '+title):'# '+title+'\n\n'+note.content;
  }
  function storeGeneral(text){current.content=text;current.contentFormat='markdown';current.title=(text.split('\n')[0].match(/^ {0,3}#[ \t]+(.+?)(?:[ \t]+#+[ \t]*)?$/)?.[1]?.trim()||'Apunte sin título').slice(0,200);updateHeading();}
  function storeWriting(text){
    if(continuous()){
      const input=document.getElementById('class-note-content'),normalized=normalizeHeaders(text);
      if(input&&normalized!==text){const start=input.selectionStart,end=input.selectionEnd,delta=normalized.length-text.length;input.value=normalized;input.setSelectionRange(Math.max(0,start+delta),Math.max(0,end+delta));}
      text=normalized;
      current.markdownDraft={documentId:current.documentId,text};remember();
      const headings=[...text.matchAll(/^#([1-9][0-9]*)[ \t]*$/gm)],doc=data().documents.find(d=>d.id===current.documentId),pages={};
      for(let i=0;i<headings.length;i++){const p=headings[i][1];if(pages[p]!==undefined||(doc?.pages&&Number(p)>doc.pages)){notify('Hay una página repetida o fuera del PDF; corregí el encabezado para guardar.');return;}pages[p]=text.slice(headings[i].index+headings[i][0].length,headings[i+1]?.index??text.length).replace(/^\n{1,2}/,'').replace(/\n{1,2}$/,'');}
      current.content=text.slice(0,headings[0].index).replace(/\n{1,2}$/,'');current.pageNotes??={};current.pageNotes[current.documentId]=pages;
      delete current.markdownDraft;
    }
    else if(writingScope()==='page'){current.pageNotes??={};current.pageNotes[current.documentId]??={};current.pageNotes[current.documentId][String(current.page||1)]=text;}
    else{
      storeGeneral(text);
    }
    if(continuous())syncNotebook(false);
    changes();
  }
  function syncWriting(){
    const content=document.getElementById('class-note-content');if(content){content.value=writingText();if(continuous()){const h=`#${current.page||1}\n\n`,pos=Math.max(0,content.value.indexOf(h))+h.length;content.setSelectionRange(pos,pos);content.scrollTop=Math.max(0,content.value.slice(0,pos).split('\n').length*24-content.clientHeight/3);}}
    syncWritingLabels();
    syncNotebook(true);
    showMarkdown();
  }
  function syncWritingLabels(){
    const label=document.getElementById('note-writing-label');if(label){label.hidden=writingScope()!=='page';label.textContent=writingScope()==='page'?'Página PDF '+(current.page||1):'';}
    const summary=document.getElementById('note-writing-summary');if(summary)summary.textContent=(writingScope()==='page'?'Apunte de esta página':'Apunte general')+' · i para escribir';
  }
  function followNoteCursor(input,requireFocus=true){
    if(!current||!continuous()||!input?.isConnected||input.isContentEditable||(requireFocus&&VimEditors.sourceFor(document.activeElement)!==input)||view!=='notes')return;
    const cursor=input.selectionDirection==='backward'?input.selectionStart:input.selectionEnd;
    const headings=[...input.value.matchAll(/^#([1-9][0-9]*)[ \t]*$/gm)];
    const cell=input.closest('.note-page-cell'),heading=headings.filter(h=>h.index<=cursor).at(-1)||(!cell?headings[0]:null);if(!heading&&!cell)return;
    const page=Number(heading?.[1]||cell.dataset.page),doc=data().documents.find(d=>d.id===current.documentId);
    if(!Number.isSafeInteger(page)||page<1||(doc?.pages&&page>doc.pages)||page===current.page)return;
    current.page=page;syncWritingLabels();syncNotebook(false);renderAnchors();changes();
    // Only the reader changes. Keep the editor's text, selection, focus and scroll.
    if(mode()!=='page')loadPdf(current.documentId,page,{preserveWriting:true}).catch(pdfError);
  }
  function scheduleCursorFollow(input){clearTimeout(cursorTimer);cursorTimer=setTimeout(()=>followNoteCursor(input),180);}
  const mode=()=>current?.documentId?'parallel':'page';
  function rememberTextNote(){if(current&&!current.documentId&&data().notes.some(n=>n.id===current.id))GlosaRoom.storage.setItem('class-note-text-mode',current.id);}
  async function closePdf(){
    await flush();const id=GlosaRoom.storage.getItem('class-note-text-mode'),note=data().notes.find(n=>n.id===id&&!n.documentId);
    if(note){currentId=note.id;current=null;activeNote();}else blank();
    closeList();render();document.getElementById('main').focus({preventScroll:true});
  }
  function closeList(){document.body.classList.remove('notes-list-open');const el=document.querySelector('.notes-sidebar');if(el)el.inert=true;document.getElementById('notes-list-button')?.setAttribute('aria-expanded','false');}
  function openList(){document.body.classList.add('notes-list-open');const el=document.querySelector('.notes-sidebar');if(el)el.inert=false;document.getElementById('notes-list-button')?.setAttribute('aria-expanded','true');document.getElementById('class-note-search')?.focus();}
  function status(text){const el=document.getElementById('note-save-status');if(el)el.textContent=text;const error=document.getElementById('note-save-error');if(error){error.hidden=!text.startsWith('Sin guardar');error.textContent=error.hidden?'':text;}}
  function dirty(){return current&&current.id!==pristineId&&JSON.stringify(current)!==JSON.stringify(baseline);}
  function remember(){if(current){GlosaRoom.storage.setItem('class-note-draft:'+current.id,JSON.stringify(current));GlosaRoom.storage.setItem('class-note-active-draft',current.id);}}
  function changes(){if(current){pristineId=null;remember();status('Borrador local · guardando…');clearTimeout(saveTimer);saveTimer=setTimeout(()=>flush().catch(e=>notify(e.message)),850);}}
  function flush(){clearTimeout(saveTimer);if(!current||current.id===pristineId)return serial;if(current.markdownDraft&&continuous())storeWriting(current.markdownDraft.text);if(current.markdownDraft)return Promise.reject(Error('Hay un número de página repetido o fuera del PDF. Tu borrador está conservado.'));const id=current.id;
    serial=serial.catch(()=>{}).then(async()=>{if(!current||current.id!==id)return;if(current.markdownDraft)throw Error('Hay un número de página repetido o fuera del PDF. Tu borrador está conservado.');const submitted=JSON.parse(JSON.stringify(current));saving=true;
      try{const result=await api('/api/notes',submitted);const changed=JSON.stringify(current)!==JSON.stringify(submitted);baseline=JSON.parse(JSON.stringify(result));current.revision=result.revision;current.updatedAt=result.updatedAt;current.createdAt=result.createdAt;
        const i=data().notes.findIndex(n=>n.id===id);if(i>=0)data().notes[i]=result;else data().notes.push(result);
        if(changed){remember();changes();}else{current=result;GlosaRoom.storage.removeItem('class-note-draft:'+id);if(GlosaRoom.storage.getItem('class-note-active-draft')===id)GlosaRoom.storage.removeItem('class-note-active-draft');status('Guardado en esta computadora');renderList();}
      }catch(e){remember();status('Sin guardar en el servidor · borrador local conservado');
        // Conflicto o error: traer la versión vigente del archivo para la lista,
        // sin tocar el borrador local (que ya quedó en `current` y en storage).
        api('/api/state').then(fresh=>{if(fresh?.library){state.library=fresh.library;if(view==='notes')renderList();}}).catch(()=>{});
        throw e;}finally{saving=false;}
    });return serial;
  }
  // Adaptador para StudyTools: persiste la metadata de estudio (`study`) por el
  // mismo camino real de guardado, sin envolver `api`. Fuerza el guardado aunque
  // el apunte sea nuevo y todavía no tenga texto, para que una propiedad elegida
  // no quede solo en memoria.
  async function applyStudy(id,study){
    const note=noteById(id);if(!note)throw Error('Guardá el apunte antes de agregar propiedades de estudio.');
    const next=JSON.parse(JSON.stringify(study||{}));
    if(current?.id===id){
      current.study=next;pristineId=null;remember();
      await flush();
      const saved=noteById(id);
      return saved?.study||next;
    }
    const updated=JSON.parse(JSON.stringify(note));updated.study=next;
    const result=await api('/api/notes',updated),at=data().notes.findIndex(n=>n.id===id);
    if(at<0)data().notes.push(result);else data().notes[at]=result;
    renderList();
    return result.study||next;
  }
  function blank(){currentId=crypto.randomUUID();pristineId=currentId;baseline=null;current={id:currentId,title:'Apunte sin título',folder:folder||'',content:'# \n\n',contentFormat:'markdown',shared:false,documentId:null,page:null,writingScope:'general',pageNotes:{},anchors:[]};}
  function activeNote(){
    const draftId=currentId||GlosaRoom.storage.getItem('class-note-active-draft'),found=data().notes.find(n=>n.id===draftId);
    let restored=found?JSON.parse(JSON.stringify(found)):null;
    const draft=draftId&&GlosaRoom.storage.getItem('class-note-draft:'+draftId);if(draft){try{const parsed=JSON.parse(draft);if(parsed.id===draftId)restored=parsed;}catch{}}
    if(!restored){blank();return;}current=restored;currentId=current.id;pristineId=null;baseline=found?JSON.parse(JSON.stringify(found)):null;
  }
  // Refresco de edición externa: al recuperar el foco o la pestaña se relee el
  // estado (que reconcilia los .md). Si no hay cambios locales se recarga el
  // apunte activo; si los hay, se conserva el borrador y se avisa del conflicto.
  async function refreshFromServer(){
    if(view!=='notes')return;let fresh;try{fresh=await api('/api/state');}catch{return;}
    if(!fresh?.library)return;state.library=fresh.library;
    if(!current)return;
    const serverNote=data().notes.find(n=>n.id===current.id);
    if(!serverNote){renderList();return;}
    if(!dirty()){
      // Sin ediciones locales: el archivo manda. Si cambió afuera, se recarga.
      if(JSON.stringify(serverNote)!==JSON.stringify(baseline)){baseline=JSON.parse(JSON.stringify(serverNote));current=JSON.parse(JSON.stringify(serverNote));pristineId=null;GlosaRoom.storage.removeItem('class-note-draft:'+current.id);render();}
      else renderList();
    }else{
      // Con borrador local: no se pisa. Si además cambió afuera, se avisa el conflicto.
      renderList();
      if(JSON.stringify(serverNote)!==JSON.stringify(baseline)){const el=document.getElementById('note-save-error');if(el){el.hidden=false;el.textContent='El archivo «'+current.title+'» cambió fuera de Glosa. Tu borrador sigue en esta ventana; al guardar se te pedirá recargar antes de pisarlo.';}}
    }
    const warnings=data().noteWarnings||[];if(warnings.length)notify('Apuntes: '+warnings[0]);
  }
  async function select(id){await flush();rememberTextNote();closeList();currentId=id;current=null;activeNote();rememberTextNote();render();document.getElementById('main').focus({preventScroll:true});}
  async function create(){await flush();closeList();blank();render();const input=edit();input?.focus();if(liveEditor){liveEditor.setSelection(2);liveEditor.enterInsert();}else input?.setSelectionRange(2,2);}
  async function usePdf(doc){
    await flush();
    if(current?.documentId===doc.id)return;
    let note=data().notes.filter(n=>n.documentId===doc.id).toSorted((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];
    if(!note){
      // Commit the new PDF workspace before replacing the current editor.
      // A failed save leaves the text mode and its draft intact.
      note=await api('/api/notes',{id:crypto.randomUUID(),title:doc.title,folder:folder||'',content:'',contentFormat:'markdown',shared:false,documentId:doc.id,page:1,writingScope:'page',pageNotes:{[doc.id]:{'1':''}},anchors:[]});
      data().notes.push(note);
    }
    rememberTextNote();currentId=note.id;current=null;activeNote();
  }
  async function openPdf(){
    if(!current)await create();await flush();
    const search=E('input',{type:'search','aria-label':'Buscar PDF',placeholder:'Buscar filmina o libro…'}),list=E('div',{class:'pdf-picker-list'});
    const dialog=E('dialog',{class:'pdf-picker'},E('h2',{},'Abrir PDF'),search,list,E('div',{class:'dialog-actions'},E('button',{type:'button',class:'text-button',onclick:()=>{dialog.close();upload();}},'Adjuntar otro PDF'),E('button',{type:'button',class:'text-button',onclick:()=>dialog.close()},'Cerrar · Esc')));
    const draw=()=>list.replaceChildren(...data().documents.filter(d=>d.title.toLowerCase().includes(search.value.toLowerCase())).map(d=>E('button',{type:'button',class:'text-button',onclick:async e=>{e.target.disabled=true;try{await usePdf(d);dialog.close();render();document.getElementById('pdf-scroll')?.focus({preventScroll:true});}catch(error){notify(error.message);e.target.disabled=false;}}},d.title)));
    search.addEventListener('input',draw);search.addEventListener('keydown',e=>{if(e.key==='ArrowDown'){e.preventDefault();list.querySelector('button')?.focus();}if(e.key==='Enter'){e.preventDefault();list.querySelector('button')?.click();}});
    dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();draw();search.focus();
  }
  async function readStep(delta){const scroll=document.getElementById('pdf-scroll');if(!scroll||!pdf)return;const edge=delta>0?scroll.scrollTop+scroll.clientHeight>=scroll.scrollHeight-3:scroll.scrollTop<=0;if(edge){const next=Math.max(1,Math.min(pdf.numPages,pageNumber+delta));if(next!==pageNumber){await flush();await loadPdf(current.documentId,next);if(delta<0)scroll.scrollTop=scroll.scrollHeight;}}else scroll.scrollBy({top:delta*100,behavior:'instant'});}
  function updateHeading(){
    const button=document.getElementById('note-name-button');if(!button)return;button.hidden=!current;button.textContent=current?.title||'Apunte sin título';button.setAttribute('aria-label','Renombrar apunte: '+(current?.title||'Apunte sin título'));
  }
  const noteById=id=>current?.id===id?current:data().notes.find(n=>n.id===id);
  function rename(id=current?.id){return manage(id,'rename');}
  function properties(id=current?.id){return manage(id,'properties');}
  async function manage(id,kind){
    await flush();const note=noteById(id);if(!note)return;
    const title=E('input',{'aria-label':'Nuevo nombre del apunte',required:'required',maxlength:200}),folderInput=E('input',{'aria-label':'Carpeta del apunte',maxlength:120,placeholder:'Sin carpeta'}),share=E('input',{type:'checkbox'});
    title.value=note.title;folderInput.value=note.folder;share.checked=note.shared;
    const save=E('button',{type:'submit',class:'quiet'},'Guardar'),form=E('form',{onsubmit:async e=>{
      e.preventDefault();save.disabled=true;
      try{
        await flush();const updated=JSON.parse(JSON.stringify(noteById(id)));if(kind!=='folder')setTitle(title.value.trim(),updated);if(kind!=='rename')updated.folder=folderInput.value.trim();if(kind==='properties')updated.shared=share.checked;
        const result=await api('/api/notes',updated),at=data().notes.findIndex(n=>n.id===id);if(at<0)data().notes.push(result);else data().notes[at]=result;
        if(current?.id===id){current=result;pristineId=null;baseline=JSON.parse(JSON.stringify(result));GlosaRoom.storage.removeItem('class-note-draft:'+id);if(GlosaRoom.storage.getItem('class-note-active-draft')===id)GlosaRoom.storage.removeItem('class-note-active-draft');}
        dialog.close();
        // Metadata changes keep the mounted reader and its scroll/zoom position.
        const input=document.getElementById('class-note-content');if(input)input.value=writingText();
        showMarkdown();updateHeading();renderList();restoreListFocus(id);
      }catch(error){notify(error.message);}finally{save.disabled=false;}
    }},E('h2',{},kind==='rename'?'Nombre del apunte':kind==='folder'?'Mover de carpeta':'Propiedades del apunte'));
    if(kind!=='folder')form.append(E('label',{},'Nombre',title));if(kind!=='rename')form.append(E('label',{},'Carpeta',folderInput));if(kind==='properties')form.append(E('label',{class:'check'},share,'Compartir con el agente autor'));
    form.append(E('div',{class:'dialog-actions'},E('button',{type:'button',class:'text-button',onclick:()=>dialog.close()},'Cancelar · Esc'),save));
    // Native close() restores focus synchronously. Its queued close event must
    // not override a newer panel selection or the submit handler's focus.
    const dialog=E('dialog',{class:'note-manage-dialog'+(kind==='rename'?' note-rename-dialog':'')},form);dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();(kind==='folder'?folderInput:title).focus();(kind==='folder'?folderInput:title).select();
  }
  function restoreListFocus(id){if(document.body.classList.contains('notes-list-open'))document.getElementById('class-note-search')?.focus();else document.getElementById('main')?.focus({preventScroll:true});}
  async function deleteNote(id=current?.id){
    await flush();const note=noteById(id);if(!note)return;
    const cancel=E('button',{type:'button',class:'text-button',onclick:()=>dialog.close()},'Cancelar · Esc'),remove=E('button',{type:'button',class:'quiet',onclick:async()=>{
      remove.disabled=true;
      try{
        await flush();const latest=noteById(id);if(latest?.id!==pristineId){const result=await api('/api/notes/delete',{id,revision:latest.revision});data().deletedNotes??=[];data().deletedNotes.push({...latest,...result});}
        data().notes=data().notes.filter(n=>n.id!==id);GlosaRoom.storage.removeItem('class-note-draft:'+id);GlosaRoom.storage.removeItem('class-note-mode:'+id);GlosaRoom.storage.removeItem('class-note-split:'+id);if(GlosaRoom.storage.getItem('class-note-active-draft')===id)GlosaRoom.storage.removeItem('class-note-active-draft');
        if(current?.id===id)blank();dialog.close();render();restoreListFocus();
      }catch(error){notify(error.message);remove.disabled=false;}
    }},'Eliminar apunte');
    const dialog=E('dialog',{class:'note-delete-dialog'},E('h2',{},'Eliminar apunte'),E('p',{},'¿Eliminar «'+note.title+'» de tus apuntes?'),note.documentId?E('p',{class:'muted'},'El PDF adjunto se conserva.'):null,E('div',{class:'dialog-actions'},cancel,remove));dialog.addEventListener('close',()=>{dialog.remove();restoreListFocus(id);});document.body.append(dialog);dialog.showModal();cancel.focus();
  }
  function renderList(){const list=document.getElementById('class-note-list');if(!list)return;
    const filter=document.querySelector('.notes-sidebar select[aria-label="Filtrar carpeta"]'),folders=[...new Set(data().notes.map(n=>n.folder).filter(Boolean))].sort(),folderSignature=JSON.stringify(folders);
    if(filter&&filter.dataset.signature!==folderSignature){filter.dataset.signature=folderSignature;if(folder&&!folders.includes(folder))folder='';filter.replaceChildren(E('option',{value:''},'Todas las carpetas'),...folders.map(value=>E('option',{value},value)));filter.value=folder;}
    const notes=data().notes.filter(n=>(!folder||n.folder===folder)&&(`${n.title} ${n.content} ${JSON.stringify(n.pageNotes||{})}`.toLowerCase().includes(query.toLowerCase()))).toSorted((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
    const signature=JSON.stringify(notes.map(n=>[n.id,n.title,n.folder,n.id===currentId]));if(list.dataset.signature===signature)return;list.dataset.signature=signature;
    const opened=new Set([...list.querySelectorAll('.note-list-actions[open]')].map(menu=>menu.closest('.class-note-row').dataset.noteId));
    list.replaceChildren(...notes.map(n=>{
      const actions=E('details',{class:'note-list-actions'},E('summary',{'aria-label':'Gestionar '+n.title},'⋯'));
      actions.open=opened.has(n.id);
      const action=(label,run)=>iconAction(label,({'Renombrar':'edit','Mover de carpeta':'folder','Descargar Markdown':'download','Eliminar':'trash'})[label],{onclick:()=>{actions.open=false;Promise.resolve().then(run).catch(error=>notify(error.message));}});
      actions.append(E('div',{class:'note-list-actions-menu'},action('Renombrar',()=>rename(n.id)),action('Mover de carpeta',()=>manage(n.id,'folder')),action('Descargar Markdown',()=>exportNote(n.id)),action('Eliminar',()=>deleteNote(n.id))));
      return E('div',{class:'class-note-row','data-note-id':n.id},E('button',{class:'class-note-link'+(n.id===currentId?' active':''),onclick:()=>select(n.id).catch(e=>notify(e.message)),'aria-current':n.id===currentId?'page':'false'},E('span',{},n.title),E('small',{},n.folder||'Sin carpeta')),actions);
    }));
    if(!notes.length)list.append(E('p',{class:'muted'},'No hay notas en esta vista.'));
  }
  function splitLayout(){const layout=document.querySelector('.resizable-notes');return layout&&getComputedStyle(layout).display==='grid'?layout:null;}
  function setSplit(value,persist=true){
    const layout=document.querySelector('.resizable-notes');if(!layout)return;
    const width=layout.getBoundingClientRect().width,minimum=Math.max(.2,Math.min(.45,240/Math.max(1,width)));
    const share=Math.max(minimum,Math.min(1-minimum,value));layout.dataset.readerShare=String(share);layout.style.setProperty('--reader-share',(share*100)+'%');
    const bar=layout.querySelector('.notes-splitter');bar.setAttribute('aria-valuemin',Math.ceil(minimum*100));bar.setAttribute('aria-valuemax',Math.floor((1-minimum)*100));bar.setAttribute('aria-valuenow',Math.round(share*100));bar.setAttribute('aria-valuetext',Math.round(share*100)+'% libro · '+Math.round((1-share)*100)+'% notas');
    if(persist&&current)GlosaRoom.storage.setItem('class-note-split:'+current.id,String(share));
  }
  function resizeSplit(delta){const layout=splitLayout();if(!layout)return;setSplit(Number(layout.dataset.readerShare)+delta);}
  function resetSplit(){if(splitLayout())setSplit(.5);}
  function startResize(){const layout=splitLayout();if(!layout)return false;layout.classList.add('resizing-keys');layout.querySelector('.notes-splitter').focus({preventScroll:true});return true;}
  function endResize(){document.querySelector('.resizable-notes')?.classList.remove('resizing-keys');}
  function splitter(){
    const bar=E('div',{class:'notes-splitter',role:'separator',tabindex:0,'aria-orientation':'vertical','aria-controls':'pdf-scroll','aria-label':'Ancho del libro y las notas',title:'Arrastrá para ajustar · r en NORMAL: redimensionar · doble clic: equilibrar'});let dragging=null;
    const finish=e=>{if(dragging===null||e.pointerId!==dragging)return;dragging=null;document.body.classList.remove('resizing-pointer');if(bar.hasPointerCapture(e.pointerId))bar.releasePointerCapture(e.pointerId);document.querySelector('.source-reader')?.focus({preventScroll:true});};
    bar.addEventListener('pointerdown',e=>{if(e.button!==0||!e.isPrimary||!splitLayout())return;e.preventDefault();dragging=e.pointerId;bar.focus({preventScroll:true});bar.setPointerCapture(e.pointerId);document.body.classList.add('resizing-pointer');});
    bar.addEventListener('pointermove',e=>{if(e.pointerId!==dragging)return;const box=splitLayout()?.getBoundingClientRect();if(box)setSplit((e.clientX-box.left)/box.width);});
    for(const event of ['pointerup','pointercancel','lostpointercapture'])bar.addEventListener(event,finish);
    bar.addEventListener('dblclick',resetSplit);
    bar.addEventListener('keydown',e=>{if(bar.closest('.resizing-keys'))return;if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();if(e.key==='Home')setSplit(0);else if(e.key==='End')setSplit(1);else resizeSplit((e.key==='ArrowLeft'?-1:1)*(e.shiftKey ? 0.1 : 0.02));}});
    return bar;
  }
  function observeReader(){
    readerObserver?.disconnect();const scroll=document.getElementById('pdf-scroll');if(!scroll)return;let width=scroll.clientWidth;
    readerObserver=new ResizeObserver(()=>{const next=scroll.clientWidth;if(next===width)return;width=next;clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(view==='notes'&&pdf&&scroll.isConnected)paint({preserveScroll:true}).catch(pdfError);},120);});readerObserver.observe(scroll);
  }
  function render(){liveEditor?.destroy();liveEditor=null;prefaceEditor?.destroy();prefaceEditor=null;clearTimeout(cursorTimer);generation++;renderTask?.cancel();document.querySelector('.workspace').classList.add('notes-view');if(!current)activeNote();updateHeading();
    const sidebar=E('aside',{class:'notes-sidebar'},E('div',{class:'eyebrow'},'TU ESPACIO DE NOTAS'),E('h2',{},'Apuntes'),E('button',{class:'primary',onclick:()=>create().catch(e=>notify(e.message))},'＋ Nueva nota'));
    sidebar.inert=!document.body.classList.contains('notes-list-open');
    sidebar.prepend(E('button',{class:'text-button panel-close',onclick:closeList},'Cerrar · Esc'));
    const search=E('input',{id:'class-note-search',type:'search',placeholder:'Buscar en tus notas…','aria-label':'Buscar notas',oninput:e=>{query=e.target.value;renderList();}});search.value=query;
    const folders=E('select',{'aria-label':'Filtrar carpeta',onchange:e=>{folder=e.target.value;renderList();}},E('option',{value:''},'Todas las carpetas'),...[...new Set(data().notes.map(n=>n.folder).filter(Boolean))].sort().map(f=>E('option',{value:f},f)));folders.value=folder;
    sidebar.append(search,folders,E('div',{id:'class-note-list'}),E('div',{class:'notes-nav-bottom'},E('button',{class:'text-button',onclick:()=>document.getElementById('export-dialog').showModal()},'↓ Exportar notas e historial')));
    const editor=E('section',{class:'note-editor'});
    {
      const folderInput=E('input',{id:'class-note-folder',placeholder:'Materia / carpeta','aria-label':'Carpeta de la nota',oninput:e=>{current.folder=e.target.value;changes();}});folderInput.value=current.folder;
      const content=E('textarea',{id:'class-note-content',class:'note-content',placeholder:'# Tema de la clase\n\nMis apuntes…\n\n## Dudas para el agente\n- …','aria-label':'Contenido de la nota',oninput:e=>{storeWriting(e.target.value);if(!e.isComposing)scheduleCursorFollow(e.target);}});content.value=writingText();
      for(const event of ['select','keyup','click','focus','compositionend'])content.addEventListener(event,()=>scheduleCursorFollow(content));
      const share=E('input',{type:'checkbox',onchange:e=>{current.shared=e.target.checked;changes();}});share.checked=current.shared;
      const writingControls=E('div',{class:'note-writing-controls'},E('button',{type:'button',class:'text-button',onclick:()=>annotate(false)},'＋ Anotación'));
      let writing;
      if(continuous()){
        const raw=E('section',{class:'note-raw-editor'},content);raw.hidden=!current.markdownDraft;
        writing=E('div',{class:'note-notebook-wrapper'},notebook(),E('button',{type:'button',class:'text-button note-new-cell',onclick:newPageCell},'＋ Página · g b'),raw);
        if(current.content.trim()&&current.content.trim()!=='#'||current.contentFormat!=='markdown'&&current.title!=='Apunte sin título'){
          const preface=E('article',{class:'note-preface note-markdown note-live-markdown','aria-label':'Texto del apunte'});
          prefaceEditor=NoteLiveMarkdown.create(preface,generalText(),text=>{storeGeneral(text);changes();if(!current.markdownDraft)content.value=pageMarkdown();});writing.prepend(preface);
        }
      }else{
        content.hidden=true;
        content.addEventListener('blur',e=>{if(VimEditors.sourceFor(e.relatedTarget)!==content)reading(true);});
        const preview=E('article',{id:'note-markdown-preview',class:'note-markdown note-live-markdown','aria-label':'Apunte en Markdown'});
        liveEditor=NoteLiveMarkdown.create(preview,writingText(),text=>{content.value=text;storeWriting(text);});
        writingControls.prepend(E('button',{type:'button',class:'text-button',onclick:()=>edit()?.focus()},'Editar'),E('button',{type:'button',class:'text-button',onclick:editMarkdown},'Editar Markdown original'));
        const body=E('div',{class:'note-markdown-editor'},preview,content);
        writing=body;
      }
      const meta=E('div',{class:'note-meta'},folderInput,E('span',{id:'note-save-status',class:'muted'},current.id===pristineId?'Sin cambios':GlosaRoom.storage.getItem('class-note-draft:'+current.id)?'Borrador local recuperado':'Guardado en esta computadora'));
      const source=E('div',{class:'note-source-choice'},E('button',{type:'button',class:'text-button',onclick:()=>openPdf().catch(e=>notify(e.message))},current.documentId?'Cambiar PDF':'Abrir PDF · g f'),current.documentId?E('button',{type:'button',class:'text-button',onclick:()=>closePdf().catch(e=>notify(e.message))},'Cerrar PDF'):null);
      const ask=E('button',{type:'button',class:'text-button note-ask-button',onclick:askCurrent},'Preguntar al tutor · Ctrl+Shift+Enter');
      const footer=E('div',{class:'note-footer'},E('label',{class:'check'},share,'Compartir apunte y consultas con el agente que crea cursos'),E('button',{class:'text-button',onclick:()=>flush().catch(e=>notify(e.message))},'Guardar'),E('button',{class:'text-button',onclick:()=>exportNote()},'↓ Markdown'));
      const history=E('div',{id:'note-tutor-history'}),anchors=E('div',{id:'note-anchors',class:'note-anchors'});
      {
        editor.classList.add('minimal-note');
        const options=E('details',{id:'note-options',class:'note-options'},E('summary',{'aria-label':'Opciones del apunte'},'⋯'),E('div',{class:'note-options-panel'},writingControls,ask,meta,source,footer,history,anchors));
        options.addEventListener('click',e=>{if(e.target.closest('button'))options.open=false;});
        editor.append(options,writing,E('p',{id:'note-save-error',class:'muted',role:'status',hidden:'hidden'}));
        const fileWarnings=data().noteWarnings||[];
        if(fileWarnings.length)editor.append(E('p',{class:'muted note-file-warnings',role:'status'},'Revisá Apuntes: '+fileWarnings.join(' ')));
      }
    }
    const layout=E('div',{class:'class-notes-layout notes-mode-'+mode()+(current?.documentId&&mode()!=='page'?' with-document':'')},sidebar);

    if(continuous()&&mode()!=='page'){editor.classList.add('continuous-editor');}
    if(current?.documentId&&mode()!=='page'){layout.classList.add('resizable-notes');layout.append(reader(),splitter());}layout.append(editor);$('main').replaceChildren(layout);if(layout.classList.contains('resizable-notes')){const saved=parseFloat(GlosaRoom.storage.getItem('class-note-split:'+current.id));setSplit(Number.isFinite(saved)?saved:(1.1/2.1),false);}observeReader();renderList();renderAnchors();renderTutorHistory();syncWriting();
    if(current?.documentId&&mode()!=='page')loadPdf(current.documentId,current.page||1).catch(e=>pdfError(e));
  }
  function renderAnchors(){
    const target=document.getElementById('note-anchors');if(!target||!current)return;
    const general=current.anchors.filter(a=>a.scope==='general');
    const linked=current.anchors.filter(a=>a.scope!=='general'&&(!current.documentId||(a.documentId===current.documentId&&a.page===(current.page||1))));
    function item(a){const index=current.anchors.indexOf(a),doc=data().documents.find(d=>d.id===a.documentId);
      const label=(a.scope==='general'?'Independiente':'Página PDF '+a.page)+(doc?' · '+doc.title+(a.scope==='general'?' · fuente: pág. '+a.page:''):'');
      return E('article',{class:'source-anchor','data-scope':a.scope||'page','data-page':a.page??''},E('div',{class:'eyebrow'},label),a.quote?E('blockquote',{},a.quote):null,E('p',{},a.comment||''),doc?E('button',{class:'text-button',onclick:async()=>{current.documentId=a.documentId;current.page=a.page;changes();await flush();render();}},'Ver en la fuente →'):null,E('button',{class:'text-button',onclick:()=>annotate(true,index)},'Editar'),E('button',{class:'text-button',onclick:async()=>{current.anchors.splice(index,1);changes();try{await flush();renderAnchors();}catch(e){notify(e.message);}}},'Borrar'),E('button',{class:'text-button',onclick:()=>{if(!a.id){annotate(true,index);return;}openTutor(a.comment||'',questionContext(a),true);}},'Preguntar al tutor'));
    }
    target.replaceChildren();
    if(current.documentId&&linked.length)target.append(E('p',{class:'margin-page-label'},'Anotaciones de la página '+(current.page||1)+' · a para anotar'));
    target.append(...linked.map(item));
    if(general.length)target.append(E('p',{class:'margin-page-label'},'Anotaciones independientes'),...general.map(item));
    drawPdfHighlights();
  }
  function pdfRange(layer,start,end){
    const walker=document.createTreeWalker(layer,NodeFilter.SHOW_TEXT);let node,at=0,range=null;
    while(node=walker.nextNode()){
      if(!range&&start>=at&&start<at+node.length){range=document.createRange();range.setStart(node,start-at);}
      if(range&&end<=at+node.length){range.setEnd(node,end-at);return range;}at+=node.length;
    }return null;
  }
  function pdfRects(range,container){
    const box=container.getBoundingClientRect();if(!box.width||!box.height)return [];const unique=new Map();
    for(const rect of range.getClientRects()){
      const x=Math.max(0,(rect.left-box.left)/box.width),y=Math.max(0,(rect.top-box.top)/box.height),width=Math.min(1-x,rect.width/box.width),height=Math.min(1-y,rect.height/box.height);
      if(width<=0||height<=0||x>=1||y>=1)continue;const shape={x,y,width,height},key=Object.values(shape).map(n=>n.toFixed(6)).join(':');unique.set(key,shape);
    }return [...unique.values()].slice(0,1000);
  }
  function setAnchorColor(index,color){const anchor=current?.anchors[index];if(!anchor)return;anchor.color=color;changes();for(const mark of document.querySelectorAll('.pdf-highlight[data-anchor-id="'+CSS.escape(anchor.id)+'"]'))mark.dataset.color=color;notify('Color del resaltado actualizado.');}
  function removeAnchor(index){const anchor=current?.anchors[index];if(!anchor)return;const scroller=document.getElementById('pdf-scroll'),position=scroller?{top:scroller.scrollTop,left:scroller.scrollLeft}:null;current.anchors.splice(index,1);changes();flush().then(()=>{for(const mark of document.querySelectorAll('.pdf-highlight[data-anchor-id="'+CSS.escape(anchor.id)+'"]'))mark.remove();renderAnchors();if(scroller&&position){scroller.scrollTop=position.top;scroller.scrollLeft=position.left;}if(document.activeElement===document.body)document.querySelector('.source-reader')?.focus({preventScroll:true});notify('Resaltado quitado. La versión anterior queda en el historial del apunte.');}).catch(e=>notify(e.message));}
  function drawPdfHighlights(){
    const container=document.getElementById('pdf-page-canvas'),layer=container?.querySelector('.textLayer');if(!layer||!current)return;
    container.querySelector('.pdf-highlights')?.remove();const overlay=E('div',{class:'pdf-highlights'});
    for(const anchor of current.anchors.filter(a=>a.documentId===current.documentId&&a.page===pageNumber&&a.quote)){
      const range=anchor.selector?pdfRange(layer,anchor.selector.start,anchor.selector.end):null;
      const rects=range?.toString()===anchor.quote?pdfRects(range,container):anchor.rects||[];
      const index=current.anchors.findIndex(a=>a.id===anchor.id);
      for(const rect of rects){const mark=E('button',{type:'button',class:'pdf-highlight','data-anchor-id':anchor.id,'data-color':anchor.color||'yellow','aria-label':'Resaltado: '+anchor.quote.slice(0,120),style:`left:${rect.x*100}%;top:${rect.y*100}%;width:${rect.width*100}%;height:${rect.height*100}%`,onclick:()=>showReadingActions(mark,{note:()=>annotate(true,index),tutor:async()=>{await flush();openTutor('Explicame el fragmento resaltado.',questionContext(anchor),true);},hasNote:!!anchor.comment,color:anchor.color||'yellow',onColor:color=>setAnchorColor(index,color),onDelete:()=>removeAnchor(index)})});overlay.append(mark);}
    }container.append(overlay);
  }
  function highlightSelection(){
    if(!current?.documentId)return;const layer=document.querySelector('#pdf-page-canvas .textLayer'),chosen=readingSelection(layer);if(!chosen)return;
    const doc=data().documents.find(d=>d.id===current.documentId),container=layer.parentElement,rects=pdfRects(chosen.range,container);if(!rects.length)return;
    const duplicate=current.anchors.some(a=>a.documentId===doc.id&&a.page===pageNumber&&a.selector?.start===chosen.start&&a.selector?.end===chosen.end);
    window.getSelection().removeAllRanges();window.WorkspaceKeys?.clearVisual();if(duplicate)return;
    current.anchors.push({id:crypto.randomUUID(),scope:'page',documentId:doc.id,sha256:doc.sha256,page:pageNumber,quote:chosen.quote,comment:'',color:'yellow',selector:{start:chosen.start,end:chosen.end},rects,createdAt:new Date().toISOString()});changes();renderAnchors();
  }
  function reader(){return E('section',{class:'source-reader'},E('input',{id:'pdf-page',type:'hidden',value:current.page||1}),E('div',{id:'pdf-scroll',tabindex:0,'aria-label':'Lectura del PDF'},E('div',{id:'pdf-loading',class:'muted'},'Abriendo documento…'),E('div',{id:'pdf-page-canvas'})),E('div',{class:'pdf-position','aria-live':'polite'},E('span',{},data().documents.find(d=>d.id===current.documentId)?.title||'PDF'),E('span',{id:'pdf-page-count'},'…')));}
  function pdfError(error){if(error?.name==='RenderingCancelledException')return;const out=document.getElementById('pdf-loading');if(out){out.hidden=false;out.textContent='No se pudo abrir el PDF: '+error.message;}else notify(error.message);}
  async function loadPdf(id,page,{preserveWriting=false}={}){
    const ticket=++generation;renderTask?.cancel();
    if(pdfId!==id){
      const documentTicket=++documentGeneration,previous=loadingPdf;pdfId=id;pdf=null;loadingPdf=null;
      // Share the whole opening operation, including the module import, across view changes.
      documentLoad=(async()=>{
        await previous?.destroy();const lib=await import('/vendor/pdfjs/legacy/build/pdf.mjs');
        if(documentTicket!==documentGeneration)throw Object.assign(new Error('Lectura reemplazada'),{name:'RenderingCancelledException'});
        lib.GlobalWorkerOptions.workerSrc='/vendor/pdfjs/legacy/build/pdf.worker.mjs';
        loadingPdf=lib.getDocument({url:GlosaRoom.url('/documents/'+encodeURIComponent(id)),cMapUrl:'/vendor/pdfjs/cmaps/',cMapPacked:true,standardFontDataUrl:'/vendor/pdfjs/standard_fonts/',wasmUrl:'/vendor/pdfjs/wasm/',isEvalSupported:false});
        return loadingPdf.promise;
      })();
    }
    const loaded=await documentLoad;
    if(ticket!==generation||view!=='notes'||current?.documentId!==id||mode()==='page')return;
    pdf=loaded;pageNumber=Math.max(1,Math.min(pdf.numPages,Math.floor(page)||1));
    if(current){current.page=pageNumber;if(preserveWriting)syncWritingLabels();else syncWriting();changes();}renderAnchors();await paint();
  }
  async function paint({preserveScroll=false}={}){if(!pdf||view!=='notes')return;const scroller=document.getElementById('pdf-scroll'),oldCanvas=document.getElementById('pdf-page-canvas');const position=preserveScroll&&scroller&&oldCanvas?{top:scroller.scrollTop/Math.max(1,oldCanvas.offsetHeight),left:scroller.scrollLeft/Math.max(1,oldCanvas.offsetWidth)}:null;const ticket=++generation;renderTask?.cancel();const page=await pdf.getPage(pageNumber);if(ticket!==generation)return;const container=document.getElementById('pdf-page-canvas');if(!container)return;
    const lib=await import('/vendor/pdfjs/legacy/build/pdf.mjs');const scroll=document.getElementById('pdf-scroll');const base=page.getViewport({scale:1});const scale=Math.max(.3,(scroll.clientWidth-40)/base.width)*zoom;const viewport=page.getViewport({scale});const ratio=window.devicePixelRatio||1;
    const canvas=E('canvas',{'aria-label':'Página '+pageNumber+' del PDF'});canvas.width=Math.floor(viewport.width*ratio);canvas.height=Math.floor(viewport.height*ratio);canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';
    container.style.width=viewport.width+'px';container.style.height=viewport.height+'px';container.style.setProperty('--total-scale-factor',scale);container.replaceChildren(canvas);const layer=E('div',{class:'textLayer'});container.append(layer);
    renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport,transform:ratio!==1?[ratio,0,0,ratio,0,0]:null});await renderTask.promise;if(ticket!==generation)return;
    const text=new lib.TextLayer({textContentSource:await page.getTextContent(),container:layer,viewport});layer.style.width=(viewport.rawDims.pageWidth*scale)+'px';layer.style.height=(viewport.rawDims.pageHeight*scale)+'px';await text.render();
    if(ticket!==generation)return;
    drawPdfHighlights();
    const pageInput=document.getElementById('pdf-page');if(pageInput){pageInput.value=pageNumber;pageInput.max=pdf.numPages;document.getElementById('pdf-page-count').textContent=pageNumber+' / '+pdf.numPages;document.getElementById('pdf-loading').hidden=true;}
    scroll.scrollTop=position?position.top*viewport.height:0;
    scroll.scrollLeft=position?position.left*viewport.width:0;
  }
  async function zoomBy(delta){
    if(!pdf||view!=='notes'||mode()==='page'||!document.getElementById('pdf-scroll'))return;
    const next=Math.max(.5,Math.min(3,Math.round((zoom+delta*.1)*10)/10));if(next===zoom)return;zoom=next;
    try{await paint({preserveScroll:true});}catch(error){pdfError(error);}
  }
  async function changePage(delta){
    if(!current?.documentId)return;
    await flush();
    const doc=data().documents.find(d=>d.id===current.documentId),next=Math.max(1,Math.min(doc?.pages||Infinity,(current.page||1)+delta));
    if(mode()==='page'){current.page=next;syncWriting();renderAnchors();changes();}
    else await loadPdf(current.documentId,next);
  }
  function annotate(selected=true,index=null){
    if(!current)return;const existing=index===null?null:current.anchors[index];
    const s=window.getSelection(),range=s?.rangeCount?s.getRangeAt(0):null;
    const inPdf=range&&range.startContainer.parentElement?.closest('.textLayer');
    const quote=existing?.quote??(selected?(pdfSelection?.quote||(inPdf?s.toString():'')):'');
    if(quote.length>20000){notify('Seleccioná un fragmento más corto.');return;}
    const doc=data().documents.find(d=>d.id===(existing?.documentId||current.documentId));
    const noteId=current.id,page=existing?.page??current.page??1;
    const scope=E('select',{id:'annotation-scope','aria-label':'Vincular anotación'},E('option',{value:'page'},doc?'Página '+page+' del PDF':'Página del PDF'),E('option',{value:'general'},'Independiente del PDF'));
    scope.options[0].disabled=!doc;scope.value=existing?(existing.scope||'page'):(doc?'page':'general');
    const comment=E('textarea',{rows:4,required:'required','aria-label':'Comentario sobre la fuente',placeholder:'Mi duda, lo que dijo el profesor o una explicación propia…'});
    let editIndex=index,savedAnchor=existing,storing=false;
    const output=E('div',{class:'note-tutor-output','aria-live':'polite'}),ask=E('button',{type:'submit',class:'quiet','data-ask-tutor':'true'},'Guardar y preguntar · Ctrl+Shift+Enter');
    const contextButton=E('button',{type:'submit',class:'text-button'},'Contexto del tutor');
    const dialog=E('dialog',{class:'source-note-dialog'},E('form',{onsubmit:async e=>{
      e.preventDefault();if(current?.id!==noteId||storing||ask.disabled)return;
      const asking=e.submitter===ask;storing=true;
      const retainSource=doc&&(scope.value==='page'||!!quote||!!existing?.documentId);
      const anchor={...savedAnchor,id:savedAnchor?.id||crypto.randomUUID(),scope:scope.value,documentId:retainSource?doc.id:null,sha256:retainSource?doc.sha256:null,page:retainSource?page:null,quote,comment:comment.value,createdAt:savedAnchor?.createdAt||new Date().toISOString(),editedAt:new Date().toISOString()};
      if(editIndex===null){editIndex=current.anchors.length;current.anchors.push(anchor);}else current.anchors[editIndex]=anchor;
      savedAnchor=anchor;changes();try{await flush();renderAnchors();window.getSelection()?.removeAllRanges();if(e.submitter===contextButton)await TutorContext.open({kind:'note',...questionContext(anchor)},anchor.comment);else if(asking)await sendQuestion(questionContext(anchor),anchor.comment,output,ask);else dialog.close();}catch(err){notify(err.message);}finally{storing=false;}
    }},E('div',{class:'eyebrow'},doc?doc.title+' · pág. PDF '+page:'APUNTE GENERAL'),E('h2',{},quote?'Anotar este fragmento':'Nueva anotación'),E('label',{},'Vincular a',scope),quote?E('blockquote',{},quote):null,comment,E('div',{class:'dialog-actions'},E('button',{type:'button',class:'quiet',onclick:()=>dialog.close()},'Cerrar · Esc'),E('button',{type:'submit',class:'primary'},'Guardar comentario'),ask),output));
    dialog.querySelector('.dialog-actions').append(contextButton);
    dialog.addEventListener('close',()=>{dialog.remove();pdfSelection=null;});document.body.append(dialog);dialog.showModal();if(existing)comment.value=existing.comment||'';comment.focus();
  }
  function upload(){const input=E('input',{type:'file',accept:'.pdf,application/pdf',hidden:'hidden'});document.body.append(input);input.addEventListener('change',async()=>{try{const file=input.files[0];if(!file)return;if(file.size>20000000)throw new Error('Adjuntá un PDF de hasta 20 MB.');status('Preparando PDF…');const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});const doc=await api('/api/documents',{title:file.name,base64:encoded});if(!data().documents.some(d=>d.id===doc.id))data().documents.push(doc);await usePdf(doc);render();}catch(err){notify(err.message);status('El apunte sigue guardado.');}finally{input.remove();}});input.click();}
  async function exportNote(id=current?.id){
    if(!id)return;
    try{if(id===pristineId)changes();await flush();const note=noteById(id);if(!note)return;const link=E('a',{href:GlosaRoom.url('/api/notes/'+encodeURIComponent(note.id)+'/markdown'),download:note.title.replace(/[^\p{L}\p{N} _-]/gu,'').slice(0,100)+'.md'});document.body.append(link);link.click();link.remove();}catch(e){notify(e.message);}
  }

  document.addEventListener('visibilitychange',()=>{if(document.hidden&&dirty()){remember();flush().catch(()=>{});}});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshFromServer();});
  window.addEventListener('focus',()=>{refreshFromServer();});
  document.addEventListener('selectionchange',()=>{const input=VimEditors.sourceFor(document.activeElement);if(input?.matches('#class-note-content,.note-cell-content'))scheduleCursorFollow(input);});
  document.addEventListener('pointerdown',e=>{const options=document.getElementById('note-options');if(options?.open&&!options.contains(e.target))options.open=false;});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){const options=document.getElementById('note-options');if(options?.open){options.open=false;options.querySelector('summary').focus({preventScroll:true});}}});
  window.addEventListener('resize',()=>{
    if(view==='notes'){const layout=splitLayout();if(layout){const saved=parseFloat(GlosaRoom.storage.getItem('class-note-split:'+current.id));setSplit(Number.isFinite(saved)?saved:Number(layout.dataset.readerShare),false);}}
    clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(view==='notes'&&pdf&&mode()!=='page')paint({preserveScroll:true}).catch(pdfError);},150);
  });
  window.addEventListener('beforeunload',()=>{if(current&&dirty()){remember();navigator.sendBeacon('/api/notes',new Blob([JSON.stringify(current)],{type:'application/json'}));}});
  return {render,flush,select,current:()=>current,currentId:()=>currentId,applyStudy,refresh:refreshFromServer,create,mode,closePdf,openList,closeList,highlightSelection,annotate,askCurrent,openTutor,edit,editMarkdown,showRecords,refreshTutorHistory:renderTutorHistory,sendQuestion,input:activeWritingInput,followCursor:()=>followNoteCursor(activeWritingInput(),false),newPageCell,moveCell,contextTarget:()=>({kind:'note',...questionContext()}),openPdf,readStep,zoomBy,rename,properties,deleteNote,changePage,exportNote,upload,startResize,endResize,resizeSplit,resetSplit,leave:()=>{liveEditor?.destroy();liveEditor=null;prefaceEditor?.destroy();prefaceEditor=null;readerObserver?.disconnect();clearTimeout(resizeTimer);document.body.classList.remove('resizing-pointer');clearTimeout(cursorTimer);current=null;currentId=null;pristineId=null;baseline=null;closeList();generation++;renderTask?.cancel();document.querySelector('.workspace').classList.remove('notes-view');}};
})();
