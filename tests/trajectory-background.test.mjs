import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';

// Use the host's native Canvas for pixel comparison without a browser or a
// production dependency. Other CI hosts may provide @napi-rs/canvas directly.
const require=createRequire(import.meta.url);
let createCanvas;
for(const candidate of ['@napi-rs/canvas',process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES&&process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES+'/@napi-rs/canvas']){
 if(!candidate)continue;
 try{({createCanvas}=require(candidate));break;}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
}
const skip=createCanvas?false:'Native Canvas unavailable; run with CODEX_PRIMARY_RUNTIME_NODE_MODULES or install @napi-rs/canvas in the QA environment.';
const root=new URL('../public/trajectory-studio/',import.meta.url);
const scene=fs.readFileSync(new URL('scene.js',root),'utf8');
const legacyField=fs.readFileSync(new URL('./fixtures/trajectory-field-before-20261019.js',import.meta.url),'utf8');
const call='drawFieldGeometry(c,canvas,eye,forward,right,up,focal,centerX,centerY,W,header,sh);';
assert(scene.includes(call),'Update the independent background reference integration when the renderer changes.');
const legacy=scene.replace(call,legacyField);
function runtime(source){
 const layers=[],canvas=(width=1,height=1)=>{
  const result=createCanvas(width,height),ctx=result.getContext('2d'),fill=ctx.fill.bind(ctx);let fills=0;
  ctx.fill=(...args)=>{fills++;return fill(...args);};
  result.fillCount=()=>fills;layers.push(result);return result;
 };
 const scope={window:null,document:{createElement:()=>canvas()},console};scope.window=scope;vm.createContext(scope);
 for(const code of [fs.readFileSync(new URL('baseball.js',root),'utf8'),source])vm.runInContext(code,scope);
 return {scope,canvas,layers};
}
function pitchers(){
 const html=fs.readFileSync(new URL('index.html',root),'utf8'),data=JSON.parse(html.match(/<script>const DATA=([\s\S]*?);<\/script>/)[1]);
 return data.seasons.find(s=>s.id==='2026-fall').pitchers.filter(p=>/子安|東恩納|下重/.test(p.name)).map(meta=>({...JSON.parse(fs.readFileSync(new URL(meta.dataUrl.split('?')[0],root),'utf8')),name:meta.name,team:meta.team}));
}
function compare(runtimes,canvases,pitcher,pitches,options,label){
 const results=runtimes.map((r,i)=>r.scope.drawTrajectory(canvases[i],pitcher,pitches,options));
 assert.equal(JSON.stringify(results[0]),JSON.stringify(results[1]),label+': trajectory/camera changed');
 const pixels=canvases.map(c=>Buffer.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data));
 assert(pixels[0].equals(pixels[1]),label+': rendered pixels changed');
 return results;
}
test('background optimization preserves pixels across views, tracking, viewport/DPR, position, zoom and export',{skip},()=>{
 const runtimes=[runtime(legacy),runtime(scene)],canvases=runtimes.map(r=>r.canvas()),all=pitchers(),cases=[];
 for(const view of ['right','left','catcher'])for(const [width,height,dpr] of [[390,550,2],[844,300,1],[1280,650,1],[1920,960,1]])for(const progress of [0,.2,.55,.85,1]){
  cases.push({width,height,options:{compact:true,view,realism:true,endpointReview:true,progress,zoom:9,pixelRatio:dpr}});
 }
 for(const view of ['right','left','catcher'])for(const eye of [{height:.5,side:0,forward:2},{height:2.3,side:2,forward:-3}])for(const zoom of [1,10])for(const progress of [.1,.9]){
  cases.push({width:1000,height:600,options:{compact:true,view,realism:view!=='catcher',progress,zoom,batterEye:eye,catcherEye:{...eye,forward:-.5},projectionMode:zoom===1?'screen':'wide',screenWidthCm:30,viewDistanceCm:50,showPaths:true}});
 }
 for(const view of ['right','left','catcher'])cases.push({width:1800,height:1120,options:{compact:false,view,realism:false,progress:.55,zoom:5,showPaths:true,trail:true}});
 for(const [index,{width,height,options}]of cases.entries()){
  for(const canvas of canvases){canvas.width=width*(options.pixelRatio||1);canvas.height=height*(options.pixelRatio||1);}
  const pitcher=all[index%all.length],pitches=pitcher.pitches.filter(p=>p.validTrajectory).slice(0,options.realism?1:3);
  compare(runtimes,canvases,pitcher,pitches,options,JSON.stringify({index,width,height,options}));
 }
 assert.equal(cases.length,87);
});
test('tracking reuses bounded canvas buffers, culls hidden field faces, and refreshes correctly after returning and resizing',{skip},()=>{
 const runtimes=[runtime(legacy),runtime(scene)],canvases=runtimes.map(r=>r.canvas(1280,650));
 const pitcher=pitchers()[0],pitches=pitcher.pitches.filter(p=>p.validTrajectory).slice(0,2);
 const options={compact:true,view:'right',realism:true,zoom:9,pixelRatio:1};
 let beforeFills,afterFills;
 for(const progress of [0,.08,.2,.35,.5,.7,.9,1]){
  const previous=runtimes.map(r=>r.layers.reduce((sum,c)=>sum+c.fillCount(),0));
  compare(runtimes,canvases,pitcher,[pitches[0]],{...options,progress},'tracking '+progress);
  if(progress===.35)[beforeFills,afterFills]=runtimes.map((r,i)=>r.layers.reduce((sum,c)=>sum+c.fillCount(),0)-previous[i]);
 }
 assert(afterFills<beforeFills/2,`Expected fewer background paint calls (${beforeFills} -> ${afterFills})`);
 assert.equal(runtimes[1].layers.length,2,'Tracking must not allocate a new background canvas every frame');
 for(const [progress,practiceGazeReady]of [[1,true],[0,false],[.4,false],[1,false]]){
  compare(runtimes,canvases,pitcher,[pitches[1]],{...options,progress,practiceGazeReady,endpointReview:true},'next pitch '+progress);
 }
 for(const canvas of canvases){canvas.width=780;canvas.height=1100;}
 const resized={...options,pixelRatio:2,view:'catcher',progress:1,endpointReview:true};
 compare(runtimes,canvases,pitcher,[pitches[1]],resized,'resize to portrait');
 const repeated=compare(runtimes,canvases,pitcher,[pitches[1]],resized,'stationary cache');
 assert(repeated[1].backgroundHit);assert.equal(runtimes[1].layers.length,2);
});
