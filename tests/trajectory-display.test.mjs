import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
class Context{
 constructor(){this.globalAlpha=1;this.stack=[];this.strokes=[];this.arcs=[];this.images=0;}
 save(){this.stack.push({globalAlpha:this.globalAlpha});}restore(){assert(this.stack.length>0);Object.assign(this,this.stack.pop());}
 setTransform(){}translate(){}rotate(){}scale(){}clearRect(){}fillRect(){}beginPath(){}rect(){}clip(){}moveTo(){}lineTo(){}closePath(){}fill(){}fillText(){}setLineDash(){}
 arc(x,y,r){this.arcs.push([x,y,r]);}stroke(){this.strokes.push({width:this.lineWidth,alpha:this.globalAlpha,style:this.strokeStyle});}drawImage(){this.images++;}
 createLinearGradient(){return {addColorStop(){}};}createRadialGradient(){return {addColorStop(){}};}
}
class Canvas{constructor(){this.width=1000;this.height=600;this.context=new Context();}getContext(){return this.context;}}
const root=new URL('../public/trajectory-studio/',import.meta.url);
function runtime(){const scope={window:null,document:{createElement:()=>new Canvas()},console};scope.window=scope;vm.createContext(scope);for(const file of ['baseball.js','scene.js','diagnostics.js'])vm.runInContext(fs.readFileSync(new URL(file,root),'utf8'),scope);return scope;}
const pitch=(id,side=0,time=.4)=>({id,type:'Fastball',validTrajectory:true,time,flightEndTime:time,velocity:150,spin:2400,spinAxis:180,c:[[16,-40,0],[1.8,-1.5,0],[-side,0,0]]});
const options={compact:true,view:'right',zoom:1,realism:true,batterEye:{height:1.5,side:.34,forward:.25}};
test('comparison camera and cached field stay identical when selected releases/counts change',()=>{
 const s=runtime(),a=pitch('a',-.5),b=pitch('b',.5),all={pitches:[a,b]},canvas=new Canvas();
 const x=s.drawTrajectory(canvas,all,[a],{...options,realism:false,progress:0}),y=s.drawTrajectory(canvas,all,[b],{...options,realism:false,progress:0}),z=s.drawTrajectory(canvas,all,[a,b],{...options,realism:false,progress:.3});
 assert.deepEqual(x.camera,y.camera);assert.deepEqual(y.camera,z.camera);assert.notDeepEqual(x.balls[0].screenPoint,y.balls[0].screenPoint);assert.equal(x.backgroundHit,false);assert.equal(y.backgroundHit,true);assert.equal(z.backgroundHit,true);assert.equal(canvas.context.stack.length,0);
 const follow=s.drawTrajectory(canvas,all,[b],{...options,realism:false,progress:.3,gazeMode:'release'});assert.deepEqual(follow.camera,x.camera);
 const selected=s.drawTrajectory(canvas,all,[a],{...options,realism:false,gazeMode:'selected'});assert.notDeepEqual(selected.camera.target,x.camera.target);
});
test('each real ball ends at its own measured interval while comparison preserves its endpoint',()=>{
 const s=runtime(),a=pitch('a',0,.3),b=pitch('b',.2,.4),all={pitches:[a,b]};
 const real=s.drawTrajectory(new Canvas(),all,[a,b],{...options,progress:.8});assert.equal(real.balls[0].ended,true);assert.equal(real.balls[1].ended,false);
 const compare=s.drawTrajectory(new Canvas(),all,[a,b],{...options,realism:false,progress:1});assert.equal(compare.balls[0].ended,false);assert.equal(compare.balls[0].time,.3);assert.deepEqual(compare.balls[0].position,real.balls[0].position);
});
test('post-delivery catcher review shows the actual endpoint and zone without extending the measured flight',()=>{
 const s=runtime(),p={...pitch('end',.1),flightEndTime:.3,endsBeforePlate:true},all={pitches:[p]},canvas=new Canvas();
 const flight=s.drawTrajectory(canvas,all,[p],{...options,view:'catcher',progress:.5,endpointReview:true});assert.equal(flight.endpointReview,false);
 const review=s.drawTrajectory(canvas,all,[p],{...options,view:'catcher',progress:1,endpointReview:true});assert.equal(review.endpointReview,true);assert.equal(review.visibleCount,1);assert.equal(review.backgroundHit,true);assert.equal(review.balls[0].ended,true);assert.equal(review.balls[0].endpointVisible,true);assert(review.balls[0].renderSpinState);assert.equal(review.balls[0].time,.3);assert.deepEqual(review.balls[0].position,s.pitchPosition(p,.3));assert.notDeepEqual(review.balls[0].position,s.pitchPosition(p,.4));assert.deepEqual(review.camera,flight.camera);assert(review.referenceZone.every(p=>p&&p.slice(0,2).every(Number.isFinite)));
 const video=s.drawTrajectory(new Canvas(),all,[p],{...options,view:'catcher',progress:1,endpointReview:true,videoFrame:{}});assert.equal(video.endpointReview,false);assert.equal(video.balls[0].endpointVisible,false);
});
test('exact off-axis sphere silhouette agrees with independently projected tangent points',()=>{
 const s=runtime(),P=[.8,-.4,2],E=[0,0,0],camera={right:[1,0,0],up:[0,-1,0],forward:[0,0,1]},r=.0366,f=700,pp=[500,300];
 const sphere=s.projectSphere(P,E,camera,f,pp,r),d=Math.hypot(...P),n=P.map(x=>x/d),u=[-n[1],n[0],0],ul=Math.hypot(...u);for(let i=0;i<3;i++)u[i]/=ul;
 const v=[n[1]*u[2]-n[2]*u[1],n[2]*u[0]-n[0]*u[2],n[0]*u[1]-n[1]*u[0]],center=P.map(x=>x*(1-r*r/d/d)),tr=r*Math.sqrt(1-r*r/d/d);
 for(let i=0;i<50;i++){const a=i/50*Math.PI*2,t=center.map((x,j)=>x+tr*(u[j]*Math.cos(a)+v[j]*Math.sin(a))),x=f*t[0]/t[2]+pp[0]-sphere.center[0],y=f*t[1]/t[2]+pp[1]-sphere.center[1],ca=Math.cos(sphere.angle),sa=Math.sin(sphere.angle),ellipse=((x*ca+y*sa)/sphere.major)**2+((-x*sa+y*ca)/sphere.minor)**2;assert(Math.abs(ellipse-1)<1e-10);}
});
test('shared gyro data controls axis; unknown gyro and seam pose stay explicit, pose is independent of type',()=>{
 const s=runtime(),p={...pitch('same-id'),gyroAngle:60,estimateMethod:'shared'};
 const state=s.drawSpinningBaseball.spinState(p,.1);assert(Math.abs(state.axis[2]-Math.sin(Math.PI/3))<1e-12);assert.equal(state.gyroEstimated,true);assert.equal(state.estimateMethod,'shared');assert.equal(s.drawSpinningBaseball.spinState({...p,gyroAngle:null},.1).gyroAssumed,0);
 const a=new Context(),b=new Context();s.drawSpinningBaseball(a,{x:0,y:0,radius:20,pitch:p,elapsed:.1,outline:false});s.drawSpinningBaseball(b,{x:0,y:0,radius:20,pitch:{...p,type:'Slider'},elapsed:.1,outline:false});assert.deepEqual(a.arcs,b.arcs);assert.deepEqual(a.strokes,b.strokes);assert.equal(a.stack.length,0);
});
test('no shadow extends the outline and seam energy is continuous around former size thresholds',()=>{
 const s=runtime();for(const r of [.4,3.2,12,18,24,40]){const c=new Context();s.drawSpinningBaseball(c,{x:10,y:10,radius:r,pitch:pitch('a'),elapsed:.1,outline:false});assert.equal(c.arcs[0][0],10);assert.equal(c.arcs[0][1],10);assert.equal(c.arcs[0][2],r);assert.equal(c.stack.length,0);}
 const energy=r=>{const c=new Context();s.drawSpinningBaseball(c,{x:0,y:0,radius:r,pitch:pitch('a'),elapsed:.1,outline:false});return c.strokes.reduce((n,p)=>n+p.width*p.alpha,0);};
 for(const r of [3.2,12,18,24,40])assert(Math.abs(energy(r+.00001)-energy(r-.00001))<.002,r);
});
test('angular diagnostics reject interrupted trials and reset across seeking/visibility',()=>{
 const s=runtime();const expected=(Math.atan2(.1,10))/(2*Math.asin(.0366/Math.hypot(.05,10)));assert(Math.abs(s.pitchAngularTravel([0,0,10],[.1,0,10],[.05,0,10],[0,0,0])-expected)<1e-12);
 const camera={eye:[0,0,0]},d=s.createPitchDiagnostics(),result=t=>({camera,elapsed:t,balls:[{id:'a',time:t,position:[t,0,10],radius:1,physicalRadius:1}]});
 d.record(result(0),0,1);d.record(result(.02),20,1);d.record(result(.12),120,1);assert.equal(d.report().comparisonEligible,false);assert.equal(d.report().maxGapMs,100);d.record(result(.13),130,1,true);d.record(result(.2),200,1);assert.equal(d.report().frames.at(-1).gapMs,null);
});
test('video requires independent correspondences and preserves aspect ratio in rendering',()=>{
 const s=runtime();assert.throws(()=>s.validateVideoCalibration({}),/カメラ/);
 const c={eye:[0,1.5,-2],target:[0,1.8,16],focal:1000,width:1920,height:1080,principalPoint:[960,540],checks:Array.from({length:6},()=>({world:[0,0,0],pixel:[960,900]}))};assert.throws(()=>s.validateVideoCalibration(c),/6点/);
 const canvas=new Canvas(),p=pitch('p');const r=s.drawTrajectory(canvas,{pitches:[p]},[p],{...options,videoCamera:c,videoFrame:{},progress:0});assert(Math.abs(r.camera.focal-1000*1000/1920)<1e-9);assert.equal(canvas.context.images,1);
});
test('all generated estimates equal the existing profile feed',()=>{
 const html=fs.readFileSync(new URL('index.html',root),'utf8'),catalog=JSON.parse(html.match(/<script>const DATA=([\s\S]*?);<\/script>/)[1]);let estimates=0;
 for(const season of catalog.seasons){const rows=JSON.parse(fs.readFileSync(new URL(`../data/spin-${season.id}.json`,root),'utf8')),byId=new Map(rows.filter(r=>r.pitchId).map(r=>[r.pitchId,r])),legacy=new Map();for(const row of rows.filter(r=>!r.pitchId)){const key=[row.pitcherId.match(/:id:([^|]+)/)?.[1],row.date,row.pitchNo].join('|');legacy.set(key,row);}
 for(const pitcher of season.pitchers){const d=JSON.parse(fs.readFileSync(new URL(pitcher.dataUrl.split('?')[0],root),'utf8'));for(const p of d.pitches){if(p.gyroAngle===null)continue;const row=byId.get(p.id)||legacy.get([pitcher.id,p.date,p.pitchNo].join('|'));assert(row);assert.equal(p.gyroAngle,row.gyroAngle);assert.equal(p.spinEfficiency,row.spinEfficiency);estimates++;}}}
 assert(estimates>23000);
});

test('practice gaze follows each ball then holds the stop direction without moving either batter eye',()=>{
 const s=runtime(),p={...pitch('curve'),c:[[16,-40,2],[1.8,0,-5],[-.2,.5,.3]]},all={pitches:[p]},impact=s.pitchImpact(p);
 assert(Math.abs(impact.impactPosition[2]-.06)<1e-12);
 assert.equal(impact.gazeTransitionTime,impact.impactTime-.120);
 const direction=(target,eye)=>{const d=target.map((v,i)=>v-eye[i]),l=Math.hypot(...d);return d.map(v=>v/l);};
 const close=(a,b)=>a.forEach((v,i)=>assert(Math.abs(v-b[i])<1e-9));
 for(const view of ['left','right']){
  const canvas=new Canvas(),eye=s.batterCamera(options.batterEye,view).eye,render=t=>s.drawTrajectory(canvas,all,[p],{...options,view,progress:t/p.time});
  for(const t of [0,.1,impact.gazeTransitionTime-1e-6]){const r=render(t);assert.deepEqual(r.camera.eye,eye);close(direction(r.camera.target,eye),direction(s.pitchPosition(p,t),eye));assert.equal(r.gaze[0].phase,t===0?'ready':'tracking');}
  const before=render(impact.gazeTransitionTime-1e-7),start=render(impact.gazeTransitionTime);
  assert(Math.hypot(...direction(start.camera.target,eye).map((v,i)=>v-direction(before.camera.target,eye)[i]))<1e-5);
  for(const t of [impact.gazeTransitionTime+.030,impact.impactTime,p.time]){const r=render(t);assert.deepEqual(r.camera.eye,eye);assert.deepEqual(r.camera,start.camera);assert.equal(r.backgroundHit,true);close(direction(r.camera.target,eye),direction(s.pitchPosition(p,impact.gazeTransitionTime),eye));assert.equal(r.gaze[0].phase,'held');assert.notDeepEqual(r.balls[0].position,start.balls[0].position);}
  const halfway=render(impact.gazeTransitionTime+.015);assert.equal(halfway.gaze[0].phase,'held');assert.deepEqual(halfway.camera,start.camera);assert(halfway.camera.target.every(Number.isFinite));
  assert.deepEqual(render(.1).camera, s.drawTrajectory(new Canvas(),all,[p],{...options,view,progress:.1/p.time,gazeMode:'follow'}).camera);
 }
 const catcher=s.drawTrajectory(new Canvas(),all,[p],{...options,view:'catcher',progress:.5});assert.equal(catcher.gaze,null);
});
test('impact time varies with trajectory, ignores velocity tables, and never extrapolates short flights',()=>{
 const s=runtime(),fast=pitch('fast'),slow={...pitch('slow',.4,.6),c:[[16,-16/.6,0],[1.8,-1,0],[-.4,.1,.2]]};
 assert(s.pitchImpact(slow).gazeTransitionTime>s.pitchImpact(fast).gazeTransitionTime);
 assert.deepEqual(s.pitchImpact({...fast,velocity:80}),s.pitchImpact({...fast,velocity:160}));
 assert.notDeepEqual(s.pitchImpact(slow).impactPosition,s.pitchImpact(fast).impactPosition);
 const short={...fast,flightEndTime:.2,endsBeforePlate:true};assert.equal(s.pitchImpact(short),null);
 assert.deepEqual(s.pitchPracticeGaze(short,.4,[.34,1.5,.25]).target,s.pitchPosition(short,.2));
});
test('every recorded impact lies on the 6 cm plane within its measured interval',()=>{
 const s=runtime(),html=fs.readFileSync(new URL('index.html',root),'utf8'),catalog=JSON.parse(html.match(/<script>const DATA=([\s\S]*?);<\/script>/)[1]);let checked=0,short=0;
 for(const season of catalog.seasons)for(const meta of season.pitchers){const payload=JSON.parse(fs.readFileSync(new URL(meta.dataUrl.split('?')[0],root),'utf8'));for(const p of payload.pitches){if(!p.validTrajectory)continue;const impact=s.pitchImpact(p);if(!impact){assert(s.pitchPosition(p,p.flightEndTime??p.time)[2]>.06);short++;continue;}assert(impact.impactTime>=0&&impact.impactTime<=(p.flightEndTime??p.time));assert(Math.abs(impact.impactPosition[2]-.06)<1e-10);assert(Math.abs(impact.impactTime-impact.gazeTransitionTime-.120)<1e-12);checked++;}}
 assert(checked>24000);assert(short>0);
});

test('adjusted catcher eyes retain physical pitch endpoints and fit the zone on both sides',()=>{
 const s=runtime(),p=pitch('catcher'),all={pitches:[p]};
 for(const eye of [{side:-2,height:.5,forward:-.5},{side:2,height:2.3,forward:-3},{side:0,height:.85,forward:-1.75}]){
  const result=s.drawTrajectory(new Canvas(),all,[p],{compact:true,view:'catcher',catcherEye:eye,progress:1});
  assert.deepEqual(Array.from(result.camera.eye),[eye.side,eye.height,eye.forward]);
  const bounds=result.camera.zoneBounds;for(const point of result.referenceZone){assert(point[0]>=bounds.left-1e-6&&point[0]<=bounds.right+1e-6);assert(point[1]>=bounds.top-1e-6&&point[1]<=bounds.bottom+1e-6);}
  assert.deepEqual(Array.from(result.balls[0].position),Array.from(s.pitchPosition(p,p.time)));
 }
});
test('catcher drag mapping crosses the home center and round trips with the batter mapping',()=>{
 const scope={window:{}};vm.createContext(scope);vm.runInContext(fs.readFileSync(new URL('position_pad.js',root),'utf8'),scope);
 const mapping=scope.window.positionPadMapping;
 for(const view of ['catcher','right','left'])for(const side of (view==='catcher'?[-2,-.6,0,.6,2]:[0,.34,2])){
  const p={side,forward:-1.75},point=mapping.positionToPoint(p,view),actual=mapping.pointToPosition(point,view);assert.equal(actual.side,side);assert.equal(actual.forward,p.forward);
 }
});
test('catcher reuses pointer drag, touch capture and keyboard movement',()=>{
 const scope={window:{devicePixelRatio:1}},handlers={},attrs={};let settings={side:0,forward:-1.75},captured=null;
 const context=new Proxy({}, {get:(o,k)=>o[k]??(()=>{})});
 const canvas={style:{},width:260,height:130,getContext:()=>context,getBoundingClientRect:()=>({left:0,top:0,width:260,height:130}),getAttribute:k=>attrs[k]??null,setAttribute:(k,v)=>attrs[k]=v,addEventListener:(k,v)=>handlers[k]=v,focus(){},setPointerCapture:id=>captured=id,hasPointerCapture:id=>captured===id,releasePointerCapture:()=>captured=null};
 vm.createContext(scope);vm.runInContext(fs.readFileSync(new URL('position_pad.js',root),'utf8'),scope);
 scope.window.createPositionPad(canvas,{getSettings:()=>settings,getView:()=> 'catcher',onChange:p=>settings=p});
 const mapping=scope.window.positionPadMapping,start=mapping.positionToPoint(settings,'catcher'),end=mapping.positionToPoint({side:-.7,forward:-2.2},'catcher');
 const event=(point)=>({pointerId:3,button:0,clientX:point.x,clientY:point.y,preventDefault(){}});
 handlers.pointerdown(event(start));assert.equal(captured,3);handlers.pointermove(event(end));handlers.pointerup(event(end));
 assert.equal(settings.side,-.7);assert.equal(settings.forward,-2.2);assert.equal(captured,null);assert.equal(attrs['aria-disabled'],'false');
 handlers.keydown({key:'ArrowLeft',preventDefault(){}});assert.equal(settings.side,-.69);
});

test('completed practice frame resets before the next random release and preserves the measured endpoint',()=>{
 const s=runtime(),a=pitch('a',-.5),b=pitch('b',.5),all={pitches:[a,b]},canvas=new Canvas();
 for(const view of ['right','left']){
  const draw=(ps,progress,practiceGazeReady=false)=>s.drawTrajectory(canvas,all,ps,{...options,view,progress,endpointReview:true,practiceGazeReady});
  const waiting=draw([a],1);assert.equal(waiting.gaze[0].phase,'held');
  assert.deepEqual(waiting.camera,draw([a],.9).camera);
  const end=draw([a],1,true),next=draw([b],0);
  assert.deepEqual(waiting.balls[0].position,end.balls[0].position);
  assert.deepEqual(end.camera,next.camera);assert.equal(next.backgroundHit,true);
  assert.equal(end.gaze[0].phase,'ready');assert.deepEqual(end.balls[0].position,s.pitchPosition(a,a.time));
  assert.equal(end.balls[0].time,a.time);assert.equal(end.endpointReview,true);
  const tiny=draw([b],.000001);assert(Math.hypot(...tiny.camera.target.map((v,i)=>v-next.camera.target[i]))<1e-8);
  const tracked=draw([b],.25);assert.notDeepEqual(tracked.camera.target,next.camera.target);
  const held=draw([b],.8),late=draw([b],.99);assert.deepEqual(held.camera,late.camera);
  const catcher=s.drawTrajectory(canvas,all,[a],{...options,view:'catcher',progress:1,endpointReview:true});assert.deepEqual(catcher.balls[0].position,end.balls[0].position);
  const empty=draw([],0);assert.deepEqual(empty.camera,next.camera);
 }
});


test('optional practice paths preserve camera and ball motion, with a common color and full-flight toggle',()=>{
 const s=runtime(),p=pitch('paths'),all={pitches:[p]};
 const render=extra=>{const canvas=new Canvas();const result=s.drawTrajectory(canvas,all,[p],{...options,view:'catcher',progress:.5,trail:false,...extra});return {result,lines:canvas.context.strokes.filter(x=>x.style==='#40556b')};};
 const initial=render({}),hidden=render({showPaths:false}),shown=render({showPaths:true}),full=render({showPaths:true,trail:true});
 assert.equal(initial.lines.length,0);assert.equal(hidden.lines.length,0);assert(shown.lines.length>0);assert(full.lines.some(x=>x.alpha===.25));assert(shown.lines.every(x=>x.alpha===1));
 assert.deepEqual(shown.result.camera,hidden.result.camera);assert.deepEqual(shown.result.balls,hidden.result.balls);
 p.type='Slider';assert.deepEqual(render({showPaths:true}).lines,shown.lines);
});
