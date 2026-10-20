// Isolated database. No calls to any model provider.
const {chromium}=require('playwright');
const fs=require('fs'),os=require('os'),path=require('path'),net=require('net'),http=require('http'),assert=require('assert/strict'),{spawn}=require('child_process');
const request=(url,body)=>new Promise((resolve,reject)=>{const data=body?JSON.stringify(body):null;const req=http.request(url,{method:data?'POST':'GET',headers:data?{'Content-Type':'application/json'}:{}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>{try{const value=JSON.parse(text);if(res.statusCode>=400)throw Error(JSON.stringify(value));resolve(value);}catch(e){reject(e);}});});req.on('error',reject);req.end(data);});
(async()=>{
 const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'estudio-groups-')),socket=net.createServer();
 await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const service=spawn('python3',['-c',`import server
server.init_db()
server.event('tutor_note','qa-groups','one',{'kind':'doubt','text':'Retomar la relación conceptual.','quote':'Primera respuesta original.','isLearningEvidence':False,'courseVersion':'0'})
server.event('tutor_reply','qa-groups','one',{'reply':'INTERCAMBIO QUE NO DEBE VOLCARSE EN EL CUADERNO','courseVersion':'0'})
server.ThreadingHTTPServer(('127.0.0.1',server.PORT),server.Handler).serve_forever()
`],{cwd:root,env:{...process.env,LEARNING_DATA_DIR:data,LEARNING_PORT:String(port),OPENROUTER_API_KEY:''},stdio:'ignore'}),base=`http://127.0.0.1:${port}`;
 let browser;
 try{
  for(let n=0;n<100;n++){try{await request(base+'/api/state');break;}catch{if(n===99)throw Error('Startup failed');await new Promise(r=>setTimeout(r,100));}}
  const course={schemaVersion:1,id:'qa-groups',title:'Simulacro temporal',version:'1',sources:[],lessons:[{id:'one',title:'Simulacro 2 · Recuperación breve',unit:'Domingo 18',examTopics:'Teoría · U1–U3',intro:'Día de la Madre lunes sábado',minutes:5,priority:1,blocks:[{id:'b1',title:'Reglas del tutor',text:'met partial not_met uncertain. Tras dos intentos. La selección depende del historial.'}],exercises:[{id:'e1',type:'open',question:'Una asociación compra un programa. Explicá qué información comprobaría una mejora.',rubric:['Criterio interno secreto']},{id:'e2',type:'explain',question:'Un gerente simula un aumento de precios. Distinguí sus funciones.',rubric:['Aplicar']},{id:'e3',type:'choice',question:'Seleccioná y justificá.',options:['Registrar cobro','Consultar deuda'],correctIndex:0,explanation:'Solución secreta',rubric:['Justificar']}]}]};
  await request(base+'/api/course',course);
  await request(base+'/api/preferences',{keyboardProfile:'vimium',focusMode:false});
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||chromium.executablePath()});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('study-course','qa-groups');localStorage.setItem('glosa-active-room','local');});
  await page.goto(base+'#study');await page.waitForSelector('.exam-view');
  const content=await page.locator('#main').innerText();
  for(const hidden of ['Día de la Madre','lunes','sábado','not_met','Criterio interno secreto','Reglas del tutor','Solución secreta'])assert(!content.includes(hidden),hidden);
  assert.equal(await page.locator('.activity').count(),3);
  assert.equal(await page.locator('.exam-progress').innerText(),'0 de 3 preguntas con respuesta');
  await page.getByLabel('Respuesta a la pregunta 1',{exact:true}).fill('Respuesta temporal de software.');
  await page.reload();await page.waitForSelector('.exam-view');
  assert.equal(await page.getByLabel('Respuesta a la pregunta 1',{exact:true}).inputValue(),'Respuesta temporal de software.');
  assert.equal(await page.locator('.exam-progress').innerText(),'1 de 3 preguntas con respuesta');
  await page.getByRole('button',{name:'Entregar y corregir simulacro',exact:true}).click();
  assert((await page.getByRole('dialog',{name:'Confirmar entrega'}).innerText()).includes('2, 3'));
  await page.getByRole('button',{name:'Revisar respuestas',exact:true}).click();
  assert.equal((await request(base+'/api/state')).events.filter(e=>e.kind==='answer').length,0);
  // Explicit incomplete delivery, disconnected API: preserve the blank selection as null.
  await page.getByRole('button',{name:'Entregar y corregir simulacro',exact:true}).click();
  await page.getByRole('button',{name:'Confirmar entrega',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.exam-status').textContent.includes('Conectá el tutor'));
  let state=await request(base+'/api/state');const answers=state.events.filter(e=>e.kind==='answer');assert.equal(answers.length,3);assert.equal(answers.find(e=>e.data.exerciseId==='e3').data.selectedIndex,null);
  assert.equal(state.events.filter(e=>e.kind==='feedback'&&e.data.kind==='choice_check').length,0);
  // MCP records a pending request without an API call.
  await page.evaluate(()=>{WorkspaceKeys.closePanels(false);setTutorChannel('mcp');});
  await page.getByRole('button',{name:'Entregar y corregir simulacro',exact:true}).click();await page.getByRole('button',{name:'Confirmar entrega',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.exam-status').textContent.includes('tutor externo'));
  state=await request(base+'/api/state');assert(state.events.some(e=>e.kind==='chat_message'&&e.data.examSubmission&&e.data.pendingExternal));
  await page.reload();await page.waitForSelector('.exam-view');assert((await page.locator('.exam-status').innerText()).includes('Entrega registrada'));
  // Simulated storage failure must be visible and keep the text in place.
  await page.evaluate(()=>{GlosaRoom.storage.setItem=()=>{throw Error('quota');};});
  await page.getByLabel('Respuesta a la pregunta 2',{exact:true}).fill('Texto conservado aunque falle el almacenamiento.');
  assert((await page.locator('.draft-status').nth(1).innerText()).includes('No se pudo guardar'));
  assert.equal(await page.getByLabel('Respuesta a la pregunta 2',{exact:true}).inputValue(),'Texto conservado aunque falle el almacenamiento.');
  await page.reload();await page.waitForSelector('.exam-view');
  // Native keyboard navigation and full delivery with a recoverable API failure.
  await page.getByLabel('Respuesta a la pregunta 2',{exact:true}).fill('Segunda respuesta temporal.');
  await page.getByRole('radio',{name:'Registrar cobro',exact:true}).check();await page.getByLabel('Justificación de la opción',{exact:true}).fill('Una justificación temporal.');
  await page.evaluate(()=>{setTutorChannel('api');state.tutorConnected=true;});
  await page.route('**/api/tutor',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Fallo temporal de prueba'})}));
  await page.getByRole('button',{name:'Entregar y corregir simulacro',exact:true}).focus();await page.keyboard.press('Enter');
  assert(!(await page.getByRole('dialog',{name:'Confirmar entrega'}).innerText()).includes('Quedan sin responder'));
  await page.getByRole('button',{name:'Confirmar entrega',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.exam-status').textContent.includes('se interrumpió'));
  assert.equal(await page.getByLabel('Respuesta a la pregunta 1',{exact:true}).inputValue(),'Respuesta temporal de software.');
  const savedBeforeRetry=(await request(base+'/api/state')).events.filter(e=>e.kind==='answer').length;
  await page.evaluate(()=>WorkspaceKeys.closePanels(false));
  await page.unroute('**/api/tutor');
  await page.route('**/api/tutor',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({reply:'Devolución simulada para probar el transporte.'})}));
  await page.getByRole('button',{name:'Entregar y corregir simulacro',exact:true}).click();await page.getByRole('button',{name:'Confirmar entrega',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.exam-status').textContent.includes('El tutor respondió'));
  await page.evaluate(()=>WorkspaceKeys.closePanels(false));
  assert.equal((await request(base+'/api/state')).events.filter(e=>e.kind==='answer').length,savedBeforeRetry);
  // New explicitly marked exams and the normal lesson path keep their distinct views.
  course.version='2';course.lessons[0].mode='exam';course.lessons[0].title='Práctica integradora';await request(base+'/api/course',course);await page.reload();await page.waitForSelector('.exam-view');
  course.version='3';course.lessons[0].mode='study';await request(base+'/api/course',course);await page.reload();await page.waitForSelector('.theory-section');assert.equal(await page.locator('.exam-view').count(),0);
  course.version='4';course.lessons[0].mode='exam';await request(base+'/api/course',course);await page.reload();await page.waitForSelector('.exam-view');
  // Check the integrated Vim editor with real typing, then navigation and refresh.
  await page.evaluate(()=>{state.settings.keyboardProfile='modal';WorkspaceKeys.sync();});
  await page.getByLabel('Respuesta a la pregunta 1',{exact:true}).evaluate(el=>{el.value='';el.focus();});await page.keyboard.type('Texto escrito con Vim.');
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  await page.evaluate(()=>WorkspaceKeys.go('notes'));await page.evaluate(()=>WorkspaceKeys.go('study'));
  assert.equal(await page.getByLabel('Respuesta a la pregunta 1',{exact:true}).inputValue(),'Texto escrito con Vim.');
  await page.reload();await page.waitForSelector('.exam-view');assert.equal(await page.getByLabel('Respuesta a la pregunta 1',{exact:true}).inputValue(),'Texto escrito con Vim.');
  await page.evaluate(()=>{state.settings.focusMode=true;WorkspaceKeys.sync();});assert(await page.getByRole('button',{name:'Entregar y corregir simulacro',exact:true}).isVisible());
  await page.evaluate(()=>{state.settings.focusMode=false;WorkspaceKeys.sync();});
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const qa=process.env.GLOSA_QA_OUTPUT||path.join(root,'output/qa');fs.mkdirSync(qa,{recursive:true});await page.screenshot({path:path.join(qa,'simulacro-mobile.png'),fullPage:true});
  await page.setViewportSize({width:1280,height:900});await page.screenshot({path:path.join(qa,'simulacro-desktop.png'),fullPage:true});
  await page.emulateMedia({media:'print'});assert.equal(await page.locator('.exam-view .group-conversation').isVisible(),false);
  assert.deepEqual(errors,[]);console.log('OK: exam content boundary, drafts/navigation/reload, progress, incomplete/full confirmation, offline/MCP, API error/retry, no early solution, storage failure, Vim, focus, mobile and print. No model calls.');
 }finally{await browser?.close();service.kill();fs.rmSync(data,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
