'use strict';
const $=id=>document.getElementById(id);
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const eyeDefaults={height:1.5,side:.34,forward:.25},DEFAULTS_VERSION=2;
const eyeFields=[{key:'height',id:'eyeHeight',min:50,max:230},{key:'forward',id:'eyeForward',min:-300,max:200},{key:'side',id:'eyeSide',min:0,max:200}];
const STORAGE='id-touto-studio-v1',FAVORITE='id-touto-studio-favorite-v1';
const seasons=Array.isArray(DATA.seasons)&&DATA.seasons.length?DATA.seasons:[{id:'2026-spring',label:'2026春',meta:DATA.meta||{},pitchers:DATA.pitchers||[]}];
let activeSeason=seasons.find(s=>s.id===DATA.defaultSeasonId)||seasons.find(s=>s.id==='2026-spring')||seasons[0];
const seasonPitchers=()=>activeSeason.pitchers||[];
const seasonLabel=()=>activeSeason.label||activeSeason.meta?.season||activeSeason.id;
let current,selected=[],view='catcher',progress=1,playing=false,lastTime=null,frame=null,playbackClock=0,loopUntil=null;
let eyeSettings={...eyeDefaults},zoom=9,realism=false,activePanel='view',panelOpen=false,positionPad=null,resizeObserver=null;
const effectiveZoom=()=>view==='catcher'?catcherLensForViewport($('trajectory').width/stageDpr,$('trajectory').height/stageDpr).zoom:zoom;
const pathsVisible=()=>!realism&&$('showPaths').checked;
let cachedTimeline=null,cachedTimelineKey='',hudKey='',stageDpr=1,metricsDirty=true;
let projectionSettings={mode:'wide',width:6.5,distance:35},ballSizeAid=true,selectionRequest=0,loadingPitcher=false;
const projectionOptions=()=>({projectionMode:projectionSettings.mode,screenWidthCm:projectionSettings.width,viewDistanceCm:projectionSettings.distance,ballSizeAid});
const presets={standard:{...eyeDefaults},back:{height:1.4,side:.5,forward:-.7},near:{height:1.4,side:.2,forward:-.3}};
function readStored(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}}
function writeStored(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
function validEyes(value){return value&&eyeFields.every(f=>Number.isFinite(value[f.key])&&value[f.key]*100>=f.min&&value[f.key]*100<=f.max);}
function snapshotSettings(){return {defaultsVersion:DEFAULTS_VERSION,eye:{...eyeSettings},projection:{...projectionSettings},ballSizeAid,view,zoom,realism,showPaths:$('showPaths').checked,speed:$('speed').value,gaze:$('gazeMode').value,timing:$('timingMode').value,endSpeed:$('endSpeed').value,trail:$('trail').checked,loop:$('loopPlayback').checked};}
function applySettings(s){
 if(!s||typeof s!=='object')return false;
 if(validEyes(s.eye))eyeSettings=Object.fromEntries(eyeFields.map(f=>[f.key,Math.round(s.eye[f.key]*100)/100]));
 if(['catcher','right','left'].includes(s.view))view=s.view;
 if(Number.isFinite(s.zoom))zoom=clamp(s.zoom,1,10);
 if(s.projection&&['wide','screen'].includes(s.projection.mode)){projectionSettings.mode=s.projection.mode;if(Number.isFinite(s.projection.width))projectionSettings.width=clamp(s.projection.width,3,150);if(Number.isFinite(s.projection.distance))projectionSettings.distance=clamp(s.projection.distance,10,300);}
 if(typeof s.ballSizeAid==='boolean')ballSizeAid=s.ballSizeAid;
 for(const [id,key,values]of [['speed','speed',['.1','0.1','0.25','0.5','0.75','1']],['gazeMode','gaze',['release','follow']],['timingMode','timing',['real','near']],['endSpeed','endSpeed',['0.25','0.5','0.75']]])if(values.includes(String(s[key])))$(id).value=String(s[key])==='.1'?'0.1':String(s[key]);
 if(typeof s.trail==='boolean')$('trail').checked=s.trail;
 if(typeof s.loop==='boolean')$('loopPlayback').checked=s.loop;
 realism=s.realism===true;$('showPaths').checked=typeof s.showPaths==='boolean'?s.showPaths:true;
 return true;
}
function persist(){writeStored(STORAGE,snapshotSettings());}
function setMessage(message){$('cameraStatus').textContent=message;}
function settingsSummary(){const f=eyeSettings.forward;return `視点 ${view==='catcher'?'捕手':view==='right'?'右打者':'左打者'} / 高さ ${eyeSettings.height.toFixed(2)}m / ホーム中心から左右 ${eyeSettings.side.toFixed(2)}m / 前縁から${f<0?'捕手側':'投手側'} ${Math.abs(f).toFixed(2)}m / 拡大${effectiveZoom().toFixed(2)}倍${view==='catcher'?'（自動）':''} / ${$('gazeMode').value==='follow'?'ボール追尾（観察用）':'リリース固定'} / ${$('timingMode').value==='near'?`手前5mから減速・終盤${Math.round(Number($('endSpeed').value)*100)}％`:'実時間'} / 基本速度${$('speed').value}倍 / ${projectionSettings.mode==='screen'?`画面幅${projectionSettings.width}cm・視距離${projectionSettings.distance}cm`:'広角'} / ${realism?'実戦・サイズ補助なし':ballSizeAid?'球のサイズ補助あり':'球のサイズ補助なし'}`;}
function syncControls(){
 $('projectionMode').value=projectionSettings.mode;$('screenWidth').value=projectionSettings.width;$('viewDistance').value=projectionSettings.distance;
 $('screenCalibration').hidden=projectionSettings.mode!=='screen';$('projectionMode').disabled=view==='catcher';
 $('screenWidth').disabled=view==='catcher';$('viewDistance').disabled=view==='catcher';
 $('ballSizeAid').checked=ballSizeAid;$('ballSizeAid').disabled=realism;
 const angle=2*Math.atan(projectionSettings.width/(2*projectionSettings.distance))*180/Math.PI;
 $('projectionNote').textContent=view==='catcher'?'捕手視点は、ゾーン全体が収まる倍率に自動調整します。':projectionSettings.mode==='screen'?`画面幅と視距離から横画角 ${angle.toFixed(1)}° を計算。1倍で画面の角度を合わせます。近い球は画面外へ進むことがあります。`:'広角で投球全体を確認します。実際の目に映る大きさとは異なります。';
 $('viewer').classList.toggle('catcher-view',view==='catcher');
 $('realismToggle').classList.toggle('active',realism);$('realismToggle').setAttribute('aria-pressed',String(realism));$('realismToggle').title=realism?'軌道比較に戻す':'実戦モード：線と球種の色を消す';
 $('showPaths').disabled=realism;$('trail').disabled=!pathsVisible();
 for(const id of ['pitchLegend','distanceStats']){$(id).hidden=realism;$(id).classList.toggle('hidden',realism);}
 for(const f of eyeFields)for(const id of [f.id,f.id+'Number']){$(id).value=Math.round(eyeSettings[f.key]*100);$(id).disabled=view==='catcher';}
 $('gazeMode').disabled=view==='catcher';$('endSpeed').disabled=$('timingMode').value!=='near';
 $('zoom').disabled=view==='catcher';$('zoom').min=view==='catcher'?'0.05':'1';$('zoom').value=effectiveZoom();$('zoomValue').textContent=effectiveZoom().toFixed(2)+'×'+(view==='catcher'?'（自動）':'');
 $('cameraHint').textContent=view==='catcher'?'右打者・左打者を選ぶと立ち位置を調整できます':'図をドラッグ、または数値を1cmずつ調整';
 $('cameraSummary').value=settingsSummary();
 $('loadFavorite').disabled=!readStored(FAVORITE);
 document.querySelectorAll('[data-view]').forEach(b=>{const active=b.dataset.view===view;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
 if(positionPad)positionPad.draw();
}
const chosen=()=>selected.map(s=>s.enabled?current?.pitches.find(p=>p.id===s.id):null).filter(p=>p?.validTrajectory);
const maxTime=()=>Math.max(.01,...chosen().map(p=>p.flightEndTime??p.time));
function getTimeline(){const ps=chosen(),key=activeSeason.id+';'+ps.map(p=>p.id).join('|')+';'+$('timingMode').value+';'+$('endSpeed').value;if(!cachedTimeline||key!==cachedTimelineKey){cachedTimelineKey=key;cachedTimeline=makePlaybackTimeline(ps,{mode:$('timingMode').value,endSpeed:Number($('endSpeed').value),startDistance:5});}return cachedTimeline;}
function refreshHud(){
 if(!current)return;
 const ps=chosen(),key=activeSeason.id+';'+current.id+';'+ps.map(p=>p.id).join('|');
 if(key!==hudKey){
  hudKey=key;$('stageTitle').textContent=current.name;$('stageSubtitle').textContent=current.team+' · '+seasonLabel();
  $('stageEyebrow').textContent=seasonLabel()+' · TRACKMAN';
  $('selectionLabel').textContent=ps.length?ps.map(p=>pitchStyle(p.type)[1]).join(' / '):'投球を選択';
  $('pitchLegend').replaceChildren();
  for(const p of ps){const item=document.createElement('span');item.className='legendItem';item.style.setProperty('--pitch-color',pitchStyle(p.type)[2]);const dot=document.createElement('span');dot.className='legendDot';const name=document.createElement('span');name.textContent=pitchStyle(p.type)[0];const speed=document.createElement('span');speed.className='legendSpeed';speed.textContent=(Number.isFinite(p.velocity)?p.velocity.toFixed(1):'—')+' km/h';item.append(dot,name,speed);item.title=pitchStyle(p.type)[1]+' '+pitchLabel(p);$('pitchLegend').append(item);}
  $('distanceStats').replaceChildren();
  const label=document.createElement('span');label.className='distanceTitle';label.textContent=ps.length>=2?pitchStyle(ps[0].type)[0]+' × '+pitchStyle(ps[1].type)[0]+' 軌道差':'2球以上で軌道差を表示';$('distanceStats').append(label);
  if(ps.length>=2)for(const d of [15,10,5,0]){const item=document.createElement('span');item.className='distanceCell';const name=document.createElement('small');name.textContent=d===0?'ホーム':d+'m前';const n=document.createElement('b'),diff=pitchSeparation(ps[0],ps[1],d);n.textContent=diff===null?'—':diff.toFixed(1)+'cm';item.append(name,n);$('distanceStats').append(item);}
 }
 const near=$('timingMode').value==='near';
 $('playbackBadge').textContent=near?'観察用 · 終盤'+Math.round(Number($('endSpeed').value)*100)+'％':Number($('speed').value)===1?'実時間 · 1倍':'全体スロー · '+$('speed').value+'倍';
 $('playbackBadge').classList.toggle('observation',near||Number($('speed').value)!==1);
 $('timingNote').textContent=near?'最初の球が手前5mに入った後、全球を共通の時計で減速します。実軌道は同じです。':'1倍ではCSVの実時間どおり。比較する球は同時にリリースします。';
 $('durationText').textContent=' / '+maxTime().toFixed(3)+' s';
}
function repaint(){
 if(!current)return;
 const ps=chosen(),result=drawTrajectory($('trajectory'),current,ps,{view,progress,realism,showPaths:pathsVisible(),trail:$('trail').checked,batterEye:eyeSettings,gazeMode:$('gazeMode').value,zoom:effectiveZoom(),...projectionOptions(),compact:true,pixelRatio:stageDpr});
 const hasTrajectory=current.pitches.some(p=>p.validTrajectory);
 $('trajectoryEmpty').hidden=ps.length>0;
 $('trajectoryEmpty').textContent=hasTrajectory?(current.pitches.some(isZonePitch)?'「比較する球」で投球を選択してください':'ゾーン内に到達する軌道が未収録です。「比較する球」から投球を選択できます。'):'この投手は軌道係数が未収録です。「投球データ」で数値を確認できます。';
 for(const id of ['play','reset','stepBack','stepForward','scrub'])$(id).disabled=!ps.length;
 $('timeText').textContent=(progress*maxTime()).toFixed(3)+' s';$('scrub').value=Math.round(progress*1000);
 $('scrub').style.setProperty('--progress',Math.round(progress*100)+'%');
 $('frameStatus').textContent=loopUntil!==null?'次の投球を待機':playing?'再生中':progress===0?'リリース':progress>=1?'終着点':'一時停止';
 $('followHint').hidden=!(view!=='catcher'&&$('gazeMode').value==='release'&&result?.offscreenCount>0&&ps.length>0&&progress>.05);
 $('followHint').classList.toggle('hidden',$('followHint').hidden);
 $('followHint').textContent='画面外 '+(result?.offscreenCount||0)+'球 · ボールを追う';
 if(!loadingPitcher&&window.StudioBoot)window.StudioBoot.ready();
}
function resizeCanvas(){
 const box=$('viewercanbox'),rect=box.getBoundingClientRect();
 if(rect.width<1||rect.height<1)return;
 stageDpr=clamp(Number(window.devicePixelRatio)||1,1,2);
 const w=Math.max(1,Math.round(rect.width*stageDpr)),h=Math.max(1,Math.round(rect.height*stageDpr)),canvas=$('trajectory');
 if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
 box.classList.toggle('short-stage',rect.height<300);syncControls();repaint();
}
function stop(){playing=false;lastTime=null;loopUntil=null;if(frame!==null)cancelAnimationFrame(frame);frame=null;$('play').textContent='再生';$('play').setAttribute('aria-label','再生');}
function startPlayback(){
 if(!chosen().length){setMessage('投球を1球以上選択してください');return;}
 playbackClock=getTimeline().toPlayback(progress*maxTime());playing=true;lastTime=performance.now();loopUntil=null;$('play').textContent='一時停止';$('play').setAttribute('aria-label','一時停止');frame=requestAnimationFrame(tick);
}
function replayFromStart(){stop();progress=0;repaint();startPlayback();}
function tick(now){
 if(!playing)return;
 if(loopUntil!==null){if(now<loopUntil){lastTime=now;frame=requestAnimationFrame(tick);return;}loopUntil=null;progress=0;playbackClock=0;lastTime=now;repaint();frame=requestAnimationFrame(tick);return;}
 const timeline=getTimeline();if(lastTime!==null)playbackClock+=Math.max(0,now-lastTime)/1000*Number($('speed').value);lastTime=now;
 progress=Math.min(1,timeline.toPhysical(playbackClock)/maxTime());
 if(playbackClock>=timeline.duration){progress=1;if($('loopPlayback').checked&&chosen().length){loopUntil=now+750;}else stop();}
 repaint();if(playing)frame=requestAnimationFrame(tick);
}
function togglePlay(){if(playing){stop();repaint();return;}if(progress>=1)progress=0;startPlayback();}
function step(seconds){stop();progress=clamp((progress*maxTime()+seconds)/maxTime(),0,1);repaint();}
function updateEye(field,value){
 if(view==='catcher'||value==='')return;const n=Number(value);if(!Number.isFinite(n))return;
 stop();eyeSettings[field.key]=clamp(Math.round(n),field.min,field.max)/100;syncControls();persist();repaint();
}
function adjustPosition(p){if(view==='catcher')return;stop();eyeSettings.side=clamp(p.side,0,2);eyeSettings.forward=clamp(p.forward,-3,2);syncControls();persist();repaint();}
function switchView(next){view=next;syncControls();persist();replayFromStart();}
function option(value,text){const el=document.createElement('option');el.value=value;el.textContent=text;return el;}
function pitchLabel(p){return `${p.date} ${p.inning}回 #${p.pitchNo} · ${p.velocity?.toFixed(1)||'—'} km/h`;}
function populatePitchSelect(sel,type,value,allowMean=false){sel.replaceChildren();if(allowMean)sel.append(option('mean','球種別平均'));current.pitches.filter(p=>p.type===type&&(allowMean||p.validTrajectory)).forEach(p=>sel.append(option(p.id,pitchLabel(p))));if(value&&[...sel.options].some(o=>o.value===value))sel.value=value;}
function selectionChanged(){stop();progress=1;refreshHud();repaint();}
function isZonePitch(p){
 if(!p?.validTrajectory||p.endsBeforePlate||(p.flightEndTime??p.time)<p.time-1e-6)return false;
 const [x,y]=pitchPosition(p,p.time);
 return Number.isFinite(x)&&Number.isFinite(y)&&x>=-.216&&x<=.216&&y>=.50&&y<=1.10;
}
// Select existing deliveries only. Rank distinct-type groups by their spatial
// separation before the plate, without translating or changing any trajectory.
function chooseInitialPitches(pitcher,limit=3){
 const pool=pitcher.pitches.filter(isZonePitch),groups=new Map();
 for(let i=0;i<pool.length;i++){const p=pool[i];if(!groups.has(p.type))groups.set(p.type,[]);groups.get(p.type).push(i);}
 if(!pool.length)return [];
 const count=Math.min(limit,groups.size),anchorType=groups.has('Fastball')?'Fastball':[...groups].sort((a,b)=>b[1].length-a[1].length)[0][0],anchors=groups.get(anchorType);
 if(count===1){
  const representative=pitcher.summary.find(s=>s.type===anchorType)?.representativeId;
  const existing=anchors.find(i=>pool[i].id===representative);if(existing!==undefined)return [pool[existing]];
  const center=[0,1,2].map(k=>anchors.reduce((n,i)=>n+pitchPosition(pool[i],0)[k],0)/anchors.length);
  const pick=anchors.reduce((best,i)=>Math.hypot(...pitchPosition(pool[i],0).map((v,k)=>v-center[k]))<Math.hypot(...pitchPosition(pool[best],0).map((v,k)=>v-center[k]))?i:best,anchors[0]);return [pool[pick]];
 }
 const samples=pool.map(p=>({release:pitchPosition(p,0),home:pitchPosition(p,p.time),early:[15,12,10,8].map(d=>positionAtDistance(p,d))}));
 const n=pool.length,costs=new Float64Array(n*n);costs.fill(Infinity);
 const weights=[.30,.25,.25,.20];
 for(let i=0;i<n;i++)for(let j=0;j<i;j++){
  if(pool[i].type===pool[j].type)continue;
  const a=samples[i],b=samples[j];if(a.early.some(p=>!p)||b.early.some(p=>!p))continue;
  const early=Math.sqrt(a.early.reduce((sum,p,k)=>sum+weights[k]*((p[0]-b.early[k][0])**2+(p[1]-b.early[k][1])**2),0));
  const release=Math.hypot(...a.release.map((v,k)=>v-b.release[k])),late=Math.hypot(a.home[0]-b.home[0],a.home[1]-b.home[1]);
  costs[i*n+j]=costs[j*n+i]=early+.20*release+.50*Math.max(0,.15-late)+.10*Math.max(0,late-.45);
 }
 let best=[],bestScore=Infinity;
 for(const anchor of anchors){
  const candidates=[];
  for(const [type,indices]of groups)if(type!==anchorType)candidates.push(...indices.slice().sort((a,b)=>costs[anchor*n+a]-costs[anchor*n+b]).slice(0,count===2?1:5));
  if(count===2){for(const i of candidates){const score=costs[anchor*n+i];if(score<bestScore){bestScore=score;best=[anchor,i];}}}
  else for(let a=0;a<candidates.length;a++)for(let b=0;b<a;b++){
   const i=candidates[a],j=candidates[b];if(pool[i].type===pool[j].type)continue;
   const pair=[costs[anchor*n+i],costs[anchor*n+j],costs[i*n+j]],score=pair.reduce((s,c)=>s+c,0)/3+.35*Math.max(...pair);
   if(score<bestScore){bestScore=score;best=[anchor,j,i];}
  }
 }
 // Sparse/short trajectories can lack an early station. Keep a real zone ball
 // from each type in that case, without inventing a curve or an outside pitch.
 if(!best.length)best=[anchors[0],...[...groups].filter(([t])=>t!==anchorType).slice(0,count-1).map(([,ids])=>ids[0])];
 return best.map(i=>pool[i]);
}
function createSlots(){
 const host=$('slots');host.replaceChildren();selected.forEach((s,i)=>{
  const label='ABCDE'[i],box=document.createElement('div');box.className='slot';const on=document.createElement('input');on.type='checkbox';on.checked=s.enabled;on.setAttribute('aria-label',`投球${label}を表示`);
  const name=document.createElement('strong');name.textContent='投球 '+label;const type=document.createElement('select');type.setAttribute('aria-label',`投球${label}の球種`);
  type.append(option('','球種を選択（空き枠）'));current.summary.filter(a=>a.trajectoryN>0).forEach(a=>type.append(option(a.type,pitchStyle(a.type)[1])));type.value=s.type;
  const pitch=document.createElement('select');pitch.className='pitches';pitch.setAttribute('aria-label',`投球${label}の実投球`);
  const syncSlot=()=>{on.checked=s.enabled;on.disabled=!s.id;pitch.disabled=!s.type;box.classList.toggle('empty-slot',!s.type);if(s.type)populatePitchSelect(pitch,s.type,s.id);else pitch.replaceChildren(option('','球種を選ぶと投球を選べます'));};syncSlot();
  on.onchange=()=>{s.enabled=!!s.id&&on.checked;selectionChanged();};
  type.onchange=()=>{s.type=type.value;const ps=current.pitches.filter(p=>p.type===s.type&&p.validTrajectory),representative=current.summary.find(a=>a.type===s.type)?.representativeId;const p=ps.find(p=>p.id===representative&&isZonePitch(p))||ps.find(isZonePitch)||ps.find(p=>p.id===representative)||ps[0];s.id=p?.id||'';s.enabled=!!s.id;syncSlot();selectionChanged();};
  pitch.onchange=()=>{s.id=pitch.value;s.enabled=!!s.id;on.checked=s.enabled;on.disabled=!s.id;selectionChanged();};box.append(on,name,type,pitch);host.append(box);
 });
 if(!selected.length){const empty=document.createElement('p');empty.className='notice';empty.textContent='軌道を再現できる投球がありません。記録された数値は「投球データ」で確認できます。';host.append(empty);}
}
function renderMetrics(){if(!current)return;const id=$('metricPitch').value;drawMetrics($('metrics'),current,$('metricType').value,id==='mean'?null:current.pitches.find(p=>p.id===id));metricsDirty=false;}
async function selectPitcher(){
 const request=++selectionRequest,seasonId=activeSeason.id;
 stop();cachedTimeline=null;cachedTimelineKey='';hudKey='';
 const pitcher=seasonPitchers().find(p=>p.id===$('pitcher').value)||seasonPitchers()[0];
 if(pitcher&&!Array.isArray(pitcher.pitches)){
  current=null;selected=[];loadingPitcher=true;
  $('stageTitle').textContent=pitcher.name;$('stageSubtitle').textContent=pitcher.team+' · '+seasonLabel();
  for(const id of ['play','reset','stepBack','stepForward','scrub','saveTrajectory','saveMetrics','metricsTab'])$(id).disabled=true;
  if(window.StudioBoot)window.StudioBoot.loading(pitcher.name+'の投球を読み込んでいます');
  try{
   if(!pitcher.dataUrl)throw new Error('投球ファイルが見つかりません');
   const abort=typeof AbortController==='function'?new AbortController():null;
   const timeout=setTimeout(()=>abort?.abort(),20000);
   let payload;try{const response=await fetch(pitcher.dataUrl,abort?{signal:abort.signal}:{});if(!response.ok)throw new Error('投球の読み込みに失敗しました');payload=await response.json();}finally{clearTimeout(timeout);}
   if(payload.id!==pitcher.id||payload.seasonId!==seasonId||!Array.isArray(payload.pitches))throw new Error('投球データの形式が一致しません');
   pitcher.pitches=payload.pitches;
  }catch(error){if(request===selectionRequest){loadingPitcher=false;if(window.StudioBoot)window.StudioBoot.fail('投球データを読み込めませんでした。通信を確認して「再試行」を押してください。',()=>selectPitcher());}return;}
  if(request!==selectionRequest)return;
 }
 loadingPitcher=false;$('metricsTab').disabled=false;
 if(!pitcher){current=null;selected=[];$('slots').replaceChildren();$('metricType').replaceChildren();$('metricPitch').replaceChildren();$('pitcherCoverage').textContent='投手データなし';$('stageTitle').textContent='投手データなし';$('stageSubtitle').textContent=seasonLabel();$('stageEyebrow').textContent=seasonLabel()+' · TRACKMAN';$('trajectoryEmpty').hidden=false;$('trajectoryEmpty').textContent='このシーズンの投手データは未収録です。';$('trajectory').getContext('2d').clearRect(0,0,$('trajectory').width,$('trajectory').height);$('metrics').getContext('2d').clearRect(0,0,$('metrics').width,$('metrics').height);$('pitchLegend').replaceChildren();$('distanceStats').replaceChildren();for(const id of ['play','reset','stepBack','stepForward','scrub','saveTrajectory','saveMetrics'])$(id).disabled=true;return;}
 current={...pitcher,seasonId:activeSeason.id,seasonLabel:seasonLabel(),seasonMeta:activeSeason.meta||{}};
 $('pitcher').title=current.name;$('team').title=$('team').value||'全大学';
 $('saveTrajectory').disabled=false;$('saveMetrics').disabled=false;
 selected=chooseInitialPitches(current).map(p=>({type:p.type,id:p.id,enabled:true}));
 while(selected.length<5)selected.push({type:'',id:'',enabled:false});
 createSlots();$('metricType').replaceChildren();current.summary.forEach(s=>$('metricType').append(option(s.type,`${pitchStyle(s.type)[1]} (${s.n}球)`)));
 $('metricType').value=current.summary.some(s=>s.type==='Fastball')?'Fastball':current.summary[0]?.type||'';populatePitchSelect($('metricPitch'),$('metricType').value,'mean',true);
 $('metricType').disabled=!current.summary.length;$('metricPitch').disabled=!current.summary.length;
 $('pitcherCoverage').textContent=`${current.n.toLocaleString()}球 · 軌道${current.trajectoryN.toLocaleString()}球`;progress=1;metricsDirty=true;refreshHud();syncControls();resizeCanvas();repaint();
 if(!$('metricsSection').classList.contains('hidden'))renderMetrics();
}
function teamChange(defaultId){const list=seasonPitchers().filter(p=>!$('team').value||p.team===$('team').value);$('pitcher').replaceChildren();list.forEach(p=>$('pitcher').append(option(p.id,p.name)));if(defaultId&&list.some(p=>p.id===defaultId))$('pitcher').value=defaultId;$('pitcher').disabled=!list.length;selectPitcher();}
function updateSeasonInfo(){
 const meta=activeSeason.meta||{},counts=meta.counts||{},pitchers=seasonPitchers();
 $('season').title=seasonLabel();
 const rows=counts.rows??pitchers.reduce((n,p)=>n+p.n,0),usable=counts.usableTrajectories??pitchers.reduce((n,p)=>n+p.trajectoryN,0);
 $('coverage').textContent=`${pitchers.length}投手${Number.isFinite(counts.games)?' / '+counts.games+'試合':''}`;
 const exclusions=[];if(counts.missingTrajectory)exclusions.push(`係数不足${counts.missingTrajectory.toLocaleString()}球`);if(counts.rejectedEndpointError)exclusions.push(`到達位置の不整合${counts.rejectedEndpointError.toLocaleString()}球`);
 $('quality').textContent=`${seasonLabel()}：${rows.toLocaleString()}球中${usable.toLocaleString()}球を軌道再現に使用。${exclusions.length?exclusions.join('と')+'を除外。':''}`;
 $('dataSource').textContent='出典：'+(meta.source||meta.season||seasonLabel());
 $('dataLabelNote').textContent=(meta.pitchTypeNote||'球種名にはCSVの TaggedPitchType を用い、ID東都の個別球種補正は加えていません。')+(meta.nameNote||'選手名は添付の漢字対応表とシーズンデータの名前対応を用いています。');
}
function populateTeams(preferredTeam,preferredId){
 const list=seasonPitchers(),samePitcher=list.find(p=>p.id===preferredId),teams=[...new Set(list.map(p=>p.team))];
 $('team').replaceChildren(option('','全大学'));teams.forEach(t=>$('team').append(option(t,t)));
 $('team').value=samePitcher?.team||(teams.includes(preferredTeam)?preferredTeam:teams[0]||'');$('team').disabled=!teams.length;
 teamChange(samePitcher?.id);
}
function seasonChange(){
 const previousId=current?.id,previousTeam=$('team').value;stop();activeSeason=seasons.find(s=>s.id===$('season').value)||seasons[0];
 updateSeasonInfo();populateTeams(previousTeam,previousId);
 setMessage(seasonLabel()+'に切り替えました。視点と再生設定はそのまま使えます。');
}
function setTab(tab){stop();$('trajectorySection').classList.toggle('hidden',tab!=='trajectory');$('metricsSection').classList.toggle('hidden',tab!=='metrics');$('trajectoryTab').classList.toggle('active',tab==='trajectory');$('metricsTab').classList.toggle('active',tab==='metrics');$('trajectoryTab').setAttribute('aria-pressed',String(tab==='trajectory'));$('metricsTab').setAttribute('aria-pressed',String(tab==='metrics'));if(tab==='metrics')renderMetrics();else resizeCanvas();}
function openPanel(panel,open=true){
 activePanel=panel;panelOpen=open;document.body.classList.toggle('sidebar-open',open);
 document.querySelectorAll('[data-panel]').forEach(b=>{const active=b.dataset.panel===panel&&open;b.classList.toggle('active',active);b.setAttribute('aria-expanded',String(active));b.setAttribute('aria-pressed',String(active));});
 for(const key of ['view','playback','pitches']){const p=$('panel-'+key);p.hidden=key!==panel;p.classList.toggle('hidden',key!==panel);}
 $('studioSidebar').setAttribute('aria-hidden',String(!open));$('drawerToggle').setAttribute('aria-expanded',String(open));
 requestAnimationFrame(resizeCanvas);
}
function saveCanvas(canvas,suffix){if(!current)return;const filename=`${current.name.replaceAll(' ','')}_${seasonLabel()}_${suffix}.png`;canvas.toBlob(blob=>{if(!blob){setMessage('画像を保存できませんでした');return;}const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},'image/png');}
function saveTrajectoryImage(){const canvas=document.createElement('canvas');canvas.width=1800;canvas.height=1120;drawTrajectory(canvas,current,chosen(),{view,progress,realism,showPaths:pathsVisible(),trail:$('trail').checked,batterEye:eyeSettings,gazeMode:$('gazeMode').value,zoom:effectiveZoom(),...projectionOptions()});saveCanvas(canvas,realism?'実戦モード':'投球軌道');}
async function toggleFullscreen(){try{if(document.fullscreenElement){await document.exitFullscreen();}else if(document.documentElement.requestFullscreen){await document.documentElement.requestFullscreen();}else{setMessage('このブラウザーでは全画面機能を利用できません');}}catch{setMessage('全画面に切り替えられませんでした。通常表示で操作できます。');}}
function openDataInfo(){const dialog=$('dataDialog');if(typeof dialog.showModal==='function')dialog.showModal();else{dialog.setAttribute('open','');dialog.classList.add('fallback-dialog');}}
function closeDataInfo(){const dialog=$('dataDialog');if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');dialog.classList.remove('fallback-dialog');}
function resetSession(){stop();eyeSettings={...eyeDefaults};projectionSettings={mode:'wide',width:6.5,distance:35};ballSizeAid=true;zoom=9;realism=false;view='catcher';$('speed').value='1';$('gazeMode').value='release';$('timingMode').value='real';$('endSpeed').value='0.5';$('showPaths').checked=true;$('trail').checked=false;$('loopPlayback').checked=false;progress=1;syncControls();persist();refreshHud();resizeCanvas();repaint();setMessage('表示と再生設定を初期値に戻しました');}
seasons.forEach(s=>$('season').append(option(s.id,s.label||s.meta?.season||s.id)));$('season').value=activeSeason.id;
const first=seasonPitchers().find(p=>p.name.includes('子安'))||seasonPitchers()[0];
$('season').onchange=seasonChange;$('team').onchange=()=>teamChange();$('pitcher').onchange=selectPitcher;$('trajectoryTab').onclick=()=>setTab('trajectory');$('metricsTab').onclick=()=>setTab('metrics');
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
document.querySelectorAll('[data-panel]').forEach(b=>b.onclick=()=>openPanel(b.dataset.panel,!(panelOpen&&activePanel===b.dataset.panel)));
$('closeDrawer').onclick=()=>{openPanel(activePanel,false);$('drawerToggle').focus();};$('drawerToggle').onclick=()=>openPanel(activePanel,!panelOpen);
$('play').onclick=togglePlay;$('reset').onclick=()=>{stop();progress=0;repaint();};$('stepBack').onclick=()=>step(-.01);$('stepForward').onclick=()=>step(.01);
$('scrub').oninput=()=>{stop();progress=Number($('scrub').value)/1000;repaint();};
$('loopPlayback').onchange=()=>{if(!$('loopPlayback').checked&&loopUntil!==null){stop();repaint();}persist();};
for(const id of ['speed','timingMode','endSpeed','gazeMode'])$(id).onchange=()=>{stop();syncControls();persist();refreshHud();repaint();};
$('trail').onchange=()=>{persist();repaint();};
$('realismToggle').onclick=()=>{stop();realism=!realism;syncControls();persist();resizeCanvas();setMessage(realism?'実戦モード：白いボールだけを表示します':'軌道比較に戻しました');};
$('showPaths').onchange=()=>{if(realism){syncControls();return;}stop();syncControls();persist();repaint();};
$('projectionMode').onchange=()=>{stop();projectionSettings.mode=$('projectionMode').value==='screen'?'screen':'wide';syncControls();persist();repaint();};
for(const [id,key,min,max]of [['screenWidth','width',3,150],['viewDistance','distance',10,300]])$(id).onchange=()=>{stop();projectionSettings[key]=clamp(Number($(id).value)||projectionSettings[key],min,max);syncControls();persist();repaint();};
$('ballSizeAid').onchange=()=>{if(realism){syncControls();return;}stop();ballSizeAid=$('ballSizeAid').checked;persist();repaint();};
for(const f of eyeFields){$(f.id).oninput=()=>updateEye(f,$(f.id).value);$(f.id+'Number').oninput=()=>{const n=Number($(f.id+'Number').value);if($(f.id+'Number').value!==''&&n>=f.min&&n<=f.max)updateEye(f,n);};$(f.id+'Number').onchange=()=>{$(f.id+'Number').value===''?syncControls():updateEye(f,$(f.id+'Number').value);};}
$('zoom').oninput=()=>{if(view==='catcher'){syncControls();return;}stop();zoom=clamp(Number($('zoom').value)||1,1,10);syncControls();persist();repaint();};
document.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>{if(!presets[b.dataset.preset])return;stop();if(view==='catcher')view='right';eyeSettings={...presets[b.dataset.preset]};syncControls();persist();repaint();});
$('resetEye').onclick=()=>{stop();eyeSettings={...eyeDefaults};syncControls();persist();repaint();setMessage('目の位置を初期値に戻しました');};
$('saveFavorite').onclick=()=>{const ok=writeStored(FAVORITE,snapshotSettings());syncControls();setMessage(ok?'この見え方を保存しました':'保存できませんでした。「設定をコピー」で控えられます。');};
$('loadFavorite').onclick=()=>{const saved=readStored(FAVORITE);if(!saved)return;stop();applySettings(saved);syncControls();persist();refreshHud();repaint();setMessage('保存した見え方を呼び出しました');};
$('copyEye').onclick=async()=>{const text=settingsSummary();$('cameraSummary').value=text;try{await navigator.clipboard.writeText(text);setMessage('設定をコピーしました。このチャットに貼り付けられます。');}catch{$('cameraSummary').focus();$('cameraSummary').select();setMessage('設定欄を選択しました。手動でコピーしてください。');}};
$('followHint').onclick=()=>{stop();$('gazeMode').value='follow';syncControls();persist();repaint();};
$('metricType').onchange=()=>{populatePitchSelect($('metricPitch'),$('metricType').value,'mean',true);renderMetrics();};$('metricPitch').onchange=renderMetrics;
$('saveTrajectory').onclick=saveTrajectoryImage;$('saveMetrics').onclick=()=>saveCanvas($('metrics'),'投球データ');$('fullscreen').onclick=toggleFullscreen;
$('showDataInfo').onclick=openDataInfo;$('closeDataInfo').onclick=closeDataInfo;$('resetSession').onclick=resetSession;
document.addEventListener('keydown',event=>{
 if(event.defaultPrevented)return;
 if(event.key==='Escape'){if($('dataDialog').open)closeDataInfo();else openPanel(activePanel,false);return;}
 if(event.ctrlKey||event.metaKey||event.altKey||event.target?.isContentEditable||event.target?.closest?.('input,select,textarea,button,[role="application"]')||!$('metricsSection').classList.contains('hidden')||$('dataDialog').open)return;
 if(event.code==='Space'||event.key===' '){event.preventDefault();togglePlay();}
 else if(event.key==='ArrowLeft'){event.preventDefault();step(-.01);}else if(event.key==='ArrowRight'){event.preventDefault();step(.01);}
 else if(event.key.toLowerCase()==='r'){event.preventDefault();replayFromStart();}
 else if(['1','2','3'].includes(event.key)){event.preventDefault();switchView(['catcher','right','left'][Number(event.key)-1]);}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&playing){stop();repaint();}});
document.addEventListener('fullscreenchange',()=>{$('fullscreen').setAttribute('aria-label',document.fullscreenElement?'全画面を終了':'全画面表示');$('fullscreen').title=document.fullscreenElement?'全画面を終了':'全画面表示';resizeCanvas();});
window.addEventListener('resize',resizeCanvas);
updateSeasonInfo();
const restored=readStored(STORAGE);if(restored)applySettings(restored);
if(restored?.defaultsVersion!==DEFAULTS_VERSION){eyeSettings={...eyeDefaults};zoom=9;persist();}
syncControls();
function initializeStudio(){
 populateTeams(first?.team,first?.id);
 positionPad=createPositionPad($('positionPad'),{getSettings:()=>eyeSettings,getView:()=>view,onChange:adjustPosition,isDisabled:()=>view==='catcher'});
 if(typeof ResizeObserver==='function'){resizeObserver=new ResizeObserver(resizeCanvas);resizeObserver.observe($('viewercanbox'));}
 openPanel('view',window.innerWidth>800&&!(window.innerWidth<=1000&&window.innerHeight<=560));resizeCanvas();
}
initializeStudio();
if(document.fonts?.ready)document.fonts.ready.then(()=>{resizeCanvas();if(!$('metricsSection').classList.contains('hidden'))renderMetrics();}).catch(()=>{});
if(window.visualViewport)window.visualViewport.addEventListener('resize',resizeCanvas);
