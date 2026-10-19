'use strict';
window.StudyPlan=(()=>{
  let mode='today',selected=null;
  const names={theory:'Teoría',practice:'Práctica',deadline:'Entrega',exam:'Parcial / examen',study:'Estudio'};
  const dateOf=value=>new Date(value+'T12:00:00');
  const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const shift=(value,days)=>{const d=dateOf(value);d.setDate(d.getDate()+days);return iso(d);};
  const label=value=>dateOf(value).toLocaleDateString('es-AR',{weekday:'long',day:'numeric',month:'long'});
  const events=()=>state.calendarEvents.filter(e=>e.courseId===cid);
  function onDay(day){
    const found=events().filter(e=>e.date===day||(e.repeatUntil&&day>=e.date&&day<=e.repeatUntil&&Math.round((dateOf(day)-dateOf(e.date))/86400000)%7===0));
    if(day===state.settings.examDate&&!events().some(e=>e.kind==='exam'&&e.date===day))found.push({id:'settings-exam',title:'Examen',kind:'exam',date:day,virtual:true});
    return found.sort((a,b)=>(a.time||'').localeCompare(b.time||'')||a.title.localeCompare(b.title));
  }
  function allowance(day){const weekday=dateOf(day).getDay();return state.settings.dailyOverrides?.[day]??(weekday===0||weekday===6?state.settings.weekendMinutes:state.settings.weekdayMinutes);}
  function eventButton(event){return E('button',{class:'calendar-event text-button','data-kind':event.kind,'aria-label':event.title+' · '+names[event.kind]+(event.time?' · '+event.time:''),onclick:()=>event.virtual?showSettings():edit(event)},E('small',{'data-has-time':event.time?'true':'false'},event.time||names[event.kind]),E('span',{},event.title));}
  function dayCell(day,month=null){
    const out=E('section',{class:'calendar-day'+(day===state.localDate?' is-today':'')+(month!==null&&dateOf(day).getMonth()!==month?' outside-month':''),'data-date':day});
    out.append(E('button',{class:'text-button calendar-date',onclick:()=>{selected=day;mode='today';render();}},dateOf(day).toLocaleDateString('es-AR',{weekday:mode==='week'?'short':undefined,day:'numeric'})));
    const dayEvents=onDay(day),visible=month!==null?dayEvents.slice(0,2):dayEvents;
    for(const event of visible)out.append(eventButton(event));
    if(month!==null&&dayEvents.length>visible.length)out.append(E('button',{class:'text-button calendar-more','aria-label':`Ver ${dayEvents.length-visible.length} eventos más de ${label(day)}`,onclick:()=>{selected=day;mode='today';render();}},`+${dayEvents.length-visible.length} más`));
    if(mode==='week')out.append(E('small',{class:'muted calendar-allowance'},`${allowance(day)} min disponibles`));
    return out;
  }
  function calendar(){
    const d=dateOf(selected),month=d.getMonth();let start,count;
    if(mode==='week'){start=shift(selected,-((d.getDay()+6)%7));count=7;}else{d.setDate(1);start=shift(iso(d),-((d.getDay()+6)%7));const last=new Date(d.getFullYear(),month+1,0,12);count=Math.ceil((((d.getDay()+6)%7)+last.getDate())/7)*7;}
    const title=mode==='week'?`Semana del ${dateOf(start).toLocaleDateString('es-AR',{day:'numeric',month:'long'})}`:d.toLocaleDateString('es-AR',{month:'long',year:'numeric'});
    const controls=E('div',{class:'calendar-navigation'},E('button',{class:'text-button','aria-label':'Período anterior',onclick:()=>move(-1)},'←'),E('h2',{},title),E('button',{class:'text-button','aria-label':'Período siguiente',onclick:()=>move(1)},'→'));
    const grid=E('div',{class:'calendar-grid calendar-'+mode,role:'group','aria-label':title});
    if(mode==='month')for(const day of ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'])grid.append(E('div',{class:'calendar-weekday'},day));
    for(let i=0;i<count;i++)grid.append(dayCell(shift(start,i),mode==='month'?month:null));
    return [controls,grid];
  }
  function move(amount){if(mode==='week')selected=shift(selected,7*amount);else{const d=dateOf(selected);d.setDate(1);d.setMonth(d.getMonth()+amount);selected=iso(d);}render();}
  function render(){
    if(!selected)selected=state.localDate;
    const recommendation=state.recommendations[cid];
    const nodes=[E('div',{class:'eyebrow'},'TU CURSADA, A TU RITMO'),E('div',{class:'calendar-heading'},E('h1',{},'Plan'),E('div',{class:'calendar-views'},...Object.entries({today:'Hoy',week:'Semana',month:'Mes',parciales:'Parciales'}).map(([key,text])=>E('button',{class:'text-button'+(mode===key?' active':''),'aria-pressed':mode===key?'true':'false',onclick:()=>{mode=key;if(key==='today')selected=state.localDate;render();}},text)))),E('div',{class:'calendar-actions'},E('button',{class:'text-button',onclick:()=>edit()},'＋ Evento'),E('button',{class:'text-button',onclick:()=>{selected=state.localDate;render();}},'Volver a hoy'))];
    if(mode==='parciales'){
      const panel=E('section',{class:'plan-parciales'});
      nodes.push(panel);
      if(window.TutorModes?.mount)window.TutorModes.mount(panel,{state}).catch(err=>panel.replaceChildren(E('p',{class:'muted'},err.message)));
      else panel.replaceChildren(E('p',{class:'muted'},'La vista global de parciales todavía no está disponible en esta instalación.'));
    }else if(mode==='today'){
      const list=onDay(selected);
      nodes.push(E('h2',{},label(selected)),E('p',{class:'muted'},`${allowance(selected)} min de disponibilidad declarada. No representa una sesión programada.`),...list.map(eventButton));
      if(!list.length)nodes.push(E('p',{class:'muted'},'No hay eventos para este día.'));
      if(selected===state.localDate)nodes.push(E('section',{class:'plan-next'},E('div',{class:'eyebrow'},'PARA ESTUDIAR HOY'),E('h2',{},course().lessons.find(l=>l.id===recommendation.lessonId)?.title||'Continuar'),E('p',{},recommendation.reason),E('button',{class:'text-button',onclick:()=>chooseLesson(recommendation.lessonId)},'Abrir lección →')));
      const upcoming=[];for(let i=1;i<=30;i++)for(const event of onDay(shift(selected,i)))upcoming.push({event,day:shift(selected,i)});
      nodes.push(E('h2',{},'Próximos compromisos'),...(upcoming.length?upcoming.slice(0,8).map(({event,day})=>E('div',{class:'calendar-upcoming'},E('small',{class:'muted'},label(day)),eventButton(event))):[E('p',{class:'muted'},'No hay compromisos registrados en los próximos 30 días.')]));
    }else nodes.push(...calendar());
    const status=state.recommendations[cid].statuses;
    nodes.push(E('details',{class:'plan-course-details'},E('summary',{},'Recorrido y pendientes'),...course().lessons.map(l=>E('div',{class:'plan-row'},E('button',{class:'text-button',onclick:()=>chooseLesson(l.id)},l.title),E('small',{class:'muted'},`${l.minutes} min · ${statusLabel[status[l.id]||'unseen']}`),activeReviews(l.id).length?E('button',{class:'text-button','aria-label':'Deshacer revisión de '+l.title,onclick:async()=>{try{await undoReview(l.id);}catch(err){notify(err.message);}}},'Deshacer revisión'):null))),E('p',{class:'muted'},'El calendario pertenece al curso elegido. Clases y entregas pueden cargarse acá o por MCP; no se inventan horarios. La fecha de examen y la disponibilidad de Ajustes se comparten entre los cursos.'),E('button',{class:'text-button',onclick:showSettings},'Ajustes · g a'));
    document.getElementById('main').replaceChildren(...nodes);
  }
  function edit(event=null){
    const dialog=E('dialog',{class:'calendar-edit-dialog'}),form=E('form');
    const title=E('input',{required:'required',maxlength:200,'aria-label':'Título del evento'});title.value=event?.title||'';
    const kind=E('select',{'aria-label':'Tipo de evento'},...Object.entries(names).map(([key,text])=>E('option',{value:key},text)));kind.value=event?.kind||'study';
    const day=E('input',{type:'date',required:'required','aria-label':'Fecha del evento'});day.value=event?.date||selected;
    const time=E('input',{type:'time','aria-label':'Hora opcional'});time.value=event?.time||'';
    const until=E('input',{type:'date','aria-label':'Repetir semanalmente hasta'});until.value=event?.repeatUntil||'';
    const targetCid=cid;
    form.append(E('h2',{},event?'Editar evento':'Nuevo evento'),E('label',{},'Título',title),E('label',{},'Tipo',kind),E('label',{},'Fecha',day),E('label',{},'Hora · opcional',time),E('label',{},'Repetir cada semana hasta · opcional',until));
    const save=E('button',{type:'submit',class:'primary'},'Guardar evento');
    const remove=event?E('button',{type:'button',class:'text-button',onclick:async()=>{if(!confirm('¿Quitar este evento del calendario?'))return;remove.disabled=true;try{await api('/api/calendar',{action:'delete',id:event.id,expectedRevision:event.revision});dialog.close();await reload();}catch(err){notify(err.message);remove.disabled=false;}}},'Quitar evento'):null;
    form.append(E('div',{class:'dialog-actions'},E('button',{type:'button',class:'quiet',onclick:()=>dialog.close()},'Cancelar'),remove,save));
    form.addEventListener('submit',async ev=>{ev.preventDefault();save.disabled=true;try{await api('/api/calendar',{event:{id:event?.id,courseId:targetCid,title:title.value,kind:kind.value,date:day.value,time:time.value,repeatUntil:until.value},expectedRevision:event?.revision||0});dialog.close();await reload();}catch(err){notify(err.message);save.disabled=false;}});
    dialog.append(form);dialog.addEventListener('close',()=>dialog.remove(),{once:true});document.body.append(dialog);dialog.showModal();title.focus();
  }
  return {render};
})();
