'use strict';
window.LearningVisuals = (() => {
  const node = (tag, text, attrs={}) => {
    const el=document.createElement(tag); if(text) el.textContent=text;
    for(const [key,value] of Object.entries(attrs)) el.setAttribute(key,value);
    return el;
  };
  const svgNode = (tag, attrs={}, text='') => {
    const el=document.createElementNS('http://www.w3.org/2000/svg',tag);
    for(const [key,value] of Object.entries(attrs)) el.setAttribute(key,value);
    if(text) el.textContent=text; return el;
  };
  function render(visual) {
    const box=node('figure','',{class:'learning-visual'});
    box.append(node('h3',visual.title),node('figcaption',visual.caption));
    if(visual.kind==='flow') flow(box,visual); else plot(box,visual);
    return box;
  }
  function flow(box,visual) {
    const height=(Math.max(...visual.nodes.map(n=>n.row))+1)*150;
    const svg=svgNode('svg',{viewBox:`0 0 800 ${height}`,role:'img','aria-label':visual.title});
    const markerId='arrow-'+crypto.randomUUID(),defs=svgNode('defs');
    const marker=svgNode('marker',{id:markerId,viewBox:'0 0 10 10',refX:9,refY:5,markerWidth:7,markerHeight:7,orient:'auto-start-reverse'});
    marker.append(svgNode('path',{d:'M 0 0 L 10 5 L 0 10 z',fill:'currentColor'}));defs.append(marker);svg.append(defs);
    const positions=new Map(visual.nodes.map(n=>[n.id,{x:40+n.col*270,y:25+n.row*150}]));
    const edgeViews=visual.edges.map(edge=>{
      const a=positions.get(edge.from),b=positions.get(edge.to),sameRow=a.y===b.y;
      const forward=sameRow?b.x>a.x:b.y>a.y;
      const x1=a.x+(sameRow?(forward?180:0):90),y1=a.y+(sameRow?40:(forward?80:0));
      const x2=b.x+(sameRow?(forward?0:180):90),y2=b.y+(sameRow?40:(forward?0:80));
      const line=svgNode('line',{x1,y1,x2,y2,stroke:'currentColor','stroke-width':2,'marker-end':`url(#${markerId})`});
      line.append(svgNode('title',{},edge.label));svg.append(line);
      const relation=svgNode('text',{x:(x1+x2)/2,y:(y1+y2)/2-10,'text-anchor':'middle',class:'visual-edge-label'},edge.label);
      svg.append(relation);return {edge,line};
    });
    const nodeViews=visual.nodes.map(item=>{
      const p=positions.get(item.id),group=svgNode('g',{'data-node':item.id});
      group.append(svgNode('rect',{...p,width:180,height:80,rx:12}));
      const label=svgNode('text',{x:p.x+90,y:p.y+30,'text-anchor':'middle'});
      const words=item.label.split(/\s+/),lines=[''];
      for(const word of words){if((lines.at(-1)+' '+word).trim().length>22&&lines.at(-1))lines.push('');lines[lines.length-1]=(lines.at(-1)+' '+word).trim();}
      lines.forEach((line,i)=>label.append(svgNode('tspan',{x:p.x+90,dy:i?'1.2em':'0'},line)));
      group.append(label);svg.append(group);return {item,group};
    });
    const scroll=node('div','',{class:'visual-canvas'});scroll.append(svg);box.append(scroll);
    const status=node('p','Elegí un nodo para seguir sus relaciones.',{role:'status','aria-live':'polite'});
    const controls=node('div','',{class:'visual-controls','aria-label':'Explorar diagrama'});
    const buttons=[];
    for(const {item,group} of nodeViews){
      const button=node('button',item.label,{type:'button',class:'quiet','aria-pressed':'false'});
      button.addEventListener('click',()=>{
        nodeViews.forEach(v=>v.group.classList.toggle('visual-selected',v.item.id===item.id));
        buttons.forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
        edgeViews.forEach(v=>v.line.style.opacity=v.edge.from===item.id||v.edge.to===item.id?'1':'.15');
        status.textContent=item.detail+' '+visual.edges.filter(e=>e.from===item.id||e.to===item.id).map(e=>`${visual.nodes.find(n=>n.id===e.from).label} → ${visual.nodes.find(n=>n.id===e.to).label}: ${e.label}.`).join(' ');
      });
      buttons.push(button);controls.append(button);
    }
    box.append(controls,status);
    const details=node('details'),list=node('ul');details.append(node('summary','Leer todas las relaciones'));
    visual.nodes.forEach(n=>list.append(node('li',n.label+': '+n.detail)));
    visual.edges.forEach(e=>list.append(node('li',`${visual.nodes.find(n=>n.id===e.from).label} → ${visual.nodes.find(n=>n.id===e.to).label}: ${e.label}`)));
    details.append(list);box.append(details);
  }
  function plot(box,visual) {
    box.classList.add('visual-plot');
    const svg=svgNode('svg',{viewBox:'0 0 420 340',role:'img','aria-label':visual.title});
    const points=visual.series.flatMap(s=>s.points),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
    const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
    const x=v=>65+(v-minX)/(maxX-minX||1)*330,y=v=>270-(v-minY)/(maxY-minY||1)*230;
    const format=v=>Math.abs(v)>=1e5?v.toExponential(1):Number(v.toPrecision(4)).toLocaleString('es-AR');
    svg.append(svgNode('path',{d:'M65 35 V270 H395',fill:'none',stroke:'currentColor'}));
    for(let i=0;i<=4;i++){
      const xv=minX+(maxX-minX)*i/4,yv=minY+(maxY-minY)*i/4;
      svg.append(svgNode('text',{x:x(xv),y:295,'text-anchor':'middle'},format(xv)),
        svgNode('text',{x:55,y:y(yv)+5,'text-anchor':'end'},format(yv)));
    }
    svg.append(svgNode('text',{x:230,y:330,'text-anchor':'middle'},visual.xLabel),svgNode('text',{x:65,y:20},visual.yLabel));
    const colors=['var(--green)','var(--ink)','var(--muted)'];
    visual.series.forEach((series,i)=>svg.append(svgNode('path',{d:series.points.map((p,j)=>`${j?'L':'M'}${x(p[0])} ${y(p[1])}`).join(' '),fill:'none',stroke:colors[i],'stroke-width':3,'stroke-dasharray':i===1?'10 5':i===2?'3 5':'none'})));
    const dot=svgNode('circle',{r:6,fill:'var(--green)'});svg.append(dot);
    const scroll=node('div','',{class:'visual-canvas'});scroll.append(svg);box.append(scroll);
    const select=node('select','',{'aria-label':'Serie a explorar'});
    visual.series.forEach((s,i)=>select.append(node('option',s.label,{value:i})));
    const slider=node('input','',{type:'range',min:0,value:0,step:1,'aria-label':'Punto a explorar'}),status=node('p','',{role:'status','aria-live':'polite'});
    const update=()=>{const series=visual.series[Number(select.value)];slider.max=series.points.length-1;const p=series.points[Math.min(Number(slider.value),series.points.length-1)];dot.setAttribute('cx',x(p[0]));dot.setAttribute('cy',y(p[1]));status.textContent=`${series.label} · ${visual.xLabel}: ${p[0]} · ${visual.yLabel}: ${p[1]}`;};
    select.addEventListener('change',()=>{slider.value=0;update();});slider.addEventListener('input',update);
    box.append(select,slider,status,node('p','Segmentos entre muestras; no se infiere causalidad. El eje vertical muestra el rango de los datos.',{class:'muted'}));update();
    const details=node('details');details.append(node('summary','Ver datos y leyenda'));
    const table=node('table'),head=node('tr');['Serie',visual.xLabel,visual.yLabel].forEach(t=>head.append(node('th',t)));table.append(head);
    visual.series.forEach((s,i)=>{details.append(node('p',`${s.label}: ${['línea continua','línea discontinua','línea punteada'][i]}.`));s.points.forEach(p=>{const row=node('tr');[s.label,...p].forEach(v=>row.append(node('td',String(v))));table.append(row);});});
    details.append(table);box.append(details);
  }
  return {render};
})();
