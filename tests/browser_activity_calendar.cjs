const {chromium}=require('playwright');
const net=require('net'),fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert/strict'),{spawn}=require('child_process');
(async()=>{
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'glosa-activity-')),socket=net.createServer();
 await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 fs.mkdirSync(path.join(data,'margen'),{recursive:true});
 const service=spawn('python',['server.py'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,LEARNING_DATA_DIR:data,GLOSA_MARGEN_DIR:path.join(data,'margen'),LEARNING_PORT:String(port)},stdio:'ignore'});
 const base=`http://127.0.0.1:${port}`;let browser;
 const api=async(url,body,room='local')=>{const r=await fetch(base+url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Glosa-Room':room},body:body?JSON.stringify(body):undefined});const result=await r.json();assert(r.ok,JSON.stringify(result));return result;};
 try{
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/state')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  const yesterday=new Date();yesterday.setDate(yesterday.getDate()-1);const day=yesterday.toISOString().slice(0,10),year=yesterday.getFullYear();
  const second=await api('/api/rooms/create',{title:'Otra materia'});
  const segment=(id,start,end,view)=>({id,sessionId:'fixture',deviceId:'test',timezone:'America/Argentina/Buenos_Aires',mode:'free',plannedSeconds:0,phase:'focus',visible:true,uncertain:false,tracking:'automatic',view,startedAt:day+start,endedAt:day+end});
  await api('/api/study-segments',{segments:[segment('study','T15:00:00Z','T16:00:00Z','study')]});
  await api('/api/study-segments',{segments:[segment('notes','T16:00:00Z','T16:30:00Z','notes')]},second.id);
  const result=await api('/api/activity-calendar?year='+year);assert.equal(result.days.find(d=>d.date===day).seconds,5400);
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||'/usr/bin/chromium'});
  const page=await browser.newPage({viewport:{width:1280,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.locator('.activity-year-grid').waitFor();
  const cell=page.locator(`button[data-date="${day}"]`);await cell.click();assert.equal(await cell.getAttribute('data-level'),'4');
  assert((await page.locator('.activity-detail').innerText()).includes('Otra materia'));
  assert((await page.locator('.activity-detail').innerText()).includes('1 h 30 min'));
  if(process.env.ACTIVITY_QA_DESKTOP)await page.locator('.activity-calendar').screenshot({path:process.env.ACTIVITY_QA_DESKTOP});
  await page.getByLabel('Vista de actividad').selectOption('month');await page.locator('.activity-month-grid').waitFor();
  await page.getByRole('button',{name:'Período anterior',exact:true}).click();await page.waitForTimeout(200);assert(await page.locator('.activity-month-grid').count());
  await page.setViewportSize({width:390,height:844});await page.locator('.activity-calendar').scrollIntoViewIfNeeded();
  assert(await page.locator('#home-dialog').evaluate(n=>n.scrollWidth<=n.clientWidth));
  await page.getByLabel('Vista de actividad').selectOption('year');assert(await page.locator('.activity-year-scroll').evaluate(n=>n.scrollWidth>n.clientWidth));
  if(process.env.ACTIVITY_QA_SCREENSHOT)await page.screenshot({path:process.env.ACTIVITY_QA_SCREENSHOT,fullPage:true});
  await page.goto(base+'#study');await page.locator('.theory').first().waitFor();
  const activityContext=await page.evaluate(()=>GlosaActivityContext());assert(activityContext.roomId);assert.equal(activityContext.view,'study');
  assert.deepEqual(errors,[]);console.log('PASS: global rooms, year/month, day detail, mobile layout');
 }finally{await browser?.close();service.kill();fs.rmSync(data,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
