// Reading-highlight color/soft-delete, compact action bar, Conversar button and
// persistent theme/accent. Synthetic tutor; disposable database; no model calls.
const {chromium}=require('playwright');
const fs=require('fs'),os=require('os'),path=require('path'),net=require('net'),assert=require('assert/strict'),{spawn}=require('child_process');
const luminance=color=>{const [r,g,b]=color.match(/\d+/g).map(Number);const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};return .2126*f(r)+.7152*f(g)+.0722*f(b)};
const contrast=(a,b)=>{const [x,y]=[luminance(a),luminance(b)].sort((m,n)=>n-m);return (x+.05)/(y+.05)};
(async()=>{
 const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'glosa-hlcolor-')),socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const service=spawn('python3',['-c',`import server
server.init_db()
server.ThreadingHTTPServer(('127.0.0.1',server.PORT),server.Handler).serve_forever()
`],{cwd:root,env:{...process.env,LEARNING_DATA_DIR:data,LEARNING_PORT:String(port),OPENROUTER_API_KEY:'',FREELLMAPI_API_KEY:'',INTERN_API_KEY:''},stdio:['ignore','ignore','pipe']});
 let browser,stderr='';service.stderr.on('data',d=>stderr+=d);const base=`http://127.0.0.1:${port}`,snapshot=async()=>await(await fetch(base+'/api/state')).json();
 try{
  for(let i=0;i<100;i++){try{await snapshot();break;}catch{}await new Promise(r=>setTimeout(r,100));if(i===99)throw Error(stderr);}
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||chromium.executablePath()});const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>localStorage.setItem('glosa-active-room','local'));await page.goto(base);await page.waitForSelector('.theory');
  const select=async(selector,end)=>page.locator(selector).first().evaluate((el,end)=>{const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT),node=walker.nextNode(),range=document.createRange();range.setStart(node,0);range.setEnd(node,Math.min(node.length,end));getSelection().removeAllRanges();getSelection().addRange(range);const quote=range.toString();el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));return quote;},end);

  // 1. A highlight starts yellow and its action bar is compact and inside the viewport.
  await select('.theory',30);await page.waitForSelector('.theory mark[data-color=yellow]');
  const annotationId=(await snapshot()).events.find(e=>e.kind==='annotation').id;
  await page.locator('.theory mark').first().click();await page.locator('.reading-highlight-actions').waitFor({state:'visible'});
  const bar=await page.locator('.reading-highlight-actions').evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,vw:innerWidth,vh:innerHeight}});
  assert(bar.width<=Math.min(300,bar.vw-16)+1,`action bar must stay compact, got ${bar.width}`);
  assert(bar.left>=0&&bar.right<=bar.vw&&bar.top>=0&&bar.bottom<=bar.vh,'action bar must stay inside the viewport');

  // 2. Changing color persists and keeps the revision history.
  await page.getByRole('button',{name:'Color Verde',exact:true}).click();
  await page.waitForSelector('.theory mark[data-color=green]');
  let saved=(await snapshot()).events.find(e=>e.id===annotationId);
  assert.equal(saved.data.color,'green');assert.equal(saved.data.quote,(await page.locator('.theory mark[data-color=green]').first().textContent()));
  assert.equal((await snapshot()).annotationRevisions.length,1);
  await page.reload();await page.waitForSelector('.theory mark[data-color=green]');

  // 3. Removing a highlight keeps the event and appends a revision (no erased history).
  await page.locator('.theory mark[data-color=green]').first().click();await page.getByRole('button',{name:'Quitar resaltado',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.theory mark'));
  const afterRemove=await snapshot();saved=afterRemove.events.find(e=>e.id===annotationId);
  assert(saved&&saved.data.removed===true,'the annotation event must survive removal');
  assert.equal(saved.data.quote,saved.data.quote);assert.equal(afterRemove.annotationRevisions.length,2);
  await page.reload();await page.waitForSelector('.theory');assert.equal(await page.locator('mark[data-annotation-id]').count(),0);

  // 3a. A retired range can be highlighted again: the duplicate check ignores removed highlights.
  const beforeLive=(await snapshot()).events.filter(e=>e.kind==='annotation'&&!e.data.removed).length;
  await select('.theory',30);await page.waitForSelector('.theory mark');
  const live=(await snapshot()).events.filter(e=>e.kind==='annotation'&&!e.data.removed);
  assert.equal(live.length,beforeLive+1,'re-highlighting a removed range creates a new live highlight');
  assert(live.some(e=>e.data.start===0&&e.data.end===30),'the new highlight covers the retired range');
  assert((await snapshot()).events.some(e=>e.kind==='annotation'&&e.data.removed&&e.data.start===0&&e.data.end===30),'the removed highlight is still kept in history');
  // Retire the revived highlight too, so the notebook checks below see only retired highlights.
  await page.locator('.theory mark').first().click();await page.getByRole('button',{name:'Quitar resaltado',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.theory mark'));

  // 3b. The notebook keeps the retired highlight only in the full record, marked as removed.
  await page.evaluate(()=>WorkspaceKeys.go('notebook'));
  await page.waitForSelector('.notebook-history');
  assert.equal(await page.getByText('Quitado del resaltado').count(),0,'a removed highlight stays out of the important view');
  await page.locator('.notebook-history').evaluate(el=>{el.open=true;});
  await page.getByRole('button',{name:'Todo el registro',exact:true}).click();
  await page.waitForSelector('.notebook-item');
  assert((await page.getByText('Quitado del resaltado').count())>=1,'the full record shows the removed highlight');
  assert.equal(await page.locator('.notebook-item .highlight-swatch').count(),0,'a removed highlight offers no color swatches');
  await page.evaluate(()=>WorkspaceKeys.go('study'));
  await page.waitForSelector('.theory');

  // 4. Conversar looks like Estudiar: opaque background and legible floating text.
  const dock=await page.locator('#tutor-dock').evaluate(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return {bg:s.backgroundColor,color:s.color,text:el.textContent.trim(),left:r.left,right:r.right}});
  assert(!/rgba?\([^)]*,\s*0(\.\d+)?\)/.test(dock.bg),`Conversar must have an opaque background, got ${dock.bg}`);
  assert(dock.text.includes('Conversar'));
  assert(dock.left>=0&&dock.right<=1200,'Conversar must stay inside the viewport');
  assert(contrast(dock.color,dock.bg)>4.5,`Conversar text contrast too low: ${dock.color} on ${dock.bg}`);

  // 5. Dark theme and accent choice persist across reloads.
  await page.evaluate(()=>showSettings());
  await page.locator('#settings-dialog input[name="theme-mode"][value="dark"]').check();
  await page.locator('#settings-dialog input[name="accent-color"][value="ocean"]').check();
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.accent),'ocean');
  await page.keyboard.press('Escape');
  await page.reload();await page.waitForSelector('.theory');
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'dark');
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.accent),'ocean');
  const bodyBg=await page.evaluate(()=>getComputedStyle(document.body).backgroundColor);
  assert(luminance(bodyBg)<.2,`dark theme must render a dark background, got ${bodyBg}`);
  assert.equal(await page.locator('#settings-dialog input[name="theme-mode"][value="dark"]').isChecked(),true);

  // 6. Mobile: the compact bar still fits after reopening a highlight.
  await page.evaluate(()=>localStorage.setItem('glosa-active-room','local'));
  await page.setViewportSize({width:390,height:844});await page.waitForSelector('.theory');
  await select('.theory',25);await page.waitForSelector('.theory mark');await page.locator('.theory mark').first().click();
  await page.locator('.reading-highlight-actions').waitFor({state:'visible'});
  assert(await page.locator('.reading-highlight-actions').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&r.width<=Math.min(560,innerWidth-16)+1}));

  // 8. Choosing the MCP channel leaves a pending query and calls no provider; the choice persists.
  await page.setViewportSize({width:1200,height:900});
  await page.evaluate(()=>showSettings());
  await page.locator('#settings-dialog input[name="tutor-channel"][value="mcp"]').check();
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>localStorage.getItem('glosa-tutor-channel')),'mcp');
  await page.locator('#tutor-dock').click();await page.waitForSelector('#tutor-panel',{state:'visible'});
  assert((await page.locator('#tutor-status').textContent()).includes('Canal MCP'));
  await page.locator('#chat-input').fill('¿Cómo se relaciona el trazo con el estado?');
  await page.locator('#chat-form').evaluate(form=>form.requestSubmit());
  await page.waitForFunction(()=>document.getElementById('tutor-chat').textContent.includes('Pendiente para el canal MCP externo'));
  const pending=(await snapshot()).events.find(e=>e.kind==='chat_message'&&e.data.channel==='mcp');
  assert(pending,'the MCP query must be stored as a pending chat_message');assert(pending.id.endsWith('-pregunta'));assert.equal(pending.data.pendingExternal,true);
  assert.equal((await snapshot()).events.filter(e=>e.kind==='tutor_reply').length,0,'the MCP channel must not create a tutor reply');
  await page.reload();await page.waitForSelector('.theory');
  assert.equal(await page.evaluate(()=>localStorage.getItem('glosa-tutor-channel')),'mcp','the channel choice persists across reloads');

  // 9. Refreshing the conversation does not rebuild the notes editor nor lose the draft.
  await page.evaluate(()=>WorkspaceKeys.go('notes'));
  await page.waitForSelector('#note-markdown-preview .cm-content');
  await page.locator('#note-markdown-preview .cm-content').click();await page.keyboard.press('i');
  await page.keyboard.type('Borrador que no debe perderse');
  await page.evaluate(()=>window.GlosaTutorChannel.refresh());
  await page.waitForFunction(()=>document.getElementById('notice')?.textContent.includes('Conversación actualizada'));
  assert((await page.locator('#note-markdown-preview').textContent()).includes('Borrador que no debe perderse'),'the refresh keeps the note draft');

  assert.deepEqual(errors,[]);console.log('OK: highlight color and soft removal persist with revisions; a retired range can be highlighted again; compact action bar fits the viewport; Conversar is opaque and legible; dark theme and accent persist; the MCP channel leaves a pending query without a provider and survives reload; refreshing keeps the note draft.');
 }catch(error){if(browser)console.error(await browser.contexts()[0]?.pages()[0]?.evaluate(()=>({notice:document.getElementById('notice')?.textContent,theme:document.documentElement.dataset.theme,accent:document.documentElement.dataset.accent,dialogs:[...document.querySelectorAll('dialog[open]')].map(d=>d.className||d.id)})));throw error;}finally{await browser?.close();service.kill();fs.rmSync(data,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exit(1);});
