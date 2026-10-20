// Full application integration with an isolated database; no model calls or student events.
const {chromium}=require('playwright');
const fs=require('fs'),os=require('os'),path=require('path'),net=require('net'),assert=require('assert/strict'),{spawn}=require('child_process');
(async()=>{
 const root=path.resolve(__dirname,'..'),data=fs.mkdtempSync(path.join(os.tmpdir(),'glosa-visuals-'));
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const service=spawn('python3',['server.py'],{cwd:root,env:{...process.env,LEARNING_DATA_DIR:data,GLOSA_MARGEN_DIR:path.join(data,'margen'),LEARNING_PORT:String(port),OPENROUTER_API_KEY:''},stdio:'ignore'});
 const base=`http://127.0.0.1:${port}`;let browser;
 try{
  for(let n=0;n<100;n++){try{if((await fetch(base+'/api/state')).ok)break;}catch{}if(n===99)throw Error('Startup failed');await new Promise(r=>setTimeout(r,100));}
  const flow={id:'f',blockId:'b',kind:'flow',title:'Pedido e integración',caption:'Modelo simplificado, conexiones de datos.',nodes:[{id:'a',label:'Canal web',detail:'Recibe el pedido.',col:0,row:0},{id:'b',label:'ERP',detail:'Valida stock antes de confirmar.',col:1,row:0},{id:'c',label:'CRM',detail:'Conserva la interacción.',col:1,row:1}],edges:[{from:'a',to:'b',label:'Pedido validado'},{from:'b',to:'c',label:'Identidad de cliente'}]};
  const plot={id:'p',kind:'plot',title:'Costo por cantidad',caption:'Ejemplo didáctico: costo fijo 10 más 2 por unidad.',xLabel:'Cantidad (unidades)',yLabel:'Costo ($)',series:[{label:'Total',points:[[0,10],[1,12],[2,14]]},{label:'Variable',points:[[0,0],[1,2],[2,4]]}]};
  const study={id:'study',title:'Comprender',unit:'Visuales',intro:'Explorá relaciones y datos.',minutes:10,priority:1,blocks:[{id:'b',title:'Circuito',text:'Explicación textual.'}],exercises:[{id:'e',type:'explain',question:'Justificá la relación.',rubric:['Explica']}],visuals:[flow,plot]};
  const course={schemaVersion:1,id:'qa-visuals',version:'1',title:'Visuales temporales',sources:[],lessons:[study,{...study,id:'exam',title:'Comprobación',mode:'exam'}]};
  const response=await fetch(base+'/api/course',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(course)});assert(response.ok,await response.text());
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||chromium.executablePath()});
  const page=await browser.newPage({viewport:{width:1250,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('glosa-active-room','local');localStorage.setItem('study-course','qa-visuals');localStorage.setItem('study-lesson','study');});
  await page.goto(base+'#study');try{await page.waitForSelector('.learning-visual',{timeout:5000});}catch(e){console.error(errors,await page.locator('body').innerText());throw e;}assert.equal(await page.locator('.learning-visual').count(),2);
  await page.getByRole('button',{name:'ERP',exact:true}).click();assert((await page.locator('.learning-visual').first().innerText()).includes('Valida stock antes de confirmar.'));
  assert.equal(await page.getByRole('button',{name:'ERP',exact:true}).getAttribute('aria-pressed'),'true');
  await page.getByRole('combobox',{name:'Serie a explorar'}).selectOption('1');
  await page.getByRole('slider',{name:'Punto a explorar'}).fill('2');
  assert((await page.locator('.learning-visual').nth(1).innerText()).includes('Costo ($): 4'));
  // Labels are text, never executable HTML.
  await page.evaluate(()=>{const v={id:'x',kind:'flow',title:'Seguro',caption:'Texto',nodes:[{id:'a',label:'<img src=x onerror=alert(1)>',detail:'Texto',col:0,row:0},{id:'b',label:'Destino',detail:'Otro',col:1,row:0}],edges:[{from:'a',to:'b',label:'<script>alert(1)</script>'}]};document.body.append(LearningVisuals.render(v));});
  assert.equal(await page.locator('.learning-visual img,.learning-visual script').count(),0);await page.locator('body > .learning-visual').evaluate(e=>e.remove());
  fs.mkdirSync(path.join(root,'output/qa'),{recursive:true});await page.locator('.learning-visual').first().screenshot({path:path.join(root,'output/qa/learning-flow.png')});
  await page.setViewportSize({width:390,height:844});await page.locator('.learning-visual').nth(1).screenshot({path:path.join(root,'output/qa/learning-plot-mobile.png')});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
  await page.evaluate(()=>{lid='exam';renderStudy();});assert.equal(await page.locator('.learning-visual').count(),0);assert.equal(await page.locator('.exam-view').count(),1);
  assert.deepEqual(errors,[]);console.log('OK: native diagram/plot, node exploration, quantitative readout, safe labels, mobile layout and exam isolation.');
 }finally{if(browser)await browser.close();service.kill();fs.rmSync(data,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
