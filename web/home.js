'use strict';
window.GlosaHome = (() => {
  let data, dialog, content, status, search = '', selectedDay;
  const paths = {
    arrow:'M5 12h14m-6-6 6 6-6 6', plus:'M12 5v14M5 12h14', close:'m6 6 12 12M6 18 18 6',
    search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
    book:'M12 5C8 3 4 3 2 4v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-2-1-6-1-10 1Zm0 0v15',
    calendar:'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2',
    upload:'M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5', more:'M5 12h.01M12 12h.01M19 12h.01',
    edit:'m16 3 5 5-12 12H4v-5ZM14 5l5 5', trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
    settings:'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    folder:'M3 7V4h6l2 3h10v13H3Z',
    clock:'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', back:'m14 6-6 6 6 6'
  };
  function node(tag, attrs = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else if (value !== false && value != null) el.setAttribute(key, value);
    }
    el.append(...children.filter(c => c != null)); return el;
  }
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [k,v] of Object.entries({viewBox:'0 0 24 24', fill:'none', stroke:'currentColor', 'stroke-width':'1.5', 'stroke-linecap':'round', 'stroke-linejoin':'round', 'aria-hidden':'true'})) svg.setAttribute(k,v);
    const path = document.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', paths[name]); svg.append(path); return svg;
  }
  function button(label, name, action, cls = '', iconOnly = false) {
    return node('button', {type:'button', class:'home-button '+cls+(name==='arrow'?' home-trailing':''), 'aria-label':label, title:iconOnly ? label : null, onclick:() => Promise.resolve().then(action).catch(error)}, icon(name), iconOnly ? null : node('span', {}, label));
  }
  function error(err) { status.textContent = err.message; }
  async function api(path, body) {
    const response = await fetch(path, {headers:{'Content-Type':'application/json','X-Glosa-Room':'primer-trazo'}, ...(body ? {method:'POST', body:JSON.stringify(body)} : {})});
    const result = await response.json(); if (!response.ok) throw Error(result.error || 'No se pudo completar.'); return result;
  }
  const dateLabel = (day, opts) => new Date(day+'T12:00:00').toLocaleDateString('es-AR', opts);
  const room = id => data.pliegos.find(p => p.id === id);
  const summary = p => [p.contents?.courses != null ? `${p.contents.courses} ${p.contents.courses === 1 ? 'curso' : 'cursos'}` : '', p.contents?.notes ? `${p.contents.notes} ${p.contents.notes===1 ? 'apunte' : 'apuntes'}` : ''].filter(Boolean).join(' · ');
  async function refresh() { data = await api('/api/home'); render(); document.dispatchEvent(new Event('glosa-agenda-refresh')); }
  async function show() {
    await ClassNotes.flush(); await flushTime(); studying = false;
    if (!dialog) {
      content = node('div', {class:'home-content'}); status = node('p', {class:'home-status', role:'status'});
      dialog = node('dialog', {id:'home-dialog', 'aria-label':'Inicio de Glosa'}, content, status);
      dialog.addEventListener('cancel', e => e.preventDefault());
      dialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();}});
      document.body.append(dialog);
    }
    if (!dialog.open) dialog.showModal();
    document.title = 'Glosa · Tu Margen';
    content.replaceChildren(node('div', {class:'home-loading'}, 'GLOSA'));
    try { await refresh(); } catch (err) {
      content.replaceChildren(node('h1', {}, 'Tu Margen'), button('Reintentar', 'arrow', refresh), button('Ajustes del Margen', 'settings', settings)); error(err);
    }
  }
  async function enter(id, intent = {}) {
    localStorage.setItem('glosa-last-pliego', id);
    if (id !== GlosaRoom.id) { sessionStorage.setItem('glosa-home-intent', JSON.stringify({roomId:id, ...intent})); await GlosaRoom.activate(id); return; }
    if (intent.courseId && state.courses.some(c => c.id === intent.courseId)) { cid = intent.courseId; lid = course().lessons[0]?.id; }
    document.querySelectorAll('.home-modal[open]').forEach(el=>el.close());
    dialog?.close();
    if (intent.action === 'note') {
      await WorkspaceKeys.go('notes');
      await ClassNotes.create({title:intent.title, folder:intent.folder});
    } else await WorkspaceKeys.go(intent.action === 'plan' ? 'plan' : 'study');
  }
  function render() {
    const header = node('header', {class:'home-header'}, node('span', {class:'home-brand'}, 'GLOSA'), button('Ajustes generales', 'settings', () => window.GlosaSettings?.open ? window.GlosaSettings.open() : settings(), '', true));
    const title = node('div', {class:'home-title'}, node('div', {}, node('h1', {}, '¿Qué vas a estudiar hoy?'), node('p', {}, dateLabel(data.today, {weekday:'long', day:'numeric', month:'long'}))),
      node('div', {class:'home-actions'}, button('Nuevo pliego', 'plus', createRoom, 'home-primary'), button('Importar', 'upload', importRoom)));
    const library = node('section', {class:'home-library', 'aria-label':'Tus pliegos'});
    const active = data.activeClasses.filter(e => room(e.roomId));
    const last = room(localStorage.getItem('glosa-last-pliego')) || room(GlosaRoom.id) || data.pliegos.toSorted((a,b)=>(b.modified||0)-(a.modified||0))[0];
    if (active.length) for (const event of active) library.append(classCard(event));
    else if (last) library.append(node('section', {class:'home-continue'}, node('div', {}, node('small', {class:'home-eyebrow'}, 'CONTINUAR'), node('h2', {}, last.title), node('p', {}, summary(last))), button('Abrir', 'arrow', () => enter(last.id), 'home-primary')));
    const input = node('input', {type:'search', placeholder:'Buscar pliegos…', 'aria-label':'Buscar pliegos', oninput:e => { search=e.target.value; renderRows(); }}); input.value=search;
    library.append(node('div', {class:'home-list-heading'}, node('h2', {}, 'Tus pliegos'), node('label', {class:'home-search'}, icon('search'), input)));
    const rows = node('div', {id:'home-pliegos'}); library.append(rows);
    function renderRows() {
      rows.replaceChildren();
      for (const p of data.pliegos.filter(p => p.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()))) {
        rows.append(node('div', {class:'home-room'}, node('button', {class:'home-room-open', onclick:() => enter(p.id).catch(error)}, node('span', {class:'home-book'}, icon('book')), node('span', {}, node('strong', {}, p.title), node('small', {}, summary(p)))), button('Opciones de '+p.title, 'more', () => roomMenu(p), '', true)));
      }
      if (!rows.childElementCount) rows.append(node('p', {class:'home-empty'}, search ? 'No hay coincidencias.' : 'Tu primer pliego empieza acá.', !search ? button('Crear pliego', 'plus', createRoom) : null));
    }
    renderRows();
    const aside = node('aside', {class:'home-agenda', 'aria-label':'Próximos días'}, node('div', {class:'home-agenda-heading'}, node('h2', {}, 'Próximos días'), button('Agregar evento o clase', 'plus', () => editEvent(), '', true)));
    const future = data.upcoming.filter(e => room(e.roomId));
    for (const event of future.slice(0, 4)) aside.append(eventRow(event));
    if (!future.length) aside.append(node('div', {class:'home-agenda-empty'}, icon('calendar'), node('p', {}, 'Tu agenda está libre.'), data.pliegos.length ? button('Cargar horario', 'plus', () => editEvent()) : node('p',{class:'home-empty-prerequisite'},'Crear un pliego para cargar horarios.')));
    aside.append(button('Ver calendario', 'arrow', showCalendar, 'home-agenda-link'));
    const footer = node('footer', {class:'home-footer'}, button('Primer trazo · Tutorial', 'book', () => enter('primer-trazo')), data.legacyLocal ? button('Biblioteca local', 'book', () => enter('local')) : null, button('Horarios de clase', 'clock', () => showCalendar(true)), button('Ubicación del Margen', 'settings', () => window.GlosaSettings?.open ? window.GlosaSettings.open('margen') : settings()));
    content.replaceChildren(header, title, node('div', {class:'home-columns'}, library, aside), footer);
    status.textContent = data.warnings.join(' · ');
  }
  function classCard(event) {
    const p=room(event.roomId);
    return node('section', {class:'home-continue home-class'}, node('div', {}, node('small', {class:'home-eyebrow'}, `${event.started ? 'AHORA' : 'EN UNOS MINUTOS'} · ${event.time}–${event.endTime}`), node('h2', {}, p.title), node('p', {}, event.title)),
      node('div', {class:'home-class-actions'}, button('Tomar apuntes', 'edit', () => enter(p.id, {action:'note', courseId:event.courseId, title:`${event.title} · ${dateLabel(event.occurrenceDate, {day:'numeric', month:'long', year:'numeric'})}`, folder:p.courses?.find(c => c.id===event.courseId)?.title || p.title}), 'home-primary'), button('Abrir pliego', 'arrow', () => enter(p.id, {courseId:event.courseId}))));
  }
  function eventRow(event) {
    const day=event.occurrenceDate;
    return node('button', {class:'home-event', onclick:() => event.source==='margen' ? editEvent(data.agenda.events.find(e => e.id===event.id)) : enter(event.roomId, {action:'plan', courseId:event.courseId}).catch(error)},
      node('span', {class:'home-event-date'}, node('small', {}, dateLabel(day, {weekday:'short'})), node('strong', {}, dateLabel(day, {day:'numeric'})), node('small', {}, dateLabel(day, {month:'short'}))),
      node('span', {class:'home-event-info'}, node('strong', {}, event.title), node('small', {}, room(event.roomId)?.title || ''), node('small', {}, event.time ? `${event.time}${event.endTime ? '–'+event.endTime : ''}` : 'Todo el día')));
  }
  function modal(label) {
    const box=node('dialog', {class:'home-modal', 'aria-label':label}), form=node('form');
    const heading=node('div', {class:'home-modal-heading'}, node('h2', {}, label), button('Cerrar', 'close', () => box.close(), '', true));
    form.append(heading); box.append(form); box.addEventListener('close', () => box.remove()); document.body.append(box); box.showModal(); return {box,form};
  }
  function settings() {
    const {box,form}=modal('Ubicación del Margen');
    const folder=node('input',{required:true,readonly:true,'aria-label':'Carpeta del Margen'});
    folder.value=data?.margen.path || '';
    const fixed=data?.margen.source==='environment';folder.disabled=fixed;
    const message=node('p',{role:'status'},fixed ? 'Definida por GLOSA_MARGEN_DIR.' : 'Cambiar la ubicación no mueve tus archivos.');
    const save=node('button',{type:'submit',class:'home-button home-primary',disabled:fixed},icon('settings'),'Usar carpeta');
    const browse=button('Elegir carpeta','folder',async()=>{browse.disabled=true;message.textContent='';try{const result=await api('/api/margen/choose-folder',{});if(result.folder)folder.value=result.folder;}catch(err){message.textContent=err.message;}finally{browse.disabled=false;}});browse.disabled=fixed;
    form.append(node('label',{class:'home-field'},node('span',{},'Carpeta del Margen'),folder),browse,message,node('div',{class:'home-actions'},button('Cancelar','close',()=>box.close()),save));
    form.addEventListener('submit',async e=>{e.preventDefault();save.disabled=true;try{await api('/api/margen',{folder:folder.value});await refresh();box.close();}catch(err){message.textContent=err.message;save.disabled=false;}});
  }
  function mountSettings(target) {
    if(!target)return;
    target.replaceChildren();
    const field=node('input',{required:true,readonly:true,'aria-label':'Carpeta del Margen'});field.value=data?.margen.path||'';
    const fixed=data?.margen.source==='environment';field.disabled=fixed;
    const message=node('p',{role:'status'},fixed?'Definida por GLOSA_MARGEN_DIR.':'Cambiar la ubicación no mueve tus archivos.');
    const browse=node('button',{type:'button',class:'quiet',disabled:fixed,onclick:async()=>{browse.disabled=true;try{const result=await api('/api/margen/choose-folder',{});if(result.folder)field.value=result.folder;}catch(err){message.textContent=err.message;}finally{browse.disabled=fixed;}}},'Elegir carpeta');
    const save=node('button',{type:'button',class:'quiet',disabled:fixed,onclick:async()=>{save.disabled=true;try{await api('/api/margen',{folder:field.value});await refresh();message.textContent='Ubicación del Margen guardada.';}catch(err){message.textContent=err.message;}finally{save.disabled=fixed;}}},'Usar carpeta');
    target.append(node('p',{class:'muted'},'Los pliegos y respaldos se guardan en esta carpeta.'),node('label',{class:'home-field'},node('span',{},'Carpeta del Margen'),field),node('div',{class:'inline-actions'},browse,save),message);
  }
  function importRoom() {
    const {box,form}=modal('Importar pliego');
    const file=node('input',{type:'file',accept:'.zip,application/zip','aria-label':'Respaldo ZIP',class:'home-file-input',id:'home-zip-file'});
    const fileName=node('span',{class:'home-file-name','aria-live':'polite'},'Ningún archivo seleccionado');
    file.addEventListener('change',()=>{fileName.textContent=file.files[0]?.name||'Ningún archivo seleccionado';});
    const folder=node('input',{'aria-label':'Carpeta del respaldo',placeholder:'/ruta/al/respaldo'});
    const message=node('p',{role:'status'}),submit=node('button',{type:'submit',class:'home-button home-primary'},icon('upload'),'Importar y abrir');
    form.append(node('p',{class:'muted'},'Se crea un pliego nuevo con una copia del respaldo.'),node('div',{class:'home-field'},node('span',{},'Archivo ZIP'),node('div',{class:'home-file-row'},node('label',{for:'home-zip-file',class:'home-button home-file-button'},'Elegir archivo'),file,fileName)),node('details',{},node('summary',{},'Importar desde una carpeta'),node('label',{class:'home-field'},node('span',{},'Carpeta del respaldo'),folder)),message,submit);
    async function run(body){submit.disabled=true;try{const item=await api('/api/rooms/import',body);box.close();await enter(item.id);}catch(err){message.textContent=err.message;submit.disabled=false;}}
    form.addEventListener('submit',async e=>{
      e.preventDefault();const selected=file.files[0];
      if(selected){
        if(selected.size>60000000){message.textContent='El ZIP admite hasta 60 MB.';return;}
        submit.disabled=true;
        try{const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(Error('No se pudo leer el ZIP.'));reader.readAsDataURL(selected);});await run({base64});}catch(err){message.textContent=err.message;submit.disabled=false;}
      }else if(folder.value.trim())await run({folder:folder.value.trim()});
      else message.textContent='Elegí un ZIP o indicá una carpeta.';
    });
    if(data?.backups.length){const copies=node('details',{},node('summary',{},'Copias detectadas'));for(const backup of data.backups)copies.append(button(backup.title,'upload',()=>run({folder:backup.folder})));form.append(copies);}
  }
  async function createRoom() {
    const {box,form}=modal('Nuevo pliego');
    const input=node('input', {required:true, maxlength:200, 'aria-label':'Nombre del pliego', placeholder:'Nombre del pliego'});
    const message=node('p', {role:'status'}), submit=node('button', {type:'submit', class:'home-button home-primary'}, icon('plus'), 'Crear pliego');
    form.append(input,message,submit); input.focus();
    form.addEventListener('submit', async e => { e.preventDefault(); submit.disabled=true; try { const item=await api('/api/rooms/create', {title:input.value}); box.close(); await enter(item.id); } catch(err) { message.textContent=err.message; submit.disabled=false; } });
  }
  function roomMenu(p) {
    const {box,form}=modal(p.title);box.classList.add('home-room-menu');
    form.append(button('Abrir pliego', 'arrow', () => {box.close();return enter(p.id);}), button('Renombrar', 'edit', async () => {
      const name=node('input', {required:true, maxlength:200, 'aria-label':'Nuevo nombre'}); name.value=p.title;
      const save=node('button', {type:'submit', class:'home-button home-primary'}, icon('edit'), 'Guardar'); const message=node('p', {role:'status'});
      form.replaceChildren(node('h2', {}, 'Renombrar pliego'), name, message, save, button('Cancelar', 'close', () => box.close())); name.focus();
      form.addEventListener('submit', async e => {e.preventDefault();save.disabled=true;try {await api('/api/rooms/rename', {id:p.id, title:name.value});box.close();await refresh();}catch(err){message.textContent=err.message;save.disabled=false;}});
    }), button('Exportar pliego', 'upload', async () => {
      const response=await fetch(GlosaRoom.url('/api/rooms/export').replace(/room=[^&]*/, 'room='+encodeURIComponent(p.id)), {headers:{'X-Glosa-Room':p.id}});
      if(!response.ok)throw Error((await response.json()).error);
      const url=URL.createObjectURL(await response.blob()), link=node('a',{href:url,download:p.title+'.zip'}); link.click(); setTimeout(()=>URL.revokeObjectURL(url),10000);box.close();
    }), button('Eliminar pliego', 'trash', () => {box.close();deleteRoom(p);}, 'home-danger'));
  }
  function deleteRoom(p) {
    const {box,form}=modal('Eliminar pliego');
    const message=node('p',{role:'status'});
    const remove=button('Eliminar pliego','trash',async()=>{
      remove.disabled=true;
      try {
        await ClassNotes.flush();await flushTime();
        const result=await api('/api/rooms/delete',{id:p.id});
        if(localStorage.getItem('glosa-last-pliego')===p.id)localStorage.removeItem('glosa-last-pliego');
        box.close();
        if(GlosaRoom.id===p.id){localStorage.setItem('glosa-active-room','primer-trazo');sessionStorage.removeItem('glosa-home-intent');location.hash='';location.reload();return;}
        await refresh();status.textContent='Pliego movido a la papelera: '+result.trashPath;
      } catch(err){message.textContent=err.message;remove.disabled=false;}
    },'home-danger');
    form.append(node('p',{},'¿Eliminar «'+p.title+'» de tus pliegos?'),node('p',{class:'muted'},'Su carpeta completa se moverá a .papelera dentro del Margen. Podés recuperarla desde el explorador de archivos.'),message,node('div',{class:'home-actions'},button('Cancelar','back',()=>box.close()),remove));
  }
  function showCalendar(timetable=false) {
    const {box,form}=modal('Calendario del Margen'); box.classList.add('home-calendar-modal');
    let month=new Date((selectedDay || data.today)+'T12:00:00'), requestId=0;
    const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const label=node('h3'), grid=node('div',{class:'home-month-grid'}), list=node('div',{class:'home-calendar-list'}), message=node('p',{role:'status'});
    const tabs=node('div',{class:'home-actions'},button('Calendario','calendar',()=>{timetable=false;paint();}),button('Horario semanal','clock',()=>{timetable=true;paint();}));
    async function paint() {
      const sequence=++requestId;grid.replaceChildren();list.replaceChildren();message.textContent='';
      const first=new Date(month.getFullYear(),month.getMonth(),1,12), start=new Date(first);
      start.setDate(1-(first.getDay()+6)%7);
      label.textContent=timetable ? 'Horario semanal' : month.toLocaleDateString('es-AR',{month:'long',year:'numeric'});
      if(timetable) {
        const classes=data.agenda.events.filter(e=>e.kind==='class' && room(e.roomId)).sort((a,b)=>(new Date(a.date+'T12:00:00').getDay()+6)%7-(new Date(b.date+'T12:00:00').getDay()+6)%7 || a.time.localeCompare(b.time));
        for(const event of classes)list.append(node('div',{class:'home-timetable-row'},node('div',{},node('strong',{},dateLabel(event.date,{weekday:'long'})),node('small',{},`${event.time}–${event.endTime}`)),button(event.title,'edit',()=>editEvent(event)),node('small',{},room(event.roomId).title)));
        if(!classes.length)list.append(node('p',{},'Todavía no cargaste horarios de clase.'));
        return;
      }
      try {
        const calendar=await api('/api/home?from='+iso(start));if(sequence!==requestId || !box.open)return;
        for(const name of ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'])grid.append(node('span',{class:'home-weekday'},name));
        for(let i=0;i<42;i++) {
          const day=new Date(start);day.setDate(start.getDate()+i);const stamp=iso(day), events=calendar.upcoming.filter(e=>e.occurrenceDate===stamp && room(e.roomId));
          const cell=node('section',{class:'home-month-day'+(day.getMonth()!==month.getMonth()?' home-outside':'')+(stamp===data.today?' home-today':'')});
          cell.append(button(String(day.getDate()),'plus',()=>{selectedDay=stamp;paint();},'home-day-number'),button('Agregar evento para '+dateLabel(stamp,{day:'numeric',month:'long'}),'plus',()=>{selectedDay=stamp;editEvent();},'home-day-add','true'));
          const visible=events.slice(0,2);
          for(const event of visible)cell.append(node('button',{type:'button',class:'home-month-event',title:`${event.title} · ${room(event.roomId).title}`,onclick:()=>event.source==='margen' ? editEvent(data.agenda.events.find(e=>e.id===event.id)) : enter(event.roomId,{action:'plan',courseId:event.courseId}).catch(error)},event.time ? event.time+' ' : '',event.title));
          if(events.length>visible.length)cell.append(button(`Ver ${events.length-visible.length} eventos más`,'more',()=>{selectedDay=stamp;list.replaceChildren(node('h3',{},dateLabel(stamp,{weekday:'long',day:'numeric',month:'long'})),...events.map(eventRow));},'home-day-more'));
          grid.append(cell);
        }
        if(!selectedDay)selectedDay=data.today;
        const selectedEvents=calendar.upcoming.filter(e=>e.occurrenceDate===selectedDay&&room(e.roomId));
        list.append(node('h3',{},dateLabel(selectedDay,{weekday:'long',day:'numeric',month:'long'})),...selectedEvents.map(eventRow));
        if(!selectedEvents.length)list.append(node('p',{class:'muted'},'Sin eventos para este día.'));
        const monthDetails=node('details',{},node('summary',{},'Ver todo el mes'));list.append(monthDetails);
        const monthly=calendar.upcoming.filter(e=>e.occurrenceDate.slice(0,7)===iso(first).slice(0,7)&&room(e.roomId));
        monthDetails.append(...monthly.map(eventRow));if(!monthly.length)monthDetails.append(node('p',{},'Sin eventos registrados.'));
      }catch(err){message.textContent=err.message;}
    }
    const move=amount=>{month=new Date(month.getFullYear(),month.getMonth()+amount,1,12);selectedDay=iso(month);timetable=false;return paint();};
    form.append(tabs,node('div',{class:'home-calendar-tools'},node('div',{class:'home-actions'},button('Mes anterior','back',()=>move(-1),'',true),label,button('Mes siguiente','arrow',()=>move(1),'',true)),button('Agregar evento o clase','plus',()=>editEvent(), 'home-primary')),message,grid,list);
    const update=()=>paint();document.addEventListener('glosa-agenda-refresh',update);box.addEventListener('close',()=>{requestId++;document.removeEventListener('glosa-agenda-refresh',update);});paint();
  }
  function editEvent(event=null) {
    if(!data.pliegos.length) {createRoom(); return;}
    const {box,form}=modal(event ? 'Editar evento' : 'Evento o clase');
    const field=(label,input)=>{input.setAttribute('aria-label',label);return node('label', {class:'home-field'}, node('span',{},label),input);};
    const title=node('input',{required:true,maxlength:200}); title.value=event?.title || '';
    const select=node('select',{},...data.pliegos.map(p=>node('option',{value:p.id},p.title))); select.value=event?.roomId || data.pliegos[0].id;
    const course=node('select');
    function courses(){course.replaceChildren(node('option',{value:''},'Todo el pliego'),...(room(select.value)?.courses || []).map(c=>node('option',{value:c.id},c.title)));} courses(); course.value=event?.courseId || '';select.addEventListener('change',courses);
    const kind=node('select',{},...Object.entries({class:'Clase',exam:'Parcial / examen',deadline:'Entrega',study:'Estudio'}).map(([value,label])=>node('option',{value},label))); kind.value=event?.kind || 'class';
    const day=node('input',{type:'date',required:true}); day.value=event?.date || selectedDay || data.today;
    const start=node('input',{type:'time'});start.value=event?.time || '';
    const end=node('input',{type:'time'});end.value=event?.endTime || '';
    const until=node('input',{type:'date'});until.value=event?.repeatUntil || '';
    const excluded=node('input',{placeholder:'2026-10-19, 2026-10-26'});excluded.value=(event?.excludedDates || []).join(', ');
    const timing=()=>{start.required=kind.value==='class';end.required=kind.value==='class';};kind.addEventListener('change',timing);timing();
    const more=node('details',{},node('summary',{},'Repetición y excepciones'),field('Repetir cada semana hasta',until),field('Fechas sin clase · separadas por coma',excluded));
    const message=node('p',{role:'status'}),save=node('button',{type:'submit',class:'home-button home-primary'},icon('calendar'),'Guardar');
    const revision=data.agenda.revision;
    async function persist(body){save.disabled=true;try{await api('/api/agenda',{...body,expectedRevision:revision});box.close();await refresh();}catch(err){message.textContent=err.message;save.disabled=false;}}
    form.append(field('Título',title),node('div',{class:'home-form-grid'},field('Pliego',select),field('Curso',course)),node('div',{class:'home-form-grid'},field('Tipo',kind),field('Fecha',day)),node('div',{class:'home-form-grid'},field('Desde',start),field('Hasta',end)),more,message,
      node('div',{class:'home-actions'},button('Cancelar','close',()=>box.close()),event ? button('Eliminar','trash',()=>{if(confirm('¿Eliminar este evento del horario?'))return persist({action:'delete',id:event.id});}) : null,save));
    form.addEventListener('submit',e=>{e.preventDefault();persist({event:{id:event?.id,title:title.value,roomId:select.value,courseId:course.value,kind:kind.value,date:day.value,time:start.value,endTime:end.value,repeatUntil:until.value,excludedDates:excluded.value.split(',').map(s=>s.trim()).filter(Boolean)}});});title.focus();
  }
  async function boot() {
    const raw=sessionStorage.getItem('glosa-home-intent');sessionStorage.removeItem('glosa-home-intent');
    if(raw) {try {const intent=JSON.parse(raw);if(intent.roomId===GlosaRoom.id){await enter(intent.roomId,intent);return;}}catch{}}
    if(location.hash) return;
    await show();
  }
  setInterval(()=>{if(dialog?.open && !document.hidden && !document.querySelector('.home-modal[open]') && !['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName))refresh().catch(error);},60000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden && dialog?.open)refresh().catch(error);});
  return {show,boot,mountSettings};
})();
