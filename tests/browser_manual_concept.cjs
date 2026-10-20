// Manual concept creation in an isolated workspace; no tutor/provider calls.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path'),net=require('net'),{spawn}=require('child_process');
(async()=>{
 const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'glosa-own-note-'));
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const service=spawn('python3',['server.py'],{cwd:root,env:{...process.env,LEARNING_DATA_DIR:data,GLOSA_MARGEN_DIR:path.join(data,'margen'),LEARNING_PORT:String(port),OPENROUTER_API_KEY:''},stdio:'ignore'});
 const base=`http://127.0.0.1:${port}`;let browser;
 try{
  for(let n=0;n<100;n++){try{if((await fetch(base+'/api/state')).ok)break;}catch{}if(n===99)throw Error('Startup failed');await new Promise(r=>setTimeout(r,100));}
  const course={schemaVersion:1,id:'qa-own-note',version:'1',title:'Materia temporal',sources:[],lessons:[{id:'one',title:'Procesos',unit:'Unidad',intro:'Leé.',minutes:10,priority:1,blocks:[{id:'b',title:'Datos',text:'Un dato maestro identifica una entidad reutilizable. Un pedido registra una operación.\n\n'+Array(90).fill('Esta explicación extensa permite comprobar que la lectura vuelve al mismo lugar.').join('\n\n')}],exercises:[{id:'e',type:'open',question:'Explicá',rubric:['Relaciona']}]}]};
  const r=await fetch(base+'/api/course',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(course)});assert(r.ok);
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||chromium.executablePath()});const page=await browser.newPage({viewport:{width:1200,height:900}});let tutorCalls=0;
  await page.route('**/api/tutor',route=>{tutorCalls++;route.abort();});
  await page.addInitScript(()=>{localStorage.setItem('glosa-active-room','local');localStorage.setItem('study-course','qa-own-note');localStorage.setItem('study-lesson','one');localStorage.setItem('glosa-tutor-channel','mcp');});
  await page.goto(base+'#study');await page.waitForSelector('.theory');
  await page.evaluate(()=>{const node=document.querySelector('.theory').firstChild,range=document.createRange();range.setStart(node,3);range.setEnd(node,15);const s=getSelection();s.removeAllRanges();s.addRange(range);});
  await page.evaluate(()=>captureReadingHighlight());await page.locator('.theory mark').first().click();
  assert.equal(await page.locator('.reading-highlight-actions .create-concept-note').count(),1);
  assert.equal(await page.locator('.reading-highlight-actions').getByRole('button',{name:'Dejar una nota',exact:true}).count(),0);
  await page.getByRole('button',{name:'Crear nota de concepto',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Crear nota de concepto',exact:true});await dialog.waitFor();
  await page.getByLabel('Contenido de la nota',{exact:true}).fill('Es una entidad que reutilizo en muchas transacciones.\n\nPor ejemplo, un proveedor.\n\n'+Array(90).fill('Una explicación propia que se conserva al volver de la lección.').join('\n\n'));
  await page.getByRole('button',{name:'Guardar nota',exact:true}).click();await page.locator('.concept-note-dialog').waitFor({state:'detached'});await page.getByRole('link',{name:'dato maestro',exact:true}).waitFor();
  assert.equal(await page.locator('.concept-note-dialog[open]').count(),0,'saving a linked note closes its dialog');
  const state=await page.evaluate(()=>fetch('/api/state').then(r=>r.json())),updated=state.courses.find(c=>c.id==='qa-own-note');
  const note=state.library.notes.find(n=>n.title==='dato maestro');assert(note);assert.equal(note.shared,false);assert(note.content.includes('un proveedor'));
  assert(updated.lessons[0].blocks[0].text.includes(`[dato maestro](#note=${note.id})`));assert(state.events.some(e=>e.kind==='course_version'));assert.equal(tutorCalls,0);
  await page.getByRole('link',{name:'dato maestro',exact:true}).click();await page.waitForFunction(id=>ClassNotes.current()?.id===id,note.id);
  assert((await page.locator('.note-editor').innerText()).includes('un proveedor'));
  await page.evaluate(()=>WorkspaceKeys.go('study'));await page.getByRole('link',{name:'dato maestro',exact:true}).waitFor();
  await page.evaluate(()=>{ViewPosition.cancel();scrollTo(0,1000);});await page.waitForTimeout(100);
  await page.evaluate(()=>WorkspaceKeys.go('notes'));await page.waitForFunction(id=>ClassNotes.current()?.id===id,note.id);
  await page.evaluate(()=>{ViewPosition.cancel();scrollTo(0,850);});await page.waitForTimeout(100);
  await page.evaluate(()=>WorkspaceKeys.go('study'));try{await page.waitForFunction(()=>Math.abs(scrollY-1000)<3,undefined,{timeout:5000});}catch(e){console.log('STUDY POSITION',await page.evaluate(()=>({view,cid,lid,y:scrollY,stored:ViewPosition.read(),h:document.body.scrollHeight})));throw e;}
  await page.evaluate(()=>{ViewPosition.cancel();});await page.evaluate(()=>WorkspaceKeys.go('notes'));try{await page.waitForFunction(()=>Math.abs(scrollY-850)<3,undefined,{timeout:5000});}catch(e){console.log('NOTE POSITION',await page.evaluate(()=>({view,y:scrollY,id:ClassNotes.currentId(),stored:ViewPosition.read(),h:document.body.scrollHeight})));throw e;}
  assert.equal(await page.evaluate(()=>ClassNotes.currentId()),note.id);
  await page.evaluate(()=>{ViewPosition.cancel();});await page.evaluate(()=>WorkspaceKeys.go('study'));

  await page.reload();await page.getByRole('link',{name:'dato maestro',exact:true}).waitFor();assert.equal(tutorCalls,0);
  await page.setViewportSize({width:390,height:844});await page.evaluate(async()=>{const root=document.querySelector('.theory'),walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;while(node=walker.nextNode()){const start=node.textContent.indexOf('pedido');if(start<0)continue;const range=document.createRange();range.setStart(node,start);range.setEnd(node,start+6);getSelection().removeAllRanges();getSelection().addRange(range);break;}await captureReadingHighlight();});await page.locator('.theory mark').filter({hasText:'pedido'}).first().click();const toolbar=page.getByRole('dialog',{name:'Acciones del resaltado'});await toolbar.waitFor();
  const bounds=await toolbar.boundingBox();assert(bounds.x>=0&&bounds.x+bounds.width<=390);assert.equal(await page.getByRole('button',{name:'Generar nota sobre ello',exact:true}).count(),1);
  await toolbar.evaluate(n=>n.close());
  await page.evaluate(()=>{scrollTo(0,0);});
  await page.evaluate(async()=>{const note=state.library.notes.find(n=>n.title==='dato maestro');await api('/api/notes/delete',{id:note.id,revision:note.revision});state=await api('/api/state');render();});
  await page.getByRole('link',{name:'dato maestro',exact:true}).click();
  await page.getByRole('dialog',{name:'Enlace a nota',exact:true}).waitFor();
  await page.getByRole('button',{name:'Quitar enlace',exact:true}).click();
  await page.getByText('Enlace quitado. El texto se conserva.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('link',{name:'dato maestro',exact:true}).count(),0);
  assert((await page.locator('.theory').first().innerText()).includes('dato maestro'));
  await page.evaluate(()=>{const root=document.querySelector('.theory');const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode()){const i=n.textContent.indexOf('pedido');if(i<0)continue;const range=document.createRange();range.setStart(n,i);range.setEnd(n,i+6);getSelection().removeAllRanges();getSelection().addRange(range);break;}createStudyNoteFromSelection({manual:true});});
  await page.getByLabel('Contenido de la nota',{exact:true}).fill('Una operación comercial independiente.');
  await page.getByLabel('Enlazar el término con esta nota',{exact:true}).uncheck();
  await page.getByRole('button',{name:'Guardar nota',exact:true}).click();
  await page.locator('.concept-note-dialog').waitFor({state:'detached'});
  await page.waitForFunction(()=>state.library.notes.some(n=>n.title==='pedido'));
  assert.equal(await page.locator('.concept-note-dialog[open]').count(),0,'saving an unlinked note closes its dialog');
  assert.equal(await page.getByRole('link',{name:'pedido',exact:true}).count(),0);
  assert.equal(await page.getByText('Nota guardada en la biblioteca.',{exact:true}).count(),0);
  const savedNote=await page.evaluate(()=>state.library.notes.find(n=>n.title==='pedido'));assert(savedNote);
  await page.evaluate(()=>{const root=document.querySelector('.theory'),walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode()){const i=n.textContent.indexOf('pedido');if(i<0)continue;const range=document.createRange();range.setStart(n,i);range.setEnd(n,i+6);getSelection().removeAllRanges();getSelection().addRange(range);break;}createStudyNoteFromSelection({manual:true});});
  assert.equal(await page.getByLabel('Contenido de la nota',{exact:true}).inputValue(),'Una operación comercial independiente.');
  await page.getByLabel('Contenido de la nota',{exact:true}).fill('Una operación comercial editada en su nota existente.');
  await page.getByLabel('Enlazar el término con esta nota',{exact:true}).uncheck();await page.getByRole('button',{name:'Guardar nota',exact:true}).click();
  await page.locator('.concept-note-dialog').waitFor({state:'detached'});
  await page.waitForFunction(()=>state.library.notes.some(n=>n.content.includes('editada en su nota existente')));
  const reused=await page.evaluate(()=>state.library.notes.filter(n=>n.title==='pedido'));assert.equal(reused.length,1);assert.equal(reused[0].id,savedNote.id);assert(reused[0].revision>savedNote.revision);
  console.log('OK: student-written concept, automatic link, private native note, version history, open/reload, MCP without provider calls, mobile toolbar and generation retained.');
 }finally{if(browser)await browser.close();service.kill();fs.rmSync(data,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
