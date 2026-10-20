// Isolated browser viewport contract: no student database or source content.
const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||chromium.executablePath()});
 try{
  const page=await browser.newPage({viewport:{width:1000,height:800}});
  // A routed empty origin gives scoped storage without loading a live workspace.
  await page.route('http://position.test/**',route=>route.fulfill({contentType:'text/html',body:'<main id="main"></main>'}));await page.goto('http://position.test/');
  await page.evaluate(()=>{
   window.view='study';window.cid='course-a';window.lid='lesson-a';window.noteId='note-long';
   const rooms=new Map();let room='a';window.changeRoom=id=>room=id;
   window.GlosaRoom={storage:{getItem:k=>rooms.get(room+':'+k)||null,setItem:(k,v)=>rooms.set(room+':'+k,v)}};
   window.ClassNotes={currentId:()=>noteId,readerPosition:()=>({documentId:'pdf-a',page:3,zoom:1.6})};
   window.mount=(kind)=>{document.getElementById('main').innerHTML=kind==='notes'?'<section class="note-editor" style="height:3200px">Long note</section><aside id="pdf-scroll" style="height:100px;overflow:auto"><div style="height:1000px">PDF</div></aside>':'<article style="height:4200px">Long theory</article>';};mount('study');
  });
  await page.addScriptTag({content:fs.readFileSync(path.join(__dirname,'../web/view-position.js'),'utf8')});
  await page.evaluate(()=>scrollTo(0,1300));await page.waitForTimeout(80);
  await page.evaluate(()=>{ViewPosition.capture();view='notes';mount('notes');ViewPosition.restore();});await page.waitForTimeout(80);
  await page.evaluate(()=>{ViewPosition.cancel();scrollTo(0,900);document.getElementById('pdf-scroll').scrollTop=370;});await page.waitForTimeout(80);
  for(let i=0;i<2;i++){
   await page.evaluate(()=>{ViewPosition.capture();view='study';mount('study');ViewPosition.restore();});await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>scrollY),1300);
   await page.evaluate(()=>{ViewPosition.cancel();ViewPosition.capture();view='notes';mount('notes');ViewPosition.restore();});await page.waitForTimeout(100);
   assert.equal(await page.evaluate(()=>scrollY),900);assert.equal(await page.locator('#pdf-scroll').evaluate(el=>el.scrollTop),370);
   assert.equal(await page.evaluate(()=>ViewPosition.activeNote()),'note-long');
   assert.deepEqual(await page.evaluate(()=>ViewPosition.read().reader),{documentId:'pdf-a',page:3,zoom:1.6});
   await page.evaluate(()=>ViewPosition.cancel());
  }
  // Missing layout arrives after the restore; settled reapplies PDF offsets.
  await page.evaluate(()=>{ViewPosition.capture();mount('notes');document.getElementById('pdf-scroll').innerHTML='';ViewPosition.restore();});await page.waitForTimeout(80);
  await page.evaluate(()=>{document.getElementById('pdf-scroll').innerHTML='<div style="height:1000px">PDF</div>';ViewPosition.settled();});await page.waitForTimeout(80);assert.equal(await page.locator('#pdf-scroll').evaluate(el=>el.scrollTop),370);
  await page.evaluate(()=>{ViewPosition.cancel();cid='other-course';ViewPosition.restore();});await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>scrollY),0);
  await page.evaluate(()=>{ViewPosition.cancel();changeRoom('b');cid='course-a';ViewPosition.restore();});await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>scrollY),0);assert.equal(await page.evaluate(()=>ViewPosition.activeNote()),null);
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>{ViewPosition.cancel();view='study';mount('study');scrollTo(0,700);ViewPosition.capture();view='notes';mount('notes');ViewPosition.restore();});await page.waitForTimeout(80);
  await page.evaluate(()=>{ViewPosition.cancel();view='study';mount('study');ViewPosition.restore();});await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>scrollY),700);
  console.log('view positions: study/notes, per-note PDF offsets, async layout, course/room isolation, mobile OK');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
