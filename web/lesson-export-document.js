'use strict';
// Standalone document: no network, storage, app state or student records.
(() => {
  const data=JSON.parse(document.getElementById('lesson-export-data').textContent);
  const root=document.getElementById('lesson-export-root');
  const el=(tag,text='',attrs={})=>{const n=document.createElement(tag);n.textContent=text;for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);return n;};
  const button=(text,action)=>{const b=el('button',text,{type:'button',class:'quiet'});b.addEventListener('click',action);return b;};
  const noteIds=new Map((data.notes||[]).map((n,i)=>[String(n.id),'export-note-'+i]));
  function inline(target,text){
    const pattern=/\[([^\]\n]+)\]\(([^\s)]+)\)|\*\*([^*]+)\*\*/g;let start=0,match;
    while((match=pattern.exec(String(text)))){
      target.append(document.createTextNode(String(text).slice(start,match.index)));
      if(match[3])target.append(el('strong',match[3]));
      else {const href=match[2],note=/^#note[=-]/.test(href)?noteIds.get(href.slice(6)):null;
        if(note){const a=el('a',match[1],{href:'#'+note});a.addEventListener('click',()=>{document.getElementById(note).open=true;});target.append(a);}
        else if(/^https:\/\//i.test(href)){target.append(el('a',match[1],{href,target:'_blank',rel:'noopener noreferrer'}));}
        else target.append(document.createTextNode(match[1]));
      }start=pattern.lastIndex;
    }target.append(document.createTextNode(String(text).slice(start)));
  }
  function prose(target,text){for(const part of String(text||'').split(/\n\s*\n/)){if(!part.trim())continue;const p=el('p','',{class:'theory'});inline(p,part);target.append(p);}}
  function solution(target,text){if(!data.includeSolutions||!text)return;const details=el('details','',{class:'solution'});details.append(el('summary','Ver orientación / solución'));prose(details,text);target.append(details);}
  const header=el('header');header.append(el('p','GLOSA',{class:'brand'}),el('h1',data.title),el('p',data.includeSolutions?'Incluye soluciones y orientaciones.':'Sin soluciones. Las respuestas se conservan solo mientras este documento está abierto.'),button('Imprimir / guardar PDF',()=>window.print()));root.append(header);
  const nav=el('details','',{class:'export-index'});nav.append(el('summary','Contenido del pliego'));const toc=el('ol');nav.append(toc);root.append(nav);
  const practice=el('section','',{id:'export-practice'});practice.append(el('h2','Práctica'));
  function interactive(p,target){
    const box=el('section','',{class:'activity'});box.append(el('h4',p.title||'Exploración'),el('p',p.prompt||''));
    const items=p.items||[];const answers=new Map(),board=el('div'),status=el('p','',{role:'status','aria-live':'polite'});let order=[...items];
    function draw(){board.replaceChildren();order.forEach((item,i)=>{const row=el('div','',{class:'practice-row'});row.append(el('span',item.label||item.text||item.id));if(p.kind==='order'){row.prepend(el('span',String(i+1)));for(const [label,delta] of [['Subir',-1],['Bajar',1]]){const b=button(label,()=>{[order[i],order[i+delta]]=[order[i+delta],order[i]];status.textContent='';draw();});b.disabled=i+delta<0||i+delta>=order.length;row.append(b);}}else{const select=el('select','',{'aria-label':'Categoría de '+(item.label||item.text||item.id)});select.append(el('option','Elegí categoría…',{value:''}));for(const c of p.categories||[])select.append(el('option',c,{value:c}));select.value=answers.get(item.id)||'';select.addEventListener('change',()=>{answers.set(item.id,select.value);status.textContent='';});row.append(select);}board.append(row);});}
    box.append(board,button('Reiniciar',()=>{answers.clear();order=[...items];status.textContent='';draw();}));
    if(data.includeSolutions&&items.every(i=>i.answer!==undefined))box.append(button('Comprobar',()=>{const count=items.filter(item=>(p.kind==='order'?String(order.indexOf(item)+1):answers.get(item.id))===String(item.answer)).length;status.textContent=`${count} de ${items.length} coincidencias con la guía. ${p.explanation||''}`;}));
    box.append(status);draw();target.append(box);
  }
  function simulation(kind,target){const box=el('section','',{class:'activity'});target.append(box);const out=el('div','',{role:'status','aria-live':'polite'});
    if(kind==='integration'){box.append(el('h3','Un pedido, tres versiones de la realidad'),el('p','Modelo didáctico: el pedido reduce las unidades disponibles.'));const check=el('input','',{type:'checkbox'}),range=el('input','',{type:'range',min:0,max:20,value:5});const l=el('label','Conectar los sistemas ');l.append(check);const r=el('label','Unidades del pedido ');r.append(range);const update=()=>{const n=Number(range.value);out.textContent=`Pedido: ${n}. Ventas: ${20-n} unidades disponibles. Depósito y portal: ${check.checked?20-n:20}. ${check.checked?'Comparten el cambio.':'Todavía no recibieron el cambio.'}`;};check.addEventListener('change',update);range.addEventListener('input',update);box.append(l,r,out,el('p','¿Qué datos deben compartirse y en qué momento? ¿Qué ocurre si los sistemas identifican al producto de manera diferente?'));update();}
    else{box.append(el('h3','Un tablero puede decir cosas distintas'),el('p','Datos ficticios de dos productos.'));const select=el('select','',{'aria-label':'Medida del tablero'});select.append(el('option','Facturación',{value:'sales'}),el('option','Margen de contribución',{value:'margin'}));const update=()=>{out.replaceChildren();const values=select.value==='sales'?[10000,7000]:[1000,2800];values.forEach((v,i)=>{const row=el('div',`Producto ${i?'B':'A'}: $ ${v.toLocaleString('es-AR')}`,{class:'metric-bar'});row.style.setProperty('--bar',100*v/Math.max(...values)+'%');out.append(row);});};select.addEventListener('change',update);box.append(select,out,el('p','¿Por qué cambia la interpretación al elegir otra medida? ¿Qué otros factores necesitás para decidir?'));update();}
  }
  for(const [ci,course] of (data.courses||[]).entries()){
    const chapter=el('section','',{class:'course'});chapter.append(el('h2',course.title));prose(chapter,course.description);root.append(chapter);
    for(const [li,lesson] of (course.lessons||[]).entries()){
      const id=`export-lesson-${ci}-${li}`,article=el('article','',{id});chapter.append(article);const item=el('li');item.append(el('a',lesson.title,{href:'#'+id}));toc.append(item);
      article.append(el('p',[lesson.unit,lesson.minutes?lesson.minutes+' min':null].filter(Boolean).join(' · '),{class:'eyebrow'}),el('h2',lesson.title));if(lesson.mode!=='exam')prose(article,lesson.intro);
      const rendered=new Set();const visuals=Array.isArray(lesson.visuals)?lesson.visuals:[];
      function visual(v){if(window.LearningVisuals){article.append(window.LearningVisuals.render(v));rendered.add(v);}}
      for(const block of (lesson.mode==='exam'?[]:lesson.blocks||[])){article.append(el('h3',block.title||''));prose(article,block.text);for(const v of visuals.filter(v=>v.blockId===block.id))visual(v);if(block.references?.length){const refs=el('p','',{class:'references'});refs.textContent=block.references.map(r=>{const source=(course.sources||[]).find(s=>s.id===(r.sourceId||r.source));return [r.title||source?.title||'Fuente',r.page?'pág. '+r.page:null,r.locator].filter(Boolean).join(' · ');}).join(' / ');article.append(refs);}}
      for(const v of visuals)if(lesson.mode!=='exam'&&!rendered.has(v))visual(v);
      if(lesson.mode!=='exam'&&lesson.simulation)simulation(typeof lesson.simulation==='string'?lesson.simulation:lesson.simulation.kind,article);
      if(lesson.interactive||(lesson.exercises||[]).length){const section=el('section','',{class:'lesson-practice'});section.append(el('h3',lesson.title),el('a','Volver a la lección',{href:'#'+id}));practice.append(section);if(lesson.mode!=='exam'&&lesson.interactive)interactive(lesson.interactive,section);
        for(const [ei,e] of (lesson.exercises||[]).entries()){const box=el('fieldset','',{class:'exercise'});box.append(el('legend',e.question||''));if(e.options?.length){e.options.forEach((option,oi)=>{const label=el('label'),input=el('input','',{type:'radio',name:`export-question-${ci}-${li}-${ei}`,value:oi});label.append(input,document.createTextNode(typeof option==='string'?option:option.text||option.label||''));box.append(label);});}else{box.append(el('textarea','',{rows:4,'aria-label':e.question||'Tu respuesta',placeholder:'Tu respuesta…'}));}let accepted=e.acceptedAnswer;if(e.correctIndex!==undefined&&e.options)accepted=e.options[e.correctIndex];if(typeof accepted==='object')accepted=accepted?.text||accepted?.label;solution(box,[accepted,e.explanation].filter(Boolean).join('\n\n'));section.append(box);}
      }
      if(lesson.resources?.length){const resources=el('section');resources.append(el('h3','Material relacionado'));for(const r of lesson.resources){const p=el('p');if(/^https:\/\//i.test(r.url||''))p.append(el('a',r.title||'Recurso',{href:r.url,target:'_blank',rel:'noopener noreferrer'}));else p.textContent=(r.title||'Material de referencia')+' · Archivo local no incluido en esta exportación.';resources.append(p);}article.append(resources);}
    }
  }
  if(practice.children.length>1){const item=el('li');item.append(el('a','Práctica',{href:'#export-practice'}));toc.append(item);root.append(practice);}
  if((data.notes||[]).length){const glossary=el('section','',{id:'export-glossary'});glossary.append(el('h2','Notas de conceptos'));const item=el('li');item.append(el('a','Notas de conceptos',{href:'#export-glossary'}));toc.append(item);for(const note of data.notes){const details=el('details','',{id:noteIds.get(String(note.id)),class:'concept-note'});details.append(el('summary',note.title));prose(details,note.content);glossary.append(details);}root.append(glossary);}
  let previous=[];window.addEventListener('beforeprint',()=>{previous=[...root.querySelectorAll('details')].map(n=>[n,n.open]);for(const [n] of previous)n.open=true;});window.addEventListener('afterprint',()=>{for(const [n,open] of previous)n.open=open;});
})();
