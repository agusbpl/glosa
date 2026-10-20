'use strict';
window.ActivityCalendar=(()=>{
  const node=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
  const parse=s=>new Date(s+'T12:00:00'),iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const duration=s=>s<60?(s?'Menos de 1 min':'Sin actividad registrada'):s<3600?`${Math.floor(s/60)} min`:`${Math.floor(s/3600)} h ${Math.floor(s%3600/60)} min`;
  const level=s=>s<=0?0:s<900?1:s<2700?2:s<5400?3:4;
  function mount(root){
    let year=new Date().getFullYear(),month=new Date().getMonth(),mode='year',data,selected,controller;
    root.classList.add('activity-calendar');
    const heading=node('div','','activity-heading'),title=node('h2','Tu actividad'),controls=node('div','','activity-controls');
    const modeSelect=node('select');modeSelect.setAttribute('aria-label','Vista de actividad');for(const [value,label] of [['year','Año'],['month','Mes']]){const o=node('option',label);o.value=value;modeSelect.append(o);}
    const previous=node('button','←'),next=node('button','→'),period=node('span','','activity-period');previous.type=next.type='button';previous.setAttribute('aria-label','Período anterior');next.setAttribute('aria-label','Período siguiente');
    controls.append(modeSelect,previous,period,next);heading.append(title,controls);
    const intro=node('p','Tiempo activo en todos tus pliegos. Estudio y trabajo con apuntes, sin sumar dos veces los tramos simultáneos.','activity-caption');
    const status=node('p','Cargando actividad…','activity-caption');status.setAttribute('role','status');
    const chart=node('div','','activity-chart'),legend=node('div','','activity-legend'),detail=node('section','','activity-detail');detail.setAttribute('aria-label','Detalle del día');
    legend.append(node('span','Menos'));for(let i=0;i<5;i++){const swatch=node('i','','activity-cell');swatch.dataset.level=i;swatch.title=['Sin tiempo','Menos de 15 min','15–44 min','45–89 min','90 min o más'][i];legend.append(swatch);}legend.append(node('span','Más · 90 min o más'));
    const hint=node('p','Se registra al estudiar o escribir con la ventana activa. Después de 1 min sin interacción se pausa. No se reconstruye el tiempo de notas antiguas.','activity-caption');
    root.replaceChildren(heading,intro,status,chart,legend,detail,hint);
    function showDay(day){
      selected=day.date;chart.querySelectorAll('button[data-date]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.date===selected)));
      detail.replaceChildren(node('h3',parse(day.date).toLocaleDateString('es-AR',{weekday:'long',day:'numeric',month:'long'})),node('p',day.seconds?`${duration(day.seconds)} · Estudio: ${duration(day.studySeconds)} · Apuntes: ${duration(day.writingSeconds)}`:'No hay tiempo activo registrado ese día.'));
      for(const item of day.items){const row=node('div','','activity-day-item');row.append(node('span',[item.roomTitle,item.courseTitle,item.noteTitle||item.lessonTitle||(item.view==='notes'?'Notas':'Estudio')].filter(Boolean).join(' · ')),node('strong',duration(item.seconds)));detail.append(row);}
      const yesterday=data.days.find(d=>d.date===iso(new Date(parse(day.date).setDate(parse(day.date).getDate()-1))));
      if(yesterday)detail.append(node('p',`Día anterior: ${duration(yesterday.seconds)}. El tiempo refleja actividad, no una medida de aprendizaje.`,'activity-caption'));
    }
    function dayButton(day){
      const b=node('button','','activity-cell');b.type='button';b.dataset.date=day.date;b.dataset.level=level(day.seconds);b.disabled=day.date>data.today;
      b.title=b.getAttribute('aria-label')||`${parse(day.date).toLocaleDateString('es-AR',{day:'numeric',month:'long',year:'numeric'})}: ${duration(day.seconds)}`;b.setAttribute('aria-label',b.title);b.setAttribute('aria-pressed',String(day.date===selected));b.onclick=()=>showDay(day);
      b.onkeydown=e=>{const list=[...chart.querySelectorAll('button[data-date]')],i=list.indexOf(b),offset=mode==='year'?{ArrowUp:-1,ArrowDown:1,ArrowLeft:-7,ArrowRight:7}:{ArrowUp:-7,ArrowDown:7,ArrowLeft:-1,ArrowRight:1};if(e.key in offset){e.preventDefault();list[i+offset[e.key]]?.focus();}};
      return b;
    }
    function render(){
      chart.replaceChildren();period.textContent=mode==='year'?String(year):new Date(year,month,1).toLocaleDateString('es-AR',{month:'long',year:'numeric'});
      next.disabled=year>=new Date().getFullYear()&&(mode==='year'||month>=new Date().getMonth());previous.disabled=year<=1970&&(mode==='year'||month===0);
      const days=data.days.filter(d=>mode==='year'||parse(d.date).getMonth()===month),grid=node('div','',mode==='year'?'activity-year-grid':'activity-month-grid');
      if(mode==='year'){
        const labels=node('div','','activity-weekdays');for(const label of ['L','M','M','J','V','S','D'])labels.append(node('span',label));
        const offset=(parse(days[0].date).getDay()+6)%7;for(let i=0;i<offset;i++)grid.append(node('span'));
        for(const day of days){const b=dayButton(day);if(parse(day.date).getDate()===1){b.dataset.month=parse(day.date).toLocaleDateString('es-AR',{month:'short'});b.style.setProperty('--weekday',(parse(day.date).getDay()+6)%7);}grid.append(b);}
        const scroll=node('div','','activity-year-scroll');scroll.append(grid);chart.append(labels,scroll);
        requestAnimationFrame(()=>{const focus=grid.querySelector(`[data-date="${selected||data.today}"]`);if(focus)scroll.scrollLeft=Math.max(0,focus.getBoundingClientRect().left-scroll.getBoundingClientRect().left+scroll.scrollLeft-scroll.clientWidth+40);});
      }else{
        for(const label of ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'])grid.append(node('span',label,'activity-week-label'));
        const offset=(parse(days[0].date).getDay()+6)%7;for(let i=0;i<offset;i++)grid.append(node('span'));
        for(const day of days){const b=dayButton(day);b.textContent=parse(day.date).getDate();grid.append(b);}chart.append(grid);
      }
      const seconds=days.reduce((sum,d)=>sum+d.seconds,0),active=days.filter(d=>d.seconds>0).length;
      status.textContent=`${duration(seconds)} · ${active} ${active===1?'día':'días'} con actividad${data.warnings.length?' · Algunos pliegos no se pudieron leer.':''}`;
      showDay(days.find(d=>d.date===selected)||days.find(d=>d.date===data.today)||[...days].reverse().find(d=>d.date<=data.today)||days[0]);
    }
    async function load(){
      controller?.abort();controller=new AbortController();status.textContent='Cargando actividad…';
      try{const r=await fetch('/api/activity-calendar?year='+year,{signal:controller.signal});if(!r.ok)throw Error();const result=await r.json();if(!root.isConnected)return;data=result;render();}
      catch(e){if(e.name!=='AbortError'){status.textContent='No pudimos cargar la actividad.';const retry=node('button','Reintentar');retry.type='button';retry.onclick=load;status.append(' ',retry);}}
    }
    modeSelect.onchange=()=>{mode=modeSelect.value;render();};
    function move(delta){if(mode==='year')year+=delta;else{month+=delta;if(month<0){month=11;year--;}if(month>11){month=0;year++;}}load();}
    previous.onclick=()=>move(-1);next.onclick=()=>move(1);root.refreshActivity=load;load();
  }
  return {mount};
})();
