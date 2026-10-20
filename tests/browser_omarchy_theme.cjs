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

  const palette={available:true,mode:'dark',variables:{'--bg':'#1a1b26','--paper':'#1a1b26','--ink':'#a9b1d6','--muted':'#a9b1d6','--green':'#7aa2f7','--accent-ink':'#7aa2f7','--accent-solid':'#7aa2f7','--on-accent':'#000000','--line':'#414868','--pale':'#1a1b26','--panel':'#1a1b26'}};
  let current=palette;
  await page.route('**/api/appearance/omarchy',route=>route.fulfill({json:current}));
  await page.evaluate(()=>refreshOmarchyTheme());
  await page.evaluate(()=>GlosaSettings.open());
  await page.locator('input[value="omarchy"]').check();
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(26, 27, 38)');
  assert.equal(await page.locator('input[name="accent-color"]').first().isDisabled(),true);
  await page.reload();await page.waitForFunction(()=>document.body.dataset.omarchy==='true');
  current={...palette,mode:'light',variables:{...palette.variables,'--bg':'#ffffff'}};
  await page.evaluate(()=>refreshOmarchyTheme());
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'light');
  current={available:false};await page.evaluate(()=>refreshOmarchyTheme());
  assert.equal(await page.evaluate(()=>document.body.dataset.omarchy),'false');
  assert.equal(await page.evaluate(()=>localStorage.getItem('glosa-theme')),'omarchy');
  await page.evaluate(()=>setAppearance({theme:'light'}));
  assert.equal(await page.evaluate(()=>document.body.style.getPropertyValue('--bg')),'');
  assert.deepEqual(errors,[]);console.log('Omarchy browser checks passed');
 }finally{await browser?.close();service.kill();fs.rmSync(data,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
