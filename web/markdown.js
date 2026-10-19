'use strict';
// Marked 17.0.1 parses Markdown; only these DOM nodes can be rendered.
// Raw HTML stays literal and link/image schemes are checked before use.
window.NoteMarkdown=(()=>{
  const safeUrl=value=>{try{const url=new URL(value,location.href);return ['http:','https:','mailto:'].includes(url.protocol)?url.href:null;}catch{return null;}};
  function text(value){
    const fragment=document.createDocumentFragment();
    for(const part of value.split(/(\b(?:github\.com|www\.[a-z0-9.-]+)\/[^\s<>]*)/gi)){
      const href=/^(?:github\.com|www\.)/i.test(part)?safeUrl('https://'+part):null;
      fragment.append(href?E('a',{href,rel:'noopener noreferrer'},part):document.createTextNode(part));
    }
    return fragment;
  }
  function render(tokens,options={}){
    const fragment=document.createDocumentFragment();
    for(const token of tokens||[]){
      const children=()=>render(token.tokens,options);
      let node;
      switch(token.type){
        case 'space':continue;
        case 'heading':node=E('h'+token.depth,{},children());break;
        case 'paragraph':node=E('p',{},children());break;
        case 'text':node=token.tokens?children():text(token.text);break;
        case 'strong':node=E('strong',{},children());break;
        case 'em':node=E('em',{},children());break;
        case 'del':node=E('del',{},children());break;
        case 'codespan':node=E('code',{},token.text);break;
        case 'code':node=E('pre',{},E('code',{},token.text));break;
        case 'br':node=E('br');break;
        case 'hr':node=E('hr');break;
        case 'blockquote':node=E('blockquote',{},children());break;
        case 'link':{
          const href=safeUrl(token.href);node=href?E('a',{href,title:token.title||'',rel:'noopener noreferrer'},children()):children();break;
        }
        case 'image':{
          const src=safeUrl(token.href);node=options.images!==false&&src&&/^https?:/.test(src)?E('img',{src,alt:token.text,title:token.title||'',loading:'lazy'}):text(token.text);break;
        }
        case 'list':
          node=E(token.ordered?'ol':'ul',token.ordered?{start:token.start}:{});
          for(const item of token.items){
            const li=E('li',{},render(item.tokens));
            if(item.task){const check=E('input',{type:'checkbox',disabled:'disabled','aria-label':item.checked?'Completado':'Pendiente'});check.checked=item.checked;li.prepend(check,' ');}
            node.append(li);
          }
          break;
        case 'table':{
          const row=(cells,tag)=>E('tr',{},...cells.map((cell,i)=>E(tag,token.align[i]?{style:'text-align:'+token.align[i]}:{},render(cell.tokens))));
          node=E('div',{class:'note-table-scroll'},E('table',{},E('thead',{},row(token.header,'th')),E('tbody',{},...token.rows.map(cells=>row(cells,'td')))));break;
        }
        default:node=document.createTextNode(token.raw||token.text||'');
      }
      fragment.append(node);
    }
    return fragment;
  }
  return {render:(value,options={})=>render(marked.lexer(value,{gfm:true,breaks:true}),options)};
})();
