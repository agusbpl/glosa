// Real loopback provider transport, temporary database, no external model calls.
let chromium;
try { ({chromium}=require('playwright')); } catch { ({chromium}=require('playwright-core')); }
const fs=require('fs'),os=require('os'),path=require('path'),http=require('http'),assert=require('assert/strict'),{spawn}=require('child_process');
const json=url=>new Promise((resolve,reject)=>http.get(url,r=>{let body='';r.on('data',c=>body+=c);r.on('end',()=>{try{resolve(JSON.parse(body));}catch(e){reject(e);}});}).on('error',reject));
(async()=>{
  const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'glosa-providers-')),calls=[];
  const provider=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
    calls.push({url:req.url,key:req.headers.authorization,body:body?JSON.parse(body):null});
    if(req.url==='/api/model'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{providerID:'lab',id:'tutor',name:'OpenCode tutor',enabled:true},{providerID:'other',id:'tutor',name:'Otro tutor',enabled:true}]}));return;}
    if(req.url==='/api/session' || req.url==='/api/session/ses_fixture'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:{id:'ses_fixture',model:{providerID:'lab',id:'tutor'}}}));return;}
    if(req.url==='/api/session/ses_fixture/interrupt'){res.writeHead(204);res.end();return;}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url==='/v1/models'?{data:[{id:'test-model',name:'Modelo local'}]}:{model:'test-model',choices:[{message:{content:JSON.stringify({reply:'Explicación del proveedor local.',status:'pending',evidence:[],gaps:[],nextAction:'reinforce'})}}]}));
  });});
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
  const listener=http.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
  const providerUrl=`http://127.0.0.1:${provider.address().port}/v1`,base=`http://127.0.0.1:${port}`;
  const cli=path.join(data,'opencode-fixture');
  fs.writeFileSync(cli,`#!/usr/bin/env python3
import json,sys,pathlib
prompt=pathlib.Path(sys.argv[sys.argv.index('--file')+1]).read_text()
assert 'studentMessage' in prompt
assert '--auto' not in sys.argv
assert '-c' not in sys.argv
print(json.dumps({'type':'text','part':{'text':json.dumps({'reply':'Respuesta desde OpenCode local.','status':'pending','evidence':[],'gaps':[],'nextAction':'reinforce'})}}))
`,{mode:0o700});
  const service=spawn('python3',['server.py'],{cwd:root,env:{...process.env,LEARNING_DATA_DIR:data,LEARNING_PORT:String(port),OPENROUTER_API_KEY:'',FREELLMAPI_API_KEY:'',INTERN_API_KEY:'',OPENCODE_SERVER_PASSWORD:'',OPENCODE_BIN:cli},stdio:['ignore','ignore','pipe']});
  let stderr='',browser;service.stderr.on('data',c=>stderr+=c);
  try {
    for(let i=0;i<100;i++){try{await json(base+'/api/state');break;}catch{if(i===99)throw Error(stderr);await new Promise(resolve=>setTimeout(resolve,100));}}
    const seed=await fetch(base+'/api/course',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({schemaVersion:1,id:'qa-provider',version:'1',title:'Materia de prueba',sources:[],lessons:[{id:'one',title:'Tema',unit:'Unidad',intro:'Leé.',minutes:10,priority:1,blocks:[{id:'b',title:'Concepto',text:'Una explicación para consultar.'}],exercises:[{id:'e',type:'open',question:'Explicá la relación',rubric:['Relaciona'] }]}]})});assert(seed.ok);
    browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage'],executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||chromium.executablePath()});
    const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('Browser error:',e.message);});
    await page.addInitScript(()=>localStorage.setItem('glosa-active-room','local'));await page.goto(base+'#study');await page.waitForSelector('.activity');
    const openSettings=async()=>{await page.locator('#main').focus();await page.keyboard.type('ga');await page.waitForSelector('#settings-dialog[open]');};
    await openSettings();await page.locator('#provider-select').selectOption('freellmapi');
    assert.equal(await page.locator('#model-select').inputValue(),'auto');assert(await page.locator('#provider-base-url').isVisible());
    await page.locator('#provider-base-url').fill(providerUrl);await page.locator('#api-key').fill('local-test-secret');
    await page.locator('#load-models').click();await page.waitForSelector('#model-select option[value="test-model"]',{state:'attached'});
    await page.locator('#model-select').selectOption('test-model');await page.getByRole('button',{name:'Guardar ajustes',exact:true}).click();await page.waitForSelector('#settings-dialog[open]',{state:'detached'});
    let state=await json(base+'/api/state');assert.equal(state.settings.provider,'freellmapi');assert.equal(state.settings.model,'test-model');assert.equal(state.settings.providerBaseUrl,providerUrl);assert(state.tutorConnected);
    assert(!JSON.stringify(await json(base+'/api/export.json')).includes('local-test-secret'));
    await page.keyboard.type('gt');await page.waitForSelector('#tutor-panel',{state:'visible'});await page.locator('#tutor-panel .cm-content').fill('¿Cómo funciona esta relación?');await page.getByRole('button',{name:'Conversar ↗',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#tutor-panel')?.textContent.includes('Explicación del proveedor local.'));
    assert.equal(calls.length,2);assert.equal(calls[0].url,'/v1/models');assert.equal(calls[1].url,'/v1/chat/completions');
    for(const call of calls)assert.equal(call.key,'Bearer local-test-secret');assert(!('provider' in calls[1].body));
    await openSettings();await page.locator('#provider-select').selectOption('intern');assert(!(await page.locator('#provider-base-url').isVisible()));
    await page.locator('#custom-model').fill('model-from-panel');await page.getByRole('button',{name:'Guardar ajustes',exact:true}).click();await page.waitForSelector('#settings-dialog[open]',{state:'detached'});
    state=await json(base+'/api/state');assert.equal(state.settings.provider,'intern');assert.equal(state.settings.model,'model-from-panel');assert(!state.tutorConnected);
    await openSettings();await page.locator('#provider-select').selectOption('openrouter');assert.equal(await page.locator('#model-select').inputValue(),'openrouter/free');assert(!(await page.locator('#custom-model').isVisible()));
    await page.locator('#provider-select').selectOption('freellmapi');await page.locator('#provider-base-url').fill(providerUrl);await page.getByRole('button',{name:'Guardar ajustes',exact:true}).click();await page.waitForSelector('#settings-dialog[open]',{state:'detached'});
    assert((await json(base+'/api/state')).tutorConnected);await openSettings();await page.locator('#disconnect-key').click();await page.waitForFunction(()=>document.querySelector('#quota-info')?.textContent.includes('Clave desconectada'));
    assert(!(await json(base+'/api/state')).tutorConnected);
    await page.locator('#provider-select').selectOption('opencode');
    assert.equal(await page.locator('#model-select').inputValue(),'opencode/deepseek-v4.1-flash-free');
    assert(await page.locator('#provider-base-url').isVisible());
    assert((await page.locator('#provider-key-title').textContent()).includes('Contraseña'));
    await page.locator('#provider-base-url').fill(providerUrl.replace('/v1',''));
    await page.locator('#load-models').click();await page.waitForSelector('#model-select option[value="lab/tutor"]',{state:'attached'});
    assert(await page.locator('#model-provider-filter').isVisible());
    const beforeFilter=calls.length;
    await page.locator('#model-provider-filter').selectOption('other');
    assert.deepEqual(await page.locator('#model-select option').evaluateAll(options=>options.map(o=>o.value)),['other/tutor']);
    await page.locator('#model-provider-filter').selectOption('lab');
    assert.deepEqual(await page.locator('#model-select option').evaluateAll(options=>options.map(o=>o.value)),['lab/tutor']);
    await page.locator('#model-provider-filter').selectOption('');
    assert.equal(await page.locator('#model-select').inputValue(),'lab/tutor');
    assert.equal(calls.length,beforeFilter);
    await page.locator('#model-select').selectOption('lab/tutor');
    await page.getByRole('button',{name:'Guardar ajustes',exact:true}).click();await page.waitForSelector('#settings-dialog[open]',{state:'detached'});
    state=await json(base+'/api/state');assert.equal(state.settings.provider,'opencode');assert(state.tutorConnected);
    await page.locator('#tutor-panel .cm-content').fill('Consulta a OpenCode');await page.getByRole('button',{name:'Conversar ↗',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#tutor-panel')?.textContent.includes('Respuesta desde OpenCode local.'));
    const session=calls.find(c=>c.url==='/api/session');
    assert.deepEqual(session.body.model,{providerID:'lab',id:'tutor'});assert.equal(session.key,undefined);
    assert.deepEqual(session.body.permissions,[{action:'*',resource:'*',effect:'ask'}]);
    assert(!calls.some(c=>c.url==='/api/experimental/generate'));
    await openSettings();assert.equal(await page.locator('#provider-base-url').inputValue(),providerUrl.replace('/v1',''));
    await page.locator('#provider-select').selectOption('deepseek');assert.equal(await page.locator('#model-select').inputValue(),'deepseek-flash');assert(!(await page.locator('#provider-base-url').isVisible()));
    await page.locator('#provider-select').selectOption('compatible');assert(await page.locator('#provider-base-url').isVisible());
    await page.locator('#provider-base-url').fill(providerUrl);await page.locator('#custom-model').fill('test-model');await page.locator('#api-key').fill('custom-secret');
    await page.getByRole('button',{name:'Guardar ajustes',exact:true}).click();await page.waitForSelector('#settings-dialog[open]',{state:'detached'});
    state=await json(base+'/api/state');assert.equal(state.settings.provider,'compatible');assert.equal(state.settings.model,'test-model');assert.equal(state.settings.providerBaseUrl,providerUrl);assert(state.tutorConnected);
    assert(!JSON.stringify(await json(base+'/api/export.json')).includes('custom-secret'));await openSettings();
    await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:path.join(os.tmpdir(),'glosa-providers-mobile.png')});assert.deepEqual(errors,[]);
    console.log('OK: provider selector, catalog, real local authenticated chat, custom Intern model, key isolation, exports, disconnect, OpenCode v2 and mobile. No external model calls.');
  } finally {await browser?.close();service.kill();await new Promise(resolve=>provider.close(resolve));fs.rmSync(data,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
