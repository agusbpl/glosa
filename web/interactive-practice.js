'use strict';
// Assisted exploration stays separate from scored exercises and student events.
window.InteractivePractice = {
  render(practice, course, lesson) {
    const el=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
    const button=(text,cls,action)=>{const b=el('button',text,cls);b.type='button';b.addEventListener('click',action);return b;};
    const box=el('section','','interactive-practice practice-studio'),isOrder=practice.kind==='order';
    const key='interactive-draft:'+JSON.stringify([GlosaRoom.id,course.id,course.version,lesson.id]);
    let draft={};try{draft=JSON.parse(GlosaRoom.storage.getItem(key)||'{}')||{};}catch{}
    const categories=isOrder?practice.items.map((_,i)=>String(i+1)):practice.categories;
    let answers=Object.fromEntries(practice.items.map(i=>[i.id,categories.includes(draft[i.id])?draft[i.id]:'']));
    let order=practice.items.map(i=>i.id),selected=null,checked=false;
    if(isOrder&&Object.values(answers).every(Boolean)&&new Set(Object.values(answers)).size===order.length)order.sort((a,b)=>Number(answers[a])-Number(answers[b]));
    const heading=el('div','','practice-heading'),count=el('span','','practice-count');
    heading.append(el('span',isOrder?'RECONSTRUIR EL RECORRIDO':'CONECTAR LAS IDEAS','eyebrow'),count);
    box.append(heading,el('h2',practice.title),el('p',practice.prompt,'practice-prompt'));
    const progress=el('div','','practice-progress');progress.setAttribute('role','progressbar');progress.setAttribute('aria-label','Elementos ubicados');progress.setAttribute('aria-valuemin','0');progress.setAttribute('aria-valuemax',practice.items.length);
    const fill=el('span');progress.append(fill);box.append(progress);
    const hint=el('p',isOrder?'Mové los pasos con las flechas hasta que el recorrido tenga sentido.':'Elegí una tarjeta y después su categoría. También podés arrastrarla.','practice-hint');
    const board=el('div','','practice-board'),feedback=el('div','','practice-feedback'),status=el('p','','practice-status');
    status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const check=button(isOrder?'Comprobar recorrido':'Comprobar relaciones','primary practice-check',()=>{
      if(!isOrder&&practice.items.some(i=>!answers[i.id]))return;
      checked=true;draw();
      const correct=practice.items.filter(i=>answers[i.id]===i.answer).length;
      const title=el('h3',correct===practice.items.length?'Las relaciones encajan':'Hay relaciones para revisar');
      feedback.replaceChildren(title,el('p',`${correct} de ${practice.items.length} coincidencias con la guía.`),el('p',practice.explanation));
      feedback.hidden=false;status.textContent='Devolución disponible debajo del tablero.';
    });
    function persist(){try{GlosaRoom.storage.setItem(key,JSON.stringify(answers));}catch{status.textContent='No se pudo guardar el borrador. Podés seguir practicando.';}}
    function clearFeedback(){checked=false;feedback.hidden=true;feedback.replaceChildren();}
    function move(id,category){answers[id]=category;selected=null;clearFeedback();draw();status.textContent=category?'Tarjeta ubicada en '+category+'.':'Tarjeta devuelta a pendientes.';persist();board.querySelector(`[data-card="${CSS.escape(id)}"]`)?.focus({preventScroll:true});}
    function card(item){
      const chosen=selected===item.id,correct=answers[item.id]===item.answer;
      const card=button('','practice-card'+(chosen?' is-selected':'')+(checked?(correct?' is-correct':' needs-review'):''),()=>{
        selected=selected===item.id?null:item.id;draw();status.textContent=selected?'Tarjeta elegida. Elegí una categoría de destino.':'Selección cancelada.';board.querySelector(`[data-card="${CSS.escape(item.id)}"]`)?.focus({preventScroll:true});
      });
      card.dataset.card=item.id;card.setAttribute('aria-pressed',String(chosen));card.setAttribute('aria-label',item.text);
      card.draggable=true;card.addEventListener('dragstart',e=>{selected=item.id;e.dataTransfer.setData('text/plain',item.id);e.dataTransfer.effectAllowed='move';});
      card.append(el('span','⠿','practice-grip'),el('span',item.text,'practice-card-text'));
      if(checked)card.append(el('span',correct?'✓ Coincide':'↗ Guía: '+item.answer,'practice-verdict'));
      return card;
    }
    function zone(title,category,items,index){
      const zone=el('section','','practice-zone'+(category?'':' practice-bank'));
      const destination=button('','practice-zone-head',()=>{
        if(selected)move(selected,category);else status.textContent='Primero elegí una tarjeta.';
      });
      destination.setAttribute('aria-label','Mover tarjeta a '+title);
      destination.append(el('span',category?String(index+1).padStart(2,'0'):'↗','practice-zone-index'),el('span',title),el('span',String(items.length),'practice-zone-count'));
      zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('is-over');});
      zone.addEventListener('dragleave',()=>zone.classList.remove('is-over'));
      zone.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('is-over');const id=e.dataTransfer.getData('text/plain');if(practice.items.some(i=>i.id===id))move(id,category);});
      const stack=el('div','','practice-stack');items.forEach(i=>stack.append(card(i)));
      if(!items.length)stack.append(el('span',category?'Ubicá una tarjeta acá':'Todas las tarjetas están ubicadas','practice-empty'));
      zone.append(destination,stack);return zone;
    }
    function draw(){
      board.replaceChildren();
      if(isOrder){
        order.forEach((id,index)=>{answers[id]=String(index+1);});
        const list=el('ol','','practice-order');
        order.forEach((id,index)=>{
          const item=practice.items.find(i=>i.id===id),row=el('li','','practice-step'+(checked?(answers[id]===item.answer?' is-correct':' needs-review'):''));
          row.append(el('span',String(index+1).padStart(2,'0'),'practice-step-number'),el('span',item.text,'practice-card-text'));
          const controls=el('div','','practice-step-controls');
          for(const [delta,label,glyph] of [[-1,'Subir','↑'],[1,'Bajar','↓']]){
            const b=button(glyph,'practice-step-move',()=>{
              const target=index+delta;[order[index],order[target]]=[order[target],order[index]];clearFeedback();draw();persist();status.textContent=`${item.text}: posición ${target+1}.`;
              const focus=board.querySelector(`[data-move="${CSS.escape(id+':'+delta)}"]`);
              (focus?.disabled?board.querySelector(`[data-move="${CSS.escape(id+':'+(-delta))}"]`):focus)?.focus({preventScroll:true});
            });b.disabled=index+delta<0||index+delta>=order.length;b.setAttribute('aria-label',label+' '+item.text);b.dataset.move=id+':'+delta;controls.append(b);
          }
          row.append(controls);if(checked)row.append(el('span',answers[id]===item.answer?'✓ Coincide':'Guía: paso '+item.answer,'practice-verdict'));list.append(row);
        });board.append(list);
      }else{
        board.append(zone('Por ubicar','',practice.items.filter(i=>!answers[i.id]),-1));
        const grid=el('div','','practice-categories');categories.forEach((c,i)=>grid.append(zone(c,c,practice.items.filter(item=>answers[item.id]===c),i)));board.append(grid);
      }
      const n=practice.items.filter(i=>answers[i.id]).length;count.textContent=`${n} / ${practice.items.length} ${isOrder?'pasos':'ubicadas'}`;fill.style.width=`${n/practice.items.length*100}%`;progress.setAttribute('aria-valuenow',n);check.disabled=n<practice.items.length;
    }
    const reset=button('Reiniciar','text-button',()=>{answers=Object.fromEntries(practice.items.map(i=>[i.id,'']));order=practice.items.map(i=>i.id);selected=null;clearFeedback();draw();persist();status.textContent='Tablero reiniciado.';});
    const actions=el('div','','practice-actions');actions.append(check,reset);
    const note=el('details','','practice-note');note.append(el('summary','Sobre esta práctica'),el('p','El tablero sirve para explorar con ayuda. La comprensión se comprueba después, al explicar un caso nuevo.'));
    feedback.hidden=true;box.append(hint,board,actions,status,feedback,note);draw();return box;
  }
};
