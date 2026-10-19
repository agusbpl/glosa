// A real PDF, synthetic tutor and disposable database; no external model calls.
const {chromium}=require('playwright');
const {fixturePDF}=require('./helpers/pdf_fixture.cjs');
const fs=require('fs'),os=require('os'),path=require('path'),net=require('net'),assert=require('assert/strict'),{spawn}=require('child_process');
(async()=>{
 const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'glosa-highlights-')),socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 fs.mkdirSync(path.join(data,'documents'));fs.writeFileSync(path.join(data,'documents','fixture.pdf'),fixturePDF());
 const service=spawn('python3',['-c',`import json,hashlib,server
server.init_db()
doc={'id':'highlight-pdf','title':'PDF temporal','pages':2,'sha256':hashlib.sha256((server.DATA/'documents'/'fixture.pdf').read_bytes()).hexdigest(),'storage':'upload','filename':'fixture.pdf'}
with server.connect() as conn: conn.execute('INSERT INTO documents VALUES(?,?)',(doc['id'],json.dumps(doc)))
server.library().save_note({'id':'pdf-note','title':'PDF resaltados','folder':'','content':'','shared':False,'documentId':doc['id'],'page':1,'writingScope':'page','pageNotes':{doc['id']:{'1':''}},'anchors':[]})
calls=0
def fake(path,body=None,authenticated=True):
 global calls
 calls+=1;(server.DATA/'calls').write_text(str(calls))
 content=json.dumps({'reply':'Explicación final del fragmento.','status':'pending','evidence':[],'gaps':[],'nextAction':'reinforce','notebook':[]}) if 'SOLO con un objeto JSON' in body['messages'][0]['content'] else 'Explicación final del PDF.'
 return {'choices':[{'message':{'content':content},'finish_reason':'stop'}]}
server.openrouter=fake
server.ThreadingHTTPServer(('127.0.0.1',server.PORT),server.Handler).serve_forever()
`],{cwd:root,env:{...process.env,LEARNING_DATA_DIR:data,LEARNING_PORT:String(port),OPENROUTER_API_KEY:'temporary-no-network'},stdio:['ignore','ignore','pipe']});
 let browser,stderr='';service.stderr.on('data',d=>stderr+=d);const base=`http://127.0.0.1:${port}`,snapshot=async()=>await(await fetch(base+'/api/state')).json(),calls=()=>fs.existsSync(path.join(data,'calls'))?Number(fs.readFileSync(path.join(data,'calls'),'utf8')):0;
 try{
  for(let i=0;i<100;i++){try{await snapshot();break;}catch{}await new Promise(r=>setTimeout(r,100));if(i===99)throw Error(stderr);}
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||chromium.executablePath()});const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>localStorage.setItem('glosa-active-room','local'));await page.goto(base);await page.waitForSelector('.theory');
  const select=async(selector,end)=>page.locator(selector).first().evaluate((el,end)=>{const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),node=walker.nextNode(),range=document.createRange();range.setStart(node,0);range.setEnd(node,Math.min(node.length,end));getSelection().removeAllRanges();getSelection().addRange(range);const quote=range.toString();el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));return quote;},end);
  const quote=await select('.theory',35);await page.waitForSelector('.theory mark');assert.equal(await page.locator('#annotation-dialog[open]').count(),0);assert.equal(await page.locator('.reading-highlight-actions[open]').count(),0);assert.equal(calls(),0);
  let saved=(await snapshot()).events.find(e=>e.kind==='annotation');assert.equal(saved.data.type,'highlight');assert.equal(saved.data.quote,quote);assert.equal(saved.data.comment,'');assert.equal(saved.data.shareWithTutor,false);const annotationId=saved.id;
  await page.locator('.theory mark').first().click();await page.getByRole('button',{name:'Dejar una nota',exact:true}).click();await page.getByLabel('Tu comentario',{exact:true}).fill('Una nota sobre este fragmento.');await page.getByRole('button',{name:'Guardar anotación',exact:true}).click();await page.waitForSelector('#annotation-dialog[open]',{state:'detached'});await page.waitForSelector('.note-inline');assert.equal(calls(),0);
  await page.mouse.move(0,0);
  assert.equal(await page.locator('.note-inline .annotation-actions').first().evaluate(el=>getComputedStyle(el).opacity),'0');
  await page.locator('.note-inline').first().hover();
  assert.equal(await page.locator('.note-inline .annotation-actions').first().evaluate(el=>getComputedStyle(el).opacity),'1');
  await page.mouse.move(0,0);
  await page.locator('.note-inline .annotation-actions button').first().focus();
  assert.equal(await page.locator('.note-inline .annotation-actions').first().evaluate(el=>getComputedStyle(el).opacity),'1');

  saved=(await snapshot()).events.find(e=>e.id===annotationId);assert.equal(saved.data.comment,'Una nota sobre este fragmento.');assert.equal(saved.data.quote,quote);assert.equal((await snapshot()).annotationRevisions.length,1);
  await page.locator('.theory mark').first().click();await page.getByRole('button',{name:'Consultar al tutor',exact:true}).last().click();await page.waitForFunction(()=>document.getElementById('tutor-chat').textContent.includes('Explicación final del fragmento.'));assert.equal(calls(),1);assert((await snapshot()).events.some(e=>e.kind==='chat_message'&&e.data.message.includes(quote)));
  await page.keyboard.press('Escape');await page.keyboard.press('Space');await page.keyboard.press('n');await page.evaluate(()=>ClassNotes.openList());await page.locator('.class-note-link').filter({hasText:'PDF resaltados'}).click();await page.waitForFunction(()=>document.getElementById('pdf-loading')?.hidden===true);
  const pdfQuote=await select('.textLayer',12);await page.waitForSelector('.pdf-highlight');assert.equal(await page.locator('.source-note-dialog[open]').count(),0);assert.equal(await page.locator('.reading-highlight-actions[open]').count(),0);assert.equal(calls(),1);await page.keyboard.press('Control+s');await page.waitForFunction(()=>document.getElementById('note-save-status').textContent==='Guardado en esta computadora');
  let anchor=(await snapshot()).library.notes.find(n=>n.id==='pdf-note').anchors[0];assert.equal(anchor.quote,pdfQuote);assert.equal(anchor.comment,'');assert(anchor.rects.length);const anchorId=anchor.id;
  await page.locator('.pdf-highlight').first().click();await page.getByRole('button',{name:'Dejar una nota',exact:true}).click();await page.getByLabel('Comentario sobre la fuente',{exact:true}).fill('Recordar esta relación.');await page.getByRole('button',{name:'Guardar comentario',exact:true}).click();await page.waitForSelector('.source-note-dialog',{state:'detached'});anchor=(await snapshot()).library.notes.find(n=>n.id==='pdf-note').anchors[0];assert.equal(anchor.id,anchorId);assert.equal(anchor.comment,'Recordar esta relación.');assert(anchor.selector);assert.equal(calls(),1);
  await page.locator('.pdf-highlight').first().click();await page.getByRole('button',{name:'Consultar al tutor',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.note-tutor-output')?.textContent.includes('Explicación final del PDF.'));assert.equal(calls(),2);let record=(await snapshot()).library.noteTutor[0];assert.equal(record.context.anchorId,anchorId);assert.equal(record.context.quote,pdfQuote);assert.equal(record.context.page,1);assert.equal(await page.locator('.source-note-dialog[open]').count(),0);
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');await page.waitForSelector('.note-tutor-dialog',{state:'detached'});await page.evaluate(()=>ClassNotes.zoomBy(1));await page.waitForSelector(`.pdf-highlight[data-anchor-id="${anchorId}"]`);await page.screenshot({path:'/tmp/glosa-highlights-pdf.png'});
  await page.reload();await page.waitForSelector('.theory');assert.equal(await page.locator(`mark[data-annotation-id="${annotationId}"]`).count(),1);await page.keyboard.press('Space');await page.keyboard.press('n');await page.evaluate(()=>ClassNotes.openList());await page.locator('.class-note-link').filter({hasText:'PDF resaltados'}).click();await page.waitForSelector(`.pdf-highlight[data-anchor-id="${anchorId}"]`);
  await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>document.getElementById('pdf-page-canvas').offsetWidth<390);await page.locator('.pdf-highlight').first().click();await page.locator('.reading-highlight-actions').waitFor({state:'visible'});assert(await page.locator('.reading-highlight-actions').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}));await page.screenshot({path:'/tmp/glosa-highlights-mobile.png'});
  // PDF highlight colour change and soft removal: both persist and keep earlier versions.
  await page.setViewportSize({width:1200,height:900});await page.waitForSelector(`.pdf-highlight[data-anchor-id="${anchorId}"]`);
  await page.locator('.pdf-highlight').first().click();await page.getByRole('button',{name:'Color Verde',exact:true}).click();
  await page.keyboard.press('Control+s');await page.waitForFunction(()=>document.getElementById('note-save-status').textContent==='Guardado en esta computadora');
  let recolored=(await snapshot()).library.notes.find(n=>n.id==='pdf-note').anchors[0];assert.equal(recolored.color,'green');assert.equal(recolored.quote,pdfQuote);assert(await page.locator('.pdf-highlight[data-color=green]').count()>=1);
  const versionsWithAnchor=(await snapshot()).library.noteVersions.filter(v=>v.id==='pdf-note'&&v.anchors.length===1).length;assert(versionsWithAnchor>=1,'the pre-colour version keeps the anchor');
  await page.locator('.pdf-highlight').first().click();await page.getByRole('button',{name:'Quitar resaltado',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.pdf-highlight'));
  const afterPdfRemove=await snapshot();assert.equal(afterPdfRemove.library.notes.find(n=>n.id==='pdf-note').anchors.length,0,'a removed PDF highlight leaves the note');
  assert(afterPdfRemove.library.noteVersions.some(v=>v.id==='pdf-note'&&v.anchors.some(a=>a.id===anchorId)),'the earlier version keeps the removed highlight for the history');
  assert.equal(calls(),2);assert.deepEqual(errors,[]);console.log('OK: select highlights without forms or model calls; click to annotate or ask tutor directly; study/PDF text and IDs, revisions, precise quote/page, colour change, soft removal, zoom, reload and mobile.');
 }catch(error){if(browser)console.error(await browser.contexts()[0]?.pages()[0]?.evaluate(()=>({view,focus:document.activeElement?.outerHTML.slice(0,150),notice:document.getElementById('notice')?.textContent,pdf:document.getElementById('pdf-loading')?.textContent,dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>d.className||d.id)})));throw error;}finally{await browser?.close();service.kill();fs.rmSync(data,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exit(1);});
