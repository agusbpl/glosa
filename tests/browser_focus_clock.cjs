// Real app, isolated SQLite and browser storage. No model or personal study data.
const {chromium}=require('playwright'),assert=require('node:assert/strict');
const fs=require('fs'),os=require('os'),path=require('path'),net=require('net'),{spawn}=require('child_process');
(async()=>{
 const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'glosa-focus-'));
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const service=spawn('python3',['server.py'],{cwd:root,env:{...process.env,LEARNING_DATA_DIR:data,GLOSA_MARGEN_DIR:path.join(data,'margen'),LEARNING_PORT:String(port),OPENROUTER_API_KEY:''},stdio:'ignore'});
 const base=`http://127.0.0.1:${port}`;let browser;
 try{
  for(let n=0;n<100;n++){try{if((await fetch(base+'/api/state')).ok)break;}catch{}if(n===99)throw Error('Startup failed');await new Promise(r=>setTimeout(r,100));}
  const course={schemaVersion:1,id:'qa-focus',version:'1',title:'Materia temporal',sources:[],lessons:[{id:'one',title:'Un concepto',unit:'Unidad',intro:'Explicá.',minutes:5,priority:1,blocks:[{id:'b',text:'Texto de prueba'}],exercises:[{id:'e',type:'open',question:'Explicá',rubric:['Relaciona']}]}]};
  const post=async(url,body)=>{const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});assert(r.ok,await r.text());};
  await post('/api/course',course);
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||chromium.executablePath()});
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('glosa-active-room','local');localStorage.setItem('study-course','qa-focus');localStorage.setItem('study-lesson','one');});
  await page.goto(base+'#study');await page.getByRole('button',{name:'Abrir temporizador de estudio'}).click();
  await page.getByRole('radio',{name:'A medida'}).check();await page.locator('[name=focusMinutes]').fill('1');await page.locator('[name=breakMinutes]').fill('1');
  await page.getByRole('button',{name:'Empezar a estudiar',exact:true}).click();await page.getByRole('button',{name:'Pausar',exact:true}).waitFor();
  // Keep a typed answer while the clock reaches its deadline; no forced modal/submission.
  await page.getByRole('button',{name:'Cerrar sesión de estudio'}).click();
  await page.evaluate(async()=>{await FocusClock.flush();await navigator.locks.request('glosa-focus-writer',()=>{const d=JSON.parse(localStorage.getItem('glosa-focus-v1'));d.session.cursor-=61000;d.session.lastSeenAt=Date.now();localStorage.setItem('glosa-focus-v1',JSON.stringify(d));});await FocusClock.tick();await FocusClock.sync();});
  assert.equal(await page.locator('#focus-dialog').getAttribute('open'),null);
  assert.equal(await page.evaluate(()=>FocusClock.snapshot().session.status),'ready');
  await page.locator('#focus-notice').waitFor({state:'visible'});
  assert.match(await page.locator('#focus-notice').innerText(),/¿Querés descansar/);
  await page.evaluate(()=>FocusClock.refresh());
  assert.equal(await page.locator('#focus-notice').count(),1);

  await page.locator('#focus-notice').getByRole('button',{name:'Ahora no'}).click();
  await page.evaluate(()=>FocusClock.refresh());assert.equal(await page.locator('#focus-notice').isVisible(),false);
  await page.getByRole('button',{name:/Sesión de estudio: Bloque completo/}).click();await page.locator('#focus-dialog [data-action=break]').click();
  await page.waitForFunction(()=>FocusClock.snapshot().session?.phase==='break');assert.equal(await page.evaluate(()=>FocusClock.snapshot().session.phase),'break');
  await page.reload();await page.getByRole('button',{name:/Sesión de estudio:/}).click();await page.waitForFunction(()=>FocusClock.snapshot().session?.phase==='break');assert.equal(await page.evaluate(()=>FocusClock.snapshot().session.phase),'break');
  // A second tab cannot count the same cursor again.
  const other=await context.newPage();await other.goto(base+'#study');await other.waitForSelector('#focus-clock-button');
  await Promise.all([page.evaluate(()=>FocusClock.flush()),other.evaluate(()=>FocusClock.flush())]);
  await other.close();await page.bringToFront();
  await page.getByRole('button',{name:'Cerrar sesión de estudio'}).click();
  await page.evaluate(async()=>{await navigator.locks.request('glosa-focus-writer',()=>{const d=JSON.parse(localStorage.getItem('glosa-focus-v1'));d.session.cursor-=61000;d.session.lastSeenAt=Date.now();localStorage.setItem('glosa-focus-v1',JSON.stringify(d));});await FocusClock.tick();});
  await page.locator('#focus-notice').waitFor({state:'visible'});
  assert.match(await page.locator('#focus-notice').innerText(),/Terminó el descanso/);
  await page.locator('#focus-notice').getByRole('button',{name:'Empezar otro bloque'}).click();
  await page.waitForFunction(()=>FocusClock.snapshot().session?.phase==='focus');
  assert.equal(await page.locator('#focus-notice').isVisible(),false);
  await page.getByRole('button',{name:/Sesión de estudio:/}).click();
  await page.getByRole('button',{name:'Finalizar sesión',exact:true}).click();await page.getByRole('button',{name:'Bien',exact:true}).click();
  await page.getByRole('button',{name:'Empezar a estudiar',exact:true}).waitFor();
  const summary=await page.evaluate(()=>fetch('/api/study-summary').then(r=>r.json()));assert.equal(summary.today.sessionsFinished,1);assert(summary.today.focusSeconds>=60&&summary.today.focusSeconds<65);
  const state=await page.evaluate(()=>fetch('/api/state').then(r=>r.json()));assert(state.events.some(e=>e.kind==='study_session'&&e.data.rating==='okay'));assert.equal(state.events.filter(e=>e.kind==='answer').length,0);
  fs.mkdirSync(path.join(root,'output/qa'),{recursive:true});await page.locator('#focus-dialog').screenshot({path:path.join(root,'output/qa/focus-panel.png')});
  await page.setViewportSize({width:390,height:844});await page.locator('#focus-dialog').screenshot({path:path.join(root,'output/qa/focus-panel-mobile.png')});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.getByRole('button',{name:'Cerrar sesión de estudio'}).click();assert(await page.getByRole('button',{name:'Abrir temporizador de estudio'}).isVisible());
  assert(await page.evaluate(()=>{const ids=['focus-clock-button','environment-context','global-command-button','rooms-button'];const boxes=ids.map(id=>document.getElementById(id).getBoundingClientRect());return boxes.every((a,i)=>boxes.every((b,j)=>i===j||a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top));}));
  await page.locator('.topbar').screenshot({path:path.join(root,'output/qa/focus-header-mobile.png')});
  await page.evaluate(async()=>{
    await FocusClock.start({mode:'pomodoro',focusSeconds:300,breakSeconds:300,goal:'Avisos'});
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const draft=document.createElement('div');draft.contentEditable='true';draft.id='qa-focus-draft';draft.textContent='Mi respuesta en curso';document.body.append(draft);draft.focus();
    if(document.activeElement!==draft)throw Error('No se pudo enfocar el editor antes del aviso');
    await navigator.locks.request('glosa-focus-writer',()=>{const d=JSON.parse(localStorage.getItem('glosa-focus-v1'));d.session.cursor-=241000;d.session.lastSeenAt=Date.now();localStorage.setItem('glosa-focus-v1',JSON.stringify(d));});await FocusClock.tick();
  });
  await page.locator('#focus-notice').waitFor({state:'visible'});
  assert.match(await page.locator('#focus-notice').innerText(),/Falta un minuto de foco/);
  assert.equal(await page.locator('#qa-focus-draft').textContent(),'Mi respuesta en curso');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'qa-focus-draft');
  assert.equal(await page.locator('#focus-dialog').getAttribute('open'),null);
  await page.locator('#focus-notice').screenshot({path:path.join(root,'output/qa/focus-notice-mobile.png')});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.evaluate(()=>FocusClock.finish({}));
  assert.deepEqual(errors,[]);console.log('OK: full app clock, ready/break, reload, two tabs, rating/statistics, no fake answers, mobile and header visibility.');
 }finally{if(browser)await browser.close();service.kill();fs.rmSync(data,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
