// Sinthetic regression for inline notes and PDF cells; all state lives in temp.
const {chromium}=require('playwright');
const fs=require('fs'),os=require('os'),path=require('path'),net=require('net'),assert=require('assert/strict'),{spawn}=require('child_process');
const {fixturePDF}=require('./helpers/pdf_fixture.cjs');
(async()=>{
  const root=path.resolve(__dirname,'..'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'glosa-note-simple-')),data=path.join(temp,'data'),margen=path.join(temp,'margen'),listener=net.createServer();
  fs.mkdirSync(path.join(data,'documents'),{recursive:true});fs.mkdirSync(margen);fs.writeFileSync(path.join(data,'documents','fixture.pdf'),fixturePDF());
  await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
  const service=spawn('python3',['-c',`import json,hashlib,server
server.init_db()
doc={'id':'simple-pdf','title':'PDF sintético','pages':2,'sha256':hashlib.sha256((server.DATA/'documents'/'fixture.pdf').read_bytes()).hexdigest(),'storage':'upload','filename':'fixture.pdf'}
with server.connect() as conn: conn.execute('INSERT INTO documents VALUES(?,?)',(doc['id'],json.dumps(doc)))
server.library().save_note({'id':'simple-note','title':'Título original','folder':'','content':'# Título original\\n\\nContexto preservado.\\n\\n## Sección\\n\\n- Punto\\n\\n'+chr(96)*3+'txt\\ncódigo\\n'+chr(96)*3,'contentFormat':'markdown','shared':False,'documentId':doc['id'],'page':1,'writingScope':'page','pageNotes':{doc['id']:{'1':''}},'anchors':[]})
server.ThreadingHTTPServer(('127.0.0.1',server.PORT),server.Handler).serve_forever()
`],{cwd:root,env:{...process.env,LEARNING_DATA_DIR:data,GLOSA_MARGEN_DIR:margen,LEARNING_PORT:String(port)},stdio:['ignore','ignore','pipe']});
  let browser,stderr='';service.stderr.on('data',d=>stderr+=d);const base=`http://127.0.0.1:${port}`;
  try{
    for(let i=0;i<100;i++){try{if((await fetch(base+'/api/state')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));if(i===99)throw Error(stderr);}
    browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||chromium.executablePath()});
    const page=await browser.newPage({viewport:{width:1366,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{localStorage.setItem('glosa-active-room','local');sessionStorage.setItem('glosa-home-intent',JSON.stringify({roomId:'local'}));});await page.goto(base);
    await page.waitForFunction(()=>typeof state!=='undefined'&&state?.library&&typeof WorkspaceKeys!=='undefined'&&typeof ClassNotes!=='undefined');await page.evaluate(async()=>{await WorkspaceKeys.go('notes');await ClassNotes.select('simple-note');});
    await page.waitForFunction(()=>document.querySelector('.note-page-cell .note-cell-content'));
    const original='# Título original\n\nContexto preservado.\n\n## Sección\n\n- Punto\n\n```txt\ncódigo\n```';
    assert.equal((await(await fetch(base+'/api/state')).json()).library.notes[0].content,original);
    await page.locator('#note-title-input').fill('Título editado');await page.evaluate(()=>ClassNotes.flush());
    let saved=(await(await fetch(base+'/api/state')).json()).library.notes[0];assert.equal(saved.title,'Título editado');assert.equal(saved.content,original.replace(/^# Título original/,'# Título editado'));
    const cell=page.locator('.note-page-cell .vim-field .cm-content, .note-page-cell textarea:not(.vim-source)').first();await cell.click();await page.keyboard.press('Control+End');await page.keyboard.press('Enter');await page.keyboard.type('/');
    await page.getByRole('menu',{name:'Acciones del apunte'}).waitFor();await page.keyboard.press('Escape');await page.keyboard.type('Texto PDF / literal');await page.evaluate(()=>ClassNotes.flush());
    saved=(await(await fetch(base+'/api/state')).json()).library.notes[0];assert.equal(saved.pageNotes['simple-pdf']['1'],'\nTexto PDF / literal');assert.deepEqual(errors,[]);
    await page.evaluate(()=>ClassNotes.openList());
    await page.locator('.note-list-actions summary').first().click();
    const menu=page.locator('.note-list-actions[open] .note-list-actions-menu').first();
    const layout=await menu.evaluate(el=>({width:el.getBoundingClientRect().width, tops:[...el.querySelectorAll('button')].map(b=>b.getBoundingClientRect().top)}));
    assert(layout.width<160);assert(layout.tops.every(top=>Math.abs(top-layout.tops[0])<1));
    await page.locator('.note-list-actions[open] summary').click();await page.evaluate(()=>ClassNotes.closeList());
    await page.evaluate(()=>ClassNotes.create());
    const preview=page.locator('#note-markdown-preview');
    assert(await page.evaluate(()=>!!document.activeElement.closest('.cm-content')));
    await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'note-title-input');
    assert(await page.locator('.note-editor .cm-cursorLayer').evaluateAll(els=>els.every(el=>getComputedStyle(el).visibility==='hidden')));
    await page.keyboard.press('Tab');assert(await page.evaluate(()=>!!document.activeElement.closest('.cm-content')));

    assert.equal(await preview.getAttribute('data-empty'),'true');
    assert.equal(await page.locator('.note-empty-hint').count(),0);
    assert.equal(await preview.locator('.cm-line').first().evaluate(el=>getComputedStyle(el,'::before').content),'"Empezá a escribir…"');
    await preview.locator('.cm-content').click();await page.keyboard.type('Texto');
    assert.equal(await preview.getAttribute('data-empty'),'false');
    const capture='/tmp/glosa-note-simple.png';await page.screenshot({path:capture});console.log(`OK: title/body roundtrip, PDF-cell slash/Escape/literal, no page errors; capture ${capture}`);
  }finally{await browser?.close();service.kill();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
