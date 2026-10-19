const {chromium}=require('playwright');
const fs=require('fs'),os=require('os'),path=require('path'),net=require('net'),assert=require('assert/strict'),{spawn}=require('child_process');
(async()=>{
 const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'glosa-native-links-'));
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const service=spawn('python3',['server.py'],{cwd:root,env:{...process.env,LEARNING_DATA_DIR:data,GLOSA_MARGEN_DIR:path.join(data,'margen'),LEARNING_PORT:String(port),OPENROUTER_API_KEY:''},stdio:'ignore'}),base=`http://127.0.0.1:${port}`;
 let browser;
 try{
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/state')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));if(i===99)throw Error('Startup failed');}
  const api=async(url,body)=>{const r=await fetch(base+url,{headers:{'Content-Type':'application/json','X-Glosa-Room':'primer-trazo'},...(body?{method:'POST',body:JSON.stringify(body)}:{})});const result=await r.json();assert(r.ok,JSON.stringify(result));return result;};
  const state=await api('/api/state');const course=state.courses[0];
  const note=await api('/api/notes',{title:'SI de prueba',folder:'Glosario',content:'# SI de prueba\n\nPersonas, procesos y datos.',contentFormat:'markdown',shared:true,documentId:null,page:null,anchors:[]});
  const text=`Consultá [SI](#note=${note.id}).`;
  course.version+='-links';course.lessons[0].blocks[0].text=text;await api('/api/course',course);
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||chromium.executablePath()});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base);
  const link=page.getByRole('link',{name:'SI',exact:true});await link.waitFor();
  assert.equal(await link.locator('..').textContent(),text);
  assert(!(await link.locator('..').innerText()).includes('#note='));
  await link.hover();
  const preview=page.getByRole('dialog',{name:'Vista previa: SI de prueba'});
  await preview.waitFor();
  assert((await preview.innerText()).includes('Personas, procesos y datos.'));
  assert.equal(await page.evaluate(()=>view),'study');
  await preview.hover();await page.waitForTimeout(350);assert(await preview.isVisible());
  const box=await preview.boundingBox(),size=page.viewportSize();
  assert(box.x>=0&&box.y>=0&&box.x+box.width<=size.width&&box.y+box.height<=size.height);
  await page.keyboard.press('Escape');assert.equal(await preview.count(),0);
  await link.focus();await preview.waitFor();await page.keyboard.press('Escape');
  await page.mouse.move(900,700);await page.waitForTimeout(400);assert.equal(await preview.count(),0);
  await link.hover();await preview.waitFor();await preview.getByRole('link',{name:'Abrir nota',exact:true}).click();
  await page.waitForFunction(id=>ClassNotes.current()?.id===id,note.id);
  assert.equal(await preview.count(),0);
  await page.evaluate(()=>WorkspaceKeys.go('study'));await link.waitFor();
  // Select across the link, then a single letter inside its label. Both paths
  // must keep native links rendered when annotation boundaries split markup.
  await page.evaluate(async()=>{
    const root=document.querySelector('.theory'),range=document.createRange();
    range.selectNodeContents(root);getSelection().removeAllRanges();getSelection().addRange(range);
    await captureReadingHighlight();
  });
   assert.equal(await page.locator('.theory').first().innerText(),'Consultá SI.');
   assert.equal(await page.locator('.theory').first().textContent(),text);
   assert(await page.locator('.theory mark').count()>0);
   await page.locator('.theory mark').first().click();
   assert.equal(await page.getByRole('button',{name:'Generar nota sobre ello',exact:true}).count(),1);
   await page.keyboard.press('Escape');
   await page.reload();await link.waitFor();
  await page.evaluate(async()=>{
    const label=document.querySelector('.theory a'),walker=document.createTreeWalker(label,NodeFilter.SHOW_TEXT);walker.nextNode();
    const range=document.createRange();range.setStart(walker.currentNode,0);range.setEnd(walker.currentNode,1);
    getSelection().removeAllRanges();getSelection().addRange(range);await captureReadingHighlight();
  });
  assert.equal(await page.locator('.theory').first().innerText(),'Consultá SI.');
  assert.equal(await page.locator('.theory').first().textContent(),text);
  const annotations=await api('/api/state');
  for(const item of annotations.events.filter(e=>e.kind==='annotation')){
    assert.equal(text.slice(item.data.start,item.data.end),item.data.quote);
  }
  await page.reload();
  assert.equal(await page.locator('.theory').first().innerText(),'Consultá SI.');
  await page.locator('.theory a').first().click();await page.waitForFunction(id=>ClassNotes.current()?.id===id,note.id);
  assert((await page.locator('#main').innerText()).includes('Personas, procesos y datos.'));
  assert.deepEqual(errors,[]);console.log('Preview al pasar el mouse y enfocar: contenido, permanencia, Escape y abrir nota OK. Resaltados y recarga OK. Base temporal.');
 }finally{if(browser)await browser.close();service.kill();fs.rmSync(data,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
