// Isolated browser: no provider, server or student database.
const {chromium}=require('playwright');
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||chromium.executablePath()});
 try{
  const page=await browser.newPage({viewport:{width:1100,height:1000}});
  await page.setContent('<main style="max-width:780px;margin:40px auto"></main>');
  await page.addStyleTag({path:path.resolve(__dirname,'../web/style.css')});
  await page.evaluate(()=>{const values=new Map();window.GlosaRoom={id:'one',storage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)}};});
  await page.addScriptTag({path:path.resolve(__dirname,'../web/interactive-practice.js')});
  const mount=async(kind='classify',version='1')=>page.evaluate(({kind,version})=>{
   const practice={kind,title:'¿Qué estás cargando?',prompt:'Clasificá cada registro antes de comprobar.',categories:['Dato maestro','Regla de configuración','Operación','Consulta'],items:[{id:'x',text:'Ficha reutilizable del proveedor',answer:kind==='order'?'2':'Dato maestro'},{id:'y',text:'Recepción del pedido 821',answer:kind==='order'?'1':'Operación'}],explanation:'La ficha identifica una entidad; la recepción registra una operación.'};
   document.querySelector('main').replaceChildren(InteractivePractice.render(practice,{id:'course',version},{id:'lesson'}));
  },{kind,version});
  await mount();assert.equal(await page.locator('select').count(),0);
  assert(await page.getByRole('button',{name:'Comprobar relaciones'}).isDisabled());
  assert.equal(await page.locator('.practice-feedback:visible').count(),0);
  await page.getByRole('button',{name:'Ficha reutilizable del proveedor',exact:true}).click();
  await page.getByRole('button',{name:'Mover tarjeta a Dato maestro',exact:true}).click();
  await mount();assert.equal(await page.locator('.practice-zone').filter({has:page.getByRole('button',{name:'Mover tarjeta a Dato maestro',exact:true})}).getByRole('button',{name:'Ficha reutilizable del proveedor',exact:true}).count(),1);
  // Keyboard-only placement and inline feedback, deferred until completion.
  await page.getByRole('button',{name:'Recepción del pedido 821',exact:true}).focus();await page.keyboard.press('Enter');
  await page.getByRole('button',{name:'Mover tarjeta a Operación',exact:true}).focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('.practice-verdict').count(),0);
  await page.getByRole('button',{name:'Comprobar relaciones'}).click();assert.equal(await page.getByText('2 de 2 coincidencias con la guía.',{exact:true}).count(),1);
  assert.equal(await page.locator('.practice-verdict').count(),2);
  fs.mkdirSync(path.resolve(__dirname,'../output/qa'),{recursive:true});await page.locator('.practice-studio').screenshot({path:path.resolve(__dirname,'../output/qa/practice-board.png')});
  // Changing a completed response clears stale feedback; returning to bank works.
  await page.getByRole('button',{name:'Ficha reutilizable del proveedor',exact:true}).click();await page.getByRole('button',{name:'Mover tarjeta a Por ubicar',exact:true}).click();
  assert(await page.getByRole('button',{name:'Comprobar relaciones'}).isDisabled());assert.equal(await page.locator('.practice-feedback:visible').count(),0);
  await mount('classify','2');assert.equal(await page.locator('.practice-bank .practice-card').count(),2);
  await page.getByRole('button',{name:'Ficha reutilizable del proveedor',exact:true}).dragTo(page.getByRole('button',{name:'Mover tarjeta a Dato maestro',exact:true}));
  assert.equal(await page.locator('.practice-bank .practice-card').count(),1);await page.getByRole('button',{name:'Reiniciar',exact:true}).click();
  await page.setViewportSize({width:390,height:844});await page.locator('.practice-studio').screenshot({path:path.resolve(__dirname,'../output/qa/practice-board-mobile.png')});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await mount('order','3');await page.getByRole('button',{name:'Bajar Ficha reutilizable del proveedor'}).click();
  await mount('order','3');assert((await page.locator('.practice-step').first().innerText()).includes('Recepción del pedido'));
  await page.getByRole('button',{name:'Comprobar recorrido'}).click();assert.equal(await page.getByText('2 de 2 coincidencias con la guía.',{exact:true}).count(),1);
  await page.getByRole('button',{name:'Reiniciar',exact:true}).click();assert((await page.locator('.practice-step').first().innerText()).includes('Ficha reutilizable'));
  await page.evaluate(()=>{const p={kind:'classify',title:'Seguro',prompt:'Texto',categories:['A','B'],items:[{id:'a',text:'<img src=x onerror=alert(1)>',answer:'A'},{id:'b',text:'Otro',answer:'B'}],explanation:'Texto'};document.querySelector('main').replaceChildren(InteractivePractice.render(p,{id:'safe',version:'1'},{id:'safe'}));});
  assert.equal(await page.locator('img').count(),0);
  console.log('OK: visual board, keyboard placement, draft recovery, deferred inline feedback, correction, mobile, ordering, reset and safe labels.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
