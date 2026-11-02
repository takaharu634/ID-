import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';
class Element{
 constructor(id=''){this.id=id;this.value='';this.checked=false;this.children=[];this.width=1000;this.height=600;this.hidden=false;this.textWrites=0;this.attributes={};const classes=new Set(id==='metricsSection'?['hidden']:[]);this.classList={add:k=>classes.add(k),remove:k=>classes.delete(k),toggle:(k,on)=>on?classes.add(k):classes.delete(k),contains:k=>classes.has(k)};this.style={setProperty(){}};this.dataset={};}
 get textContent(){return this._text||'';}set textContent(value){this.textWrites++;this._text=String(value);}
 get options(){return this.children;}append(...items){this.children.push(...items);}replaceChildren(...items){this.children=items;}setAttribute(k,v){this.attributes[k]=String(v);}getBoundingClientRect(){return {width:1000,height:600};}getContext(){return {clearRect(){}};}
}
function runtime(pitches){
 let time=0,timerId=0;const timers=new Map();const draws=[];const ids=new Map(),get=id=>{if(!ids.has(id))ids.set(id,new Element(id));return ids.get(id);};for(const [id,value]of Object.entries({speed:'1',gazeMode:'release',timingMode:'real',endSpeed:'.5',pitcher:'pitcher',metricType:'Fastball'}))get(id).value=value;get('showPaths').checked=true;get('emptyPitch').disabled=true;
 const p={id:'one',date:'2026-09-08',pitchNo:1,inning:1,type:'Fastball',validTrajectory:true,time:.4,flightEndTime:.4,velocity:150,c:[[16,-40,0],[1.8,-2,0],[0,0,0]],plateHeight:1,plateSide:0};
 const ps=pitches||[p],summary=[...new Set(ps.map(p=>p.type))].map(type=>({type,n:ps.filter(p=>p.type===type).length,trajectoryN:ps.filter(p=>p.type===type&&p.validTrajectory).length,representativeId:ps.find(p=>p.type===type).id}));
 const pitcher={id:'pitcher',name:'テスト',team:'中央大学',n:ps.length,trajectoryN:ps.filter(p=>p.validTrajectory).length,pitches:ps,summary};
 const scope={window:null,DATA:{seasons:[{id:'2026-fall',pitchers:[pitcher]}]},document:{getElementById:get,createElement:()=>new Element(),querySelectorAll:selector=>selector==='#slots input,#slots select'?[get('emptyType'),get('emptyPitch')]:[],hidden:false},localStorage:{getItem(){return null;},setItem(){}},requestAnimationFrame:()=>1,cancelAnimationFrame(){},performance:{now:()=>time},setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,at:time+ms});return id;},clearTimeout:id=>timers.delete(id),pitchPracticeGaze:p=>({stopTime:p.time-.1215}),console,pitchStyle:type=>[type,type==='Fastball'?'ストレート':'スライダー','#d92d20'],pitchPosition:(p,t)=>[p.plateSide,1.8-2*t,16-40*t],pitchReleaseTarget:()=>[0,1.8,16],pitchSeparation:()=>null,catcherLensForViewport:()=>({zoom:2.75}),drawTrajectory:(_canvas,_pitcher,ps,o)=>{draws.push({...o,pitchIds:ps.map(p=>p.id)});return ({camera:{eye:[0,1.5,0],target:o.pitcherTarget},elapsed:o.progress*.4,offscreenCount:0,balls:ps.map(p=>({id:p.id,time:o.progress*.4,position:[0,1.8-2*o.progress*.4,16-40*o.progress*.4],physicalRadius:1,radius:1}))});}};scope.window=scope;vm.createContext(scope);
 for(const f of ['playback.js','diagnostics.js','selection.js'])vm.runInContext(fs.readFileSync(new URL('../public/trajectory-studio/'+f,import.meta.url),'utf8'),scope);
 const source=fs.readFileSync(new URL('../public/trajectory-studio/studio_controller.js',import.meta.url),'utf8').split('seasons.forEach')[0];vm.runInContext(source+"\ncurrent=DATA.seasons[0].pitchers[0];selected=[{id:'one',enabled:true,type:'Fastball'}];pitcherTarget=pitchReleaseTarget(current.pitches);progress=0;window.api={adjustPosition,updateEye,applySettings,toggleFullscreen,startPlayback,tick,repaint,stop,selectPitcher,setRandomMode,nextRandomPitch,replayFromStart,togglePlay,step,switchView,pitchZoneVerdict,report:()=>diagnosticRun?.report(),state:()=>({playing,progress,randomMode,randomRevealed,randomCount,view,pitchId:chosen()[0]?.id,selected:selected.map(s=>({...s})),target:pitcherTarget.slice(),settings:snapshotSettings()})};",scope);
 const fullSource=fs.readFileSync(new URL('../public/trajectory-studio/studio_controller.js',import.meta.url),'utf8');
 vm.runInContext(fullSource.slice(fullSource.indexOf("for(const id of ['speed','playbackSpeed'"),fullSource.indexOf("$('projectionMode').onchange=")),scope);
 vm.runInContext("Math.random=()=>0",scope);
 return {scope,get,pitcher,draws,setTime:t=>{time=t;for(const [id,timer]of timers)if(timer.at<=time){timers.delete(id);timer.fn();}}};
}
test('terminal frame stall is recorded even after playback stops',()=>{const {scope,setTime}=runtime();scope.api.startPlayback();setTime(16);scope.api.tick(16);setTime(400);scope.api.tick(400);assert.equal(scope.api.state().playing,false);assert.equal(scope.api.report().frames.at(-1).time,.4);assert.equal(scope.api.report().maxGapMs,384);assert.equal(scope.api.report().comparisonEligible,false);});
test('ordinary playback cannot advance independently of a connected video clock',()=>{const {scope,get}=runtime();scope.StudioValidation={transportLocked:()=>true,renderOptions:()=>({}),afterRender(){},renderer:()=>null};scope.api.repaint();for(const id of ['play','reset','stepBack','stepForward','scrub','speed','season','team','pitcher','metricsTab'])assert.equal(get(id).disabled,true,id);scope.api.startPlayback();assert.equal(scope.api.state().playing,false);assert.equal(get('emptyType').disabled,true);scope.StudioValidation.transportLocked=()=>false;scope.api.repaint();assert.equal(get('emptyType').disabled,false);assert.equal(get('emptyPitch').disabled,true);});
test('all recorded pitchers start with A only, prefer a measured fastball and prepare B through E',()=>{
 const {scope}=runtime(),catalog=JSON.parse(fs.readFileSync(new URL('../public/trajectory-studio/index.html',import.meta.url),'utf8').match(/<script>const DATA=([\s\S]*?);<\/script>/)[1]);
 for(const season of catalog.seasons)for(const meta of season.pitchers){
  const payload=JSON.parse(fs.readFileSync(new URL('../public/trajectory-studio/'+meta.dataUrl.split('?')[0],import.meta.url),'utf8'));
  const pitcher={...meta,pitches:payload.pitches},pool=payload.pitches.filter(p=>p.validTrajectory),slots=scope.StudioSelection.initialSlots(pitcher,()=>true);
  assert.equal(slots.length,5,meta.id);
  assert.deepEqual(Array.from(slots,s=>s.enabled),pool.length?[true,false,false,false,false]:[false,false,false,false,false]);
  if(!pool.length)continue;
  if(pool.some(p=>p.type==='Fastball'))assert.equal(slots[0].type,'Fastball',meta.id);
  for(const slot of slots)assert(pool.some(p=>p.id===slot.id&&p.type===slot.type),meta.id);
  assert.equal(new Set(slots.map(s=>s.type)).size,Math.min(5,new Set(pool.map(p=>p.type)).size));
 }
});
test('sparse repertoires prepare real deliveries and fall back when fastball or zone data is absent',()=>{
 const {scope,pitcher}=runtime();const outside={...pitcher.pitches[0],id:'outside',type:'Slider',plateSide:.6},fb={...outside,id:'fast',type:'Fastball'};
 const slots=scope.StudioSelection.initialSlots({pitches:[outside,fb],summary:[]},()=>false);
 assert.equal(slots[0].id,'fast');assert(slots.every(s=>['outside','fast'].includes(s.id)));assert(slots.slice(1).every(s=>!s.enabled));
 assert(scope.StudioSelection.initialSlots({pitches:[outside],summary:[]},()=>false).every(s=>s.id==='outside'));
});
test('random deck includes every usable course and type, excludes missing trajectories and avoids consecutive repeats',()=>{
 const {scope,pitcher}=runtime(),p=pitcher.pitches[0],pool=[p,{...p,id:'outside',type:'Slider',plateSide:.6},{...p,id:'short',flightEndTime:.3,endsBeforePlate:true},{...p,id:'invalid',validTrajectory:false}];
 const before=JSON.stringify(pool),deck=scope.StudioSelection.makeDeck(pool,()=>0),ids=Array.from({length:9},()=>deck.next().id);
 for(let i=0;i<9;i+=3)assert.deepEqual(new Set(ids.slice(i,i+3)),new Set(['one','outside','short']));
 for(let i=1;i<ids.length;i++)assert.notEqual(ids[i],ids[i-1]);assert.equal(JSON.stringify(pool),before);
 assert.equal(scope.StudioSelection.makeDeck([]).next(),null);
 assert.equal(scope.StudioSelection.makeDeck([p]).next().id,'one');
});
test('random mode conceals the answer, reveals it only at the measured end and restores comparison settings',async()=>{
 const {scope,get,pitcher,setTime}=runtime();await scope.api.selectPitcher();const selected=JSON.stringify(scope.api.state().selected),target=JSON.stringify(scope.api.state().target);
 get('speed').value='.5';get('timingMode').value='near';get('loopPlayback').checked=true;
 scope.api.setRandomMode(true);assert.equal(scope.api.state().pitchId,undefined);assert.equal(get('slots').hidden,true);assert.equal(get('ordinaryTransport').hidden,true);assert.equal(get('metricsTab').disabled,true);
 scope.api.nextRandomPitch();assert.equal(scope.api.state().pitchId,'one');assert.equal(scope.api.state().settings.speed,'1');assert.equal(scope.api.state().settings.timing,'real');
 assert.equal(get('randomAnswer').textContent,'');assert.equal(get('randomResult').attributes['aria-hidden'],'true');assert.equal(get('pitchLegend').children.length,0);assert.equal(get('durationText').textContent,'');assert.equal(get('timeText').textContent,'');assert(!get('selectionLabel').textContent.includes('ストレート'));
 setTime(200);scope.api.tick(200);assert.equal(get('randomAnswer').textContent,'');assert.equal(scope.api.state().randomRevealed,false);
 setTime(400);scope.api.tick(400);assert.equal(scope.api.state().randomRevealed,true);assert.equal(get('randomResult').attributes['aria-hidden'],'false');assert.match(get('randomAnswer').textContent,/ストレート.*150.0/);assert.match(get('randomAnswer').textContent,/km\/h · ストライク$/);
 scope.api.replayFromStart();assert.equal(scope.api.state().pitchId,pitcher.pitches[0].id);assert.equal(scope.api.state().randomRevealed,false);assert.equal(get('randomAnswer').textContent,'');
 scope.api.setRandomMode(false);assert.equal(scope.api.state().playing,false);assert.equal(JSON.stringify(scope.api.state().selected),selected);assert.equal(JSON.stringify(scope.api.state().target),target);assert.equal(get('speed').value,'.5');assert.equal(get('timingMode').value,'near');assert.equal(get('loopPlayback').checked,true);assert.equal(get('slots').hidden,false);assert.equal(get('metricsTab').disabled,false);
});
test('continuous random playback waits for the answer, then draws another real delivery',async()=>{
 const {scope,get,pitcher,setTime}=runtime();pitcher.pitches.push({...pitcher.pitches[0],id:'outside',type:'Slider',plateSide:.6});await scope.api.selectPitcher();scope.api.setRandomMode(true);get('randomAuto').checked=true;scope.api.nextRandomPitch();const first=scope.api.state().pitchId;
 setTime(400);scope.api.tick(400);assert.equal(scope.api.state().randomRevealed,true);assert.equal(scope.api.state().playing,true);
 setTime(1899);scope.api.tick(1899);assert.equal(scope.api.state().pitchId,first);
 setTime(1900);scope.api.tick(1900);assert.notEqual(scope.api.state().pitchId,first);assert.equal(scope.api.state().randomRevealed,false);assert.equal(get('randomAnswer').textContent,'');assert.equal(scope.api.state().progress,0);
 setTime(2300);scope.api.tick(2300);assert.match(get('randomAnswer').textContent,/スライダー/);assert.match(get('randomAnswer').textContent,/km\/h · ボール$/);
});
test('changing pitcher clears the previous random delivery and answer',async()=>{
 const {scope,get,pitcher,setTime}=runtime();await scope.api.selectPitcher();scope.api.setRandomMode(true);scope.api.nextRandomPitch();setTime(400);scope.api.tick(400);
 const other={...pitcher,id:'other',name:'別投手',pitches:[{...pitcher.pitches[0],id:'other-pitch',velocity:140}],summary:[{type:'Fastball',n:1,trajectoryN:1,representativeId:'other-pitch'}]};scope.DATA.seasons[0].pitchers.push(other);get('pitcher').value='other';await scope.api.selectPitcher();
 assert.equal(scope.api.state().pitchId,undefined);assert.equal(scope.api.state().randomRevealed,false);assert.equal(get('randomAnswer').textContent,'');scope.api.nextRandomPitch();assert.equal(scope.api.state().pitchId,'other-pitch');assert.equal(scope.api.state().randomCount,1);
});
test('random flight warms one frame and advances time without rewriting the answer controls',async()=>{
 const {scope,get,draws,setTime}=runtime();await scope.api.selectPitcher();scope.api.setRandomMode(true);const before=draws.length;scope.api.nextRandomPitch();assert.equal(draws.length-before,1);
 const ids=['randomStatus','randomAnswer','randomCourse','selectionNote','pauseRandom'],writes=ids.map(id=>get(id).textWrites);
 for(let t=16;t<=384;t+=16){setTime(t);scope.api.tick(t);}
 assert(Math.abs(scope.api.state().progress-.96)<1e-12);assert.deepEqual(ids.map(id=>get(id).textWrites),writes);
 assert.equal(get('randomResult').hidden,false);assert.equal(get('randomResult').classList.contains('answer-hidden'),true);assert.equal(get('randomResult').attributes['aria-hidden'],'true');
 setTime(400);scope.api.tick(400);assert.equal(get('randomResult').hidden,false);assert.equal(get('randomResult').classList.contains('answer-hidden'),false);assert.match(get('randomAnswer').textContent,/150.0 km\/h · ストライク$/);
});
test('catcher review preserves the completed random pitch, stops auto advance and allows explicit replay',async()=>{
 const {scope,get,draws,setTime}=runtime();await scope.api.selectPitcher();scope.api.setRandomMode(true);scope.api.switchView('right');get('randomAuto').checked=true;scope.api.nextRandomPitch();const id=scope.api.state().pitchId;
 setTime(400);scope.api.tick(400);scope.api.switchView('catcher');const state=scope.api.state();assert.equal(state.view,'catcher');assert.equal(state.pitchId,id);assert.equal(state.progress,1);assert.equal(state.playing,false);assert.equal(state.randomRevealed,true);assert.equal(draws.at(-1).endpointReview,true);
 setTime(2100);scope.api.tick(2100);assert.equal(scope.api.state().pitchId,id);assert.equal(scope.api.state().progress,1);
 scope.api.replayFromStart();assert.equal(scope.api.state().pitchId,id);assert.equal(scope.api.state().progress,0);assert.equal(scope.api.state().playing,true);assert.equal(draws.at(-1).endpointReview,false);assert.equal(get('randomAnswer').textContent,'');
});
test('zone verdict uses the plotted reference zone and does not invent a home result for a short measurement',()=>{
 const {scope,pitcher}=runtime(),p=pitcher.pitches[0];assert.equal(scope.api.pitchZoneVerdict(p),'ストライク');assert.equal(scope.api.pitchZoneVerdict({...p,plateSide:.3}),'ボール');assert.equal(scope.api.pitchZoneVerdict({...p,endsBeforePlate:true,flightEndTime:.3}),'判定不可');assert.equal(scope.api.pitchZoneVerdict({...p,plateSide:NaN}),'判定不可');
});

test('fullscreen opens the trajectory viewer and exits without changing the completed pitch',async()=>{
 const {scope,get,setTime}=runtime();await scope.api.selectPitcher();scope.api.setRandomMode(true);scope.api.nextRandomPitch();setTime(400);scope.api.tick(400);const before=JSON.stringify(scope.api.state());
 let requested=null;get('viewer').requestFullscreen=async()=>{requested=get('viewer');scope.document.fullscreenElement=requested;};scope.document.documentElement={requestFullscreen:()=>assert.fail('must not fullscreen the entire document')};scope.document.exitFullscreen=async()=>{scope.document.fullscreenElement=null;};
 await scope.api.toggleFullscreen();assert.equal(requested,get('viewer'));assert.equal(JSON.stringify(scope.api.state()),before);await scope.api.toggleFullscreen();assert.equal(scope.document.fullscreenElement,null);assert.equal(JSON.stringify(scope.api.state()),before);
});

test('catcher position controls preserve independent batter settings and saved catcher position',()=>{
 const {scope,get,draws}=runtime();scope.api.adjustPosition({side:-.65,forward:-2.1});scope.api.updateEye({key:'height',min:50,max:230},110);
 assert.equal(get('eyeSideNumber').disabled,false);assert.equal(get('eyeSideNumber').min,-200);
 const saved=scope.api.state().settings;assert.equal(saved.catcherEye.side,-.65);assert.equal(saved.catcherEye.height,1.1);assert.equal(saved.eye.side,.34);
 scope.api.switchView('left');assert.equal(get('eyeSideNumber').min,0);scope.api.adjustPosition({side:.7,forward:.4});scope.api.switchView('catcher');
 assert.equal(scope.api.state().settings.catcherEye.forward,-2.1);assert.equal(draws.at(-1).catcherEye.side,-.65);assert.equal(scope.api.state().settings.eye.side,.7);
 scope.api.applySettings(saved);assert.equal(scope.api.state().settings.catcherEye.side,-.65);
});

// Stop at 278.5 ms, then wait one real second; pitch completion is at 400 ms.
test('practice gaze waits one real second from tracking stop, retaining endpoint and cancelling stale timers',()=>{
 const {scope,get,draws,setTime}=runtime();scope.api.applySettings({realism:true,view:'right'});scope.api.startPlayback();
 setTime(300);scope.api.tick(300);setTime(400);scope.api.tick(400);
 assert.equal(draws.at(-1).practiceGazeReady,false);assert.equal(draws.at(-1).progress,1);
 setTime(1278);assert.equal(draws.at(-1).practiceGazeReady,false);
 setTime(1279);assert.equal(draws.at(-1).practiceGazeReady,true);assert.equal(draws.at(-1).progress,1);
 scope.api.replayFromStart();setTime(1579);scope.api.tick(1579);scope.api.replayFromStart();
 setTime(2579);assert.equal(draws.at(-1).practiceGazeReady,false);
});
test('slow playback uses a real second and looping allows the hold to finish',()=>{
 const {scope,get,draws,setTime}=runtime();scope.api.applySettings({realism:true,view:'left'});get('speed').value='.5';get('loopPlayback').checked=true;scope.api.startPlayback();
 setTime(600);scope.api.tick(600);setTime(800);scope.api.tick(800);
 setTime(1556);scope.api.tick(1556);assert.equal(draws.at(-1).practiceGazeReady,false);assert.equal(draws.at(-1).progress,1);
 setTime(1557);assert.equal(draws.at(-1).practiceGazeReady,true);
 setTime(1657);scope.api.tick(1657);assert.equal(draws.at(-1).progress,0);assert.equal(draws.at(-1).practiceGazeReady,false);
});


test('random settings retain defaults, apply selected speed and paths across deliveries, and restore comparison',async()=>{
 const {scope,get,draws,setTime}=runtime();await scope.api.selectPitcher();
 get('speed').value='0.75';get('showPaths').checked=true;get('trail').checked=true;
 scope.api.setRandomMode(true);
 assert.equal(get('playbackSpeed').value,'1');assert.equal(get('showPaths').checked,false);assert.equal(get('trail').checked,false);
 for(const id of ['playbackSpeed','speed','timingMode','showPaths'])assert.equal(get(id).disabled,false,id);
 assert.equal(get('endSpeed').disabled,true);assert.equal(get('trail').disabled,true);
 get('playbackSpeed').value='0.5';get('playbackSpeed').onchange();
 get('showPaths').checked=true;get('showPaths').onchange();assert.equal(get('trail').disabled,false);
 get('trail').checked=true;get('trail').onchange();
 scope.api.nextRandomPitch();setTime(400);scope.api.tick(400);
 assert.equal(scope.api.state().progress,.5);assert.equal(scope.api.state().randomRevealed,false);
 assert.equal(draws.at(-1).realism,true);assert.equal(draws.at(-1).showPaths,true);assert.equal(draws.at(-1).trail,true);
 setTime(800);scope.api.tick(800);assert.equal(scope.api.state().randomRevealed,true);
 scope.api.replayFromStart();assert.equal(get('speed').value,'0.5');assert.equal(draws.at(-1).showPaths,true);
 scope.api.nextRandomPitch();assert.equal(get('playbackSpeed').value,'0.5');assert.equal(draws.at(-1).showPaths,true);
 scope.api.setRandomMode(false);assert.equal(get('playbackSpeed').value,'0.75');assert.equal(get('showPaths').checked,true);assert.equal(get('trail').checked,true);
 get('speed').value='0.25';get('speed').onchange();assert.equal(get('playbackSpeed').value,'0.25');
 scope.api.setRandomMode(true);assert.equal(get('playbackSpeed').value,'1');assert.equal(draws.at(-1).showPaths,false);
});

test('random near-home slowing changes the flight clock and survives continuous playback',async()=>{
 const {scope,get,setTime}=runtime();await scope.api.selectPitcher();scope.api.setRandomMode(true);
 get('timingMode').value='near';get('timingMode').onchange();assert.equal(get('endSpeed').disabled,false);
 get('endSpeed').value='0.25';get('endSpeed').onchange();get('randomAuto').checked=true;
 scope.api.nextRandomPitch();setTime(400);scope.api.tick(400);
 assert(scope.api.state().progress<1);assert.equal(scope.api.state().randomRevealed,false);
 setTime(2000);scope.api.tick(2000);assert.equal(scope.api.state().randomRevealed,true);
 setTime(3500);scope.api.tick(3500);assert.equal(scope.api.state().randomCount,2);
 assert.equal(get('timingMode').value,'near');assert.equal(get('endSpeed').value,'0.25');
});

test('random settings keep video and blind validation controls locked',async()=>{
 const {scope,get}=runtime();await scope.api.selectPitcher();scope.api.setRandomMode(true);
 get('showPaths').checked=true;get('showPaths').onchange();get('timingMode').value='near';get('timingMode').onchange();
 scope.StudioValidation={transportLocked:()=>true,isBlind:()=>true,renderOptions:()=>({showPaths:false}),afterRender(){},renderer:()=>null};scope.api.repaint();
 for(const id of ['playbackSpeed','speed','timingMode','endSpeed','showPaths','trail'])assert.equal(get(id).disabled,true,id);
 scope.StudioValidation.transportLocked=()=>false;scope.StudioValidation.isBlind=()=>false;scope.api.repaint();
 for(const id of ['playbackSpeed','speed','timingMode','endSpeed','showPaths','trail'])assert.equal(get(id).disabled,false,id);
});
