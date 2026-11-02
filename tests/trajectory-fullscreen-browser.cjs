// Run with CODEX_PRIMARY_RUNTIME_NODE_MODULES and TRAJECTORY_CHROMIUM_EXECUTABLE set.
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/playwright');
const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const executablePath=process.env.TRAJECTORY_CHROMIUM_EXECUTABLE;
if(!executablePath)throw new Error('Set TRAJECTORY_CHROMIUM_EXECUTABLE to an installed Chromium executable.');
(async()=>{
 const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://local');if(url.pathname==='/wrapper'){res.setHeader('Content-Type','text/html');res.end('<style>body{margin:0}header{height:90px}iframe{width:100%;height:calc(100vh - 90px);border:0}</style><header>ID東都</header><iframe src="/trajectory-studio/index.html?embedded=1&season=2026-fall'+''+'" allowfullscreen></iframe>');return;}const file=path.join(root+'/public',url.pathname);try{res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}}).listen(0,'127.0.0.1');await new Promise(r=>server.on('listening',r));
 let browser;
 const origin='http://127.0.0.1:'+server.address().port;
 try{for(const spec of [{width:1920,height:1200,dpr:1,embedded:true},{width:1280,height:800,dpr:1.5,embedded:true},{width:960,height:540,dpr:1,embedded:true},{width:844,height:390,dpr:2,embedded:true},{width:390,height:844,dpr:2,embedded:true},{width:1280,height:800,dpr:1,embedded:false}]){
 browser=await chromium.launch({headless:true,executablePath,args:['--no-sandbox','--disable-dev-shm-usage','--no-zygote']});const page=await browser.newPage({viewport:{width:spec.width,height:spec.height},deviceScaleFactor:spec.dpr});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+(spec.embedded?'/wrapper':'/trajectory-studio/index.html?season=2026-fall'));let frame=spec.embedded?page.frames().find(f=>f.url().includes('/trajectory-studio/index.html')):page.mainFrame();await frame.waitForFunction(()=>window.StudioAdapter?.getState().current&&window.StudioAdapter.getState().result);await frame.locator('#bootNotice').waitFor({state:'hidden'});
 for(const mode of ['comparison','realism','random']){
 if(mode==='realism'){await frame.locator('#realismToggle').click();}
 if(mode==='random'){await frame.locator('#randomToggle').click();await frame.locator('#nextRandom').click();await frame.waitForFunction(()=>window.StudioAdapter.getState().progress>=1);}
 await frame.locator('#fullscreen').click();await frame.waitForFunction(()=>document.fullscreenElement?.id==='viewer');await frame.waitForFunction(()=>{const a=document.querySelector('#viewercanbox').getBoundingClientRect(),r=window.StudioAdapter.getState().result;return Math.abs(a.height-r.height)<1&&Math.abs(a.width-r.width)<1;});
 const result=await frame.evaluate(()=>{const state=window.StudioAdapter.getState(),rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom};},stage=rect(document.querySelector('#viewercanbox')),viewbar=rect(document.querySelector('.viewbar'));return {stage,viewbar,zone:state.result.referenceZone.map(p=>p.slice(0,2)),zoneBottom:stage.y+Math.max(...state.result.referenceZone.map(p=>p[1])),viewport:{width:innerWidth,height:innerHeight},controls:[...document.querySelectorAll('#viewer>.viewbar,#viewer>.transport,#viewer>.randomControls')].filter(e=>getComputedStyle(e).display!=='none').map(rect),pitchId:state.result.balls[0]?.id,progress:state.progress};});
 assert(result.stage.bottom<=result.viewbar.y+.5,'stage overlaps controls');assert(result.zoneBottom<=result.stage.bottom,'zone leaves the visible stage');assert(result.zone.every(p=>p[0]>=0&&p[0]<=result.stage.width&&p[1]>=0&&p[1]<=result.stage.height),'zone must fit in visible canvas');for(const r of result.controls){assert(r.bottom<=result.viewport.height+.5,'controls clipped at bottom');assert(r.x>=0&&r.x+r.width<=result.viewport.width+.5,'controls clipped horizontally');}console.log('PASS '+JSON.stringify({spec,mode,stage:result.stage,zoneBottom:result.zoneBottom,viewbarTop:result.viewbar.y}));
 await frame.locator('#fullscreen').click();await frame.waitForFunction(()=>!document.fullscreenElement);if(mode==='random')assert.equal((await frame.evaluate(()=>window.StudioAdapter.getState().result.balls[0]?.id)),result.pitchId);
 }
 assert.deepEqual(errors,[]);await browser.close();}
 }finally{if(browser?.isConnected())await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exit(1)});
