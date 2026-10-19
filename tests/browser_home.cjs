const {chromium}=require('playwright');
const fs=require('fs'),os=require('os'),path=require('path'),net=require('net'),assert=require('assert/strict'),{spawn}=require('child_process');
(async()=>{
 const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'glosa-home-')),data=path.join(temp,'data'),margen=path.join(temp,'Margen');fs.mkdirSync(data);fs.mkdirSync(margen);
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const service=spawn('python3',['-c',`import server,rooms,margen_agenda
from datetime import datetime
from zoneinfo import ZoneInfo
server.init_db()
rooms.create(server.DATA,server.ROOT,'Tecnologías para la Gestión')
rooms.create(server.DATA,server.ROOT,'Minería de Datos')
original=margen_agenda.snapshot
def fixed(data,root,**kwargs):
 return original(data,root,datetime(2026,10,19,18,30,tzinfo=ZoneInfo('America/Argentina/Buenos_Aires')),**kwargs)
margen_agenda.snapshot=fixed
server.ThreadingHTTPServer(('127.0.0.1',server.PORT),server.Handler).serve_forever()
`],{cwd:root,env:{...process.env,LEARNING_DATA_DIR:data,GLOSA_MARGEN_DIR:margen,LEARNING_PORT:String(port)},stdio:['ignore','ignore','pipe']});
 let stderr='',browser;service.stderr.on('data',b=>stderr+=b);const base=`http://127.0.0.1:${port}`;
 try {
  for(let i=0;i<100;i++){try{const r=await fetch(base+'/api/home');if(r.ok)break;}catch{}await new Promise(r=>setTimeout(r,100));if(i===99)throw Error(stderr);}
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||chromium.executablePath()});
  const page=await browser.newPage({viewport:{width:1500,height:1000}}),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR',e.message);});page.setDefaultTimeout(12000);page.on('console',m=>{if(m.type()==='error')console.error(m.text());});
  await page.route('**/api/home*',async route=>{const response=await route.fetch();const body=await response.json();if(body.margen)body.margen.source='settings';await route.fulfill({response,json:body});});await page.goto(base);await page.getByRole('heading',{name:'¿Qué vas a estudiar hoy?'}).waitFor();
  assert.equal(await page.locator('.home-room').count(),2);
  assert.equal(await page.locator('#rooms-dialog').count(),0);
  await page.getByRole('button',{name:'Ajustes generales',exact:true}).click();
  const settings=page.locator('#settings-dialog');await settings.waitFor({state:'visible'});
  for(const id of ['settings-keyboard','settings-time','settings-tutor','settings-margin'])assert.equal(await settings.locator('#'+id).count(),1);
  assert.equal(await settings.locator('.home-room,.boveda-row,#room-list').count(),0);
  assert.equal(await settings.getByLabel('Carpeta del Margen',{exact:true}).inputValue(),margen);
  assert.equal(await settings.getByLabel('Carpeta del Margen',{exact:true}).getAttribute('readonly'),'true');
  await page.route('**/api/margen/choose-folder',route=>route.fulfill({json:{folder:margen+'/Elegida'}}));
  await settings.getByRole('button',{name:'Elegir carpeta',exact:true}).click();
  await page.waitForFunction(expected=>document.querySelector('#settings-margin-content input[readonly]')?.value===expected,margen+'/Elegida');
  await page.route('**/api/margen/choose-folder',route=>route.fulfill({json:{folder:null}}));
  await settings.getByRole('button',{name:'Elegir carpeta',exact:true}).click();
  assert.equal(await settings.getByLabel('Carpeta del Margen',{exact:true}).inputValue(),margen+'/Elegida');
  await settings.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.getByRole('button',{name:'Importar',exact:true}).click();
  const importer=page.getByRole('dialog',{name:'Importar pliego',exact:true});await importer.waitFor();
  assert.equal(await importer.getByLabel('Respaldo ZIP').count(),1);
  await importer.getByRole('button',{name:'Importar y abrir',exact:true}).click();
  await importer.getByText('Elegí un ZIP o indicá una carpeta.',{exact:true}).waitFor();
  await importer.getByRole('button',{name:'Cerrar',exact:true}).click();

  await page.getByRole('searchbox',{name:'Buscar pliegos'}).fill('Minería');assert.equal(await page.locator('.home-room').count(),1);await page.getByRole('searchbox',{name:'Buscar pliegos'}).fill('');
  await page.getByRole('button',{name:'Agregar evento o clase',exact:true}).click();
  const form=page.locator('.home-modal[open]');
  await form.getByLabel('Título',{exact:true}).fill('Clase de Tecnología');
  await form.getByLabel('Pliego',{exact:true}).selectOption({label:'Tecnologías para la Gestión'});
  await form.getByLabel('Fecha',{exact:true}).fill('2026-10-19');
  await form.getByLabel('Desde',{exact:true}).fill('18:00');await form.getByLabel('Hasta',{exact:true}).fill('20:00');
  await form.getByText('Repetición y excepciones',{exact:true}).click();await form.getByLabel('Repetir cada semana hasta').fill('2026-11-30');
  await form.getByRole('button',{name:'Guardar',exact:true}).click();
  await page.getByRole('button',{name:'Tomar apuntes',exact:true}).waitFor();
  assert((await page.locator('.home-class').textContent()).includes('AHORA'));
  const catalog=await(await fetch(base+'/api/home')).json(),pliego=catalog.pliegos.find(p=>p.title==='Tecnologías para la Gestión');
  const count=async()=>{const s=await(await fetch(base+'/api/state?room='+pliego.id)).json();return s.library.notes.length;};
  assert.equal(await count(),0);
  fs.mkdirSync(path.join(root,'output/qa'),{recursive:true});await page.screenshot({path:path.join(root,'output/qa/home-desktop.png')});
  await page.getByRole('button',{name:'Tomar apuntes',exact:true}).click();
  await page.waitForFunction(()=>typeof ClassNotes!=='undefined'&&ClassNotes.current()?.title?.startsWith('Clase de Tecnología'));
  assert.equal(await page.locator('#home-dialog[open]').count(),0);
  assert.equal(await count(),0,'Opening class note must not persist an empty note');
  assert.equal(await page.evaluate(()=>ClassNotes.current().folder),'Tecnologías para la Gestión');
  await page.locator('#note-markdown-preview .cm-content').click();
  await page.keyboard.type('Contenido propio de la clase');
  await page.evaluate(()=>ClassNotes.flush());
  assert.equal(await count(),1);
  await page.locator('#rooms-button').click();await page.getByRole('heading',{name:'¿Qué vas a estudiar hoy?'}).waitFor();
  await page.reload();await page.getByRole('heading',{name:'¿Qué vas a estudiar hoy?'}).waitFor();
  await page.setViewportSize({width:390,height:844});assert(await page.locator('#home-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth));
  await page.getByRole('button',{name:'Ver calendario',exact:true}).click();assert(await page.getByRole('dialog',{name:'Calendario del Margen'}).isVisible());await page.locator('.home-month-day').first().waitFor();assert.equal(await page.locator('.home-month-day').count(),42);await page.getByRole('button',{name:'Mes siguiente',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.home-calendar-tools h3')?.textContent.includes('noviembre'));await page.getByRole('button',{name:'Horario semanal',exact:true}).click();await page.locator('.home-timetable-row').waitFor();assert.equal(await page.locator('.home-timetable-row').count(),1);
  await page.getByRole('button',{name:'Cerrar',exact:true}).click();
  await page.locator('#home-dialog').evaluate(el=>el.scrollTop=0);await page.screenshot({path:path.join(root,'output/qa/home-mobile.png')});
  await page.evaluate(()=>localStorage.setItem('glosa-active-room','missing-room'));await page.reload();await page.getByRole('heading',{name:'¿Qué vas a estudiar hoy?'}).waitFor();
  await page.getByRole('button',{name:'Opciones de Minería de Datos',exact:true}).click();
  const menu=page.getByRole('dialog',{name:'Minería de Datos',exact:true});
  assert.equal(await menu.getByRole('button',{name:'Cerrar',exact:true}).count(),1);
  await menu.getByRole('button',{name:'Eliminar pliego',exact:true}).click();
  let deletion=page.getByRole('dialog',{name:'Eliminar pliego',exact:true});
  await deletion.getByRole('button',{name:'Cancelar',exact:true}).click();
  assert.equal(await page.locator('.home-room').count(),2);
  await page.getByRole('button',{name:'Opciones de Minería de Datos',exact:true}).click();
  await page.getByRole('dialog',{name:'Minería de Datos',exact:true}).getByRole('button',{name:'Eliminar pliego',exact:true}).click();
  await page.getByRole('dialog',{name:'Eliminar pliego',exact:true}).getByRole('button',{name:'Eliminar pliego',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.home-room').length===1);
  assert(fs.existsSync(path.join(margen,'.papelera','Minería de Datos','learning','learning.sqlite3')));
  assert.deepEqual(errors,[]);console.log('OK: home, global timetable, class draft, room isolation, startup, mobile');
 } finally {await browser?.close();service.kill();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
