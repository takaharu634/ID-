'use strict';
const $=id=>document.getElementById(id);
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const catcherDefaults={height:.85,side:0,forward:-1.75};
const eyeDefaults={height:1.5,side:.34,forward:.25},DEFAULTS_VERSION=2;
const eyeFields=[{key:'height',id:'eyeHeight',min:50,max:230},{key:'forward',id:'eyeForward',min:-300,max:200},{key:'side',id:'eyeSide',min:0,max:200}];
const STORAGE='id-touto-studio-v1',FAVORITE='id-touto-studio-favorite-v1';
const seasons=Array.isArray(DATA.seasons)&&DATA.seasons.length?DATA.seasons:[{id:'2026-spring',label:'2026春',meta:DATA.meta||{},pitchers:DATA.pitchers||[]}];
const linkedSeason=window.StudioIntegration?.season;
let activeSeason=(linkedSeason?(seasons.find(s=>s.id===linkedSeason)||{id:linkedSeason,label:linkedSeason,meta:{},pitchers:[]}):null)||seasons.find(s=>s.id===DATA.defaultSeasonId)||seasons.find(s=>s.id==='2026-spring')||seasons[0];
const seasonPitchers=()=>activeSeason.pitchers||[];
const seasonLabel=()=>activeSeason.label||activeSeason.meta?.season||activeSeason.id;
let current,selected=[],view='catcher',progress=1,playing=false,lastTime=null,frame=null,playbackClock=0,loopUntil=null;
let catcherSettings={...catcherDefaults};
const activeEyes=()=>view==='catcher'?catcherSettings:eyeSettings;
const fieldLimits=f=>view==='catcher'?{min:f.key==='side'?-200:f.min,max:f.key==='forward'?-50:f.max}:f;
let eyeSettings={...eyeDefaults},zoom=9,realism=false,activePanel='view',panelOpen=false,positionPad=null,resizeObserver=null;
const effectiveZoom=()=>view==='catcher'?catcherLensForViewport($('trajectory').width/stageDpr,$('trajectory').height/stageDpr,{eye:[catcherSettings.side,catcherSettings.height,catcherSettings.forward]}).zoom:zoom;
const pathsVisible=()=>(!realism||randomMode)&&$('showPaths').checked;
let cachedTimeline=null,cachedTimelineKey='',hudKey='',stageDpr=1,metricsDirty=true;
let pitcherTarget=[0,1.8,16],calibratedWidth=null,lastDraw=null,diagnosticRun=null;
let projectionSettings={mode:'wide',width:6.5,distance:35},ballSizeAid=true,selectionRequest=0,loadingPitcher=false;
let randomMode=false,randomPitch=null,randomDeck=null,randomRevealed=false,randomCount=0,randomTiming=null;
let randomControlsKey='',transportControlsKey='',bootReadyKey='';
let gazeReturnTimer=null,gazeReturnAt=null,practiceGazeReady=true;
const projectionOptions=()=>({practiceGazeReady,pitcherTarget,projectionMode:projectionSettings.mode==='screen'&&calibratedWidth!==null?'screen':'wide',screenWidthCm:projectionSettings.width,viewDistanceCm:projectionSettings.distance,ballSizeAid});
const presets={standard:{...eyeDefaults},back:{height:1.4,side:.5,forward:-.7},near:{height:1.4,side:.2,forward:-.3}};
function readStored(key){try{return JSON.parse(localStorage.getItem(key)||'null');}catch{return null;}}
function writeStored(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
function validEyes(value){return value&&eyeFields.every(f=>Number.isFinite(value[f.key])&&value[f.key]*100>=f.min&&value[f.key]*100<=f.max);}
function snapshotSettings(){return {defaultsVersion:DEFAULTS_VERSION,eye:{...eyeSettings},catcherEye:{...catcherSettings},projection:{...projectionSettings},ballSizeAid,view,zoom,realism,showPaths:$('showPaths').checked,speed:$('speed').value,gaze:$('gazeMode').value,timing:$('timingMode').value,endSpeed:$('endSpeed').value,trail:$('trail').checked,loop:$('loopPlayback').checked};}
function applySettings(s){
 if(!s||typeof s!=='object')return false;
 if(s.catcherEye&&eyeFields.every(f=>Number.isFinite(s.catcherEye[f.key])&&s.catcherEye[f.key]*100>=(f.key==='side'?-200:f.min)&&s.catcherEye[f.key]*100<=(f.key==='forward'?-50:f.max)))catcherSettings={...s.catcherEye};
 if(validEyes(s.eye))eyeSettings=Object.fromEntries(eyeFields.map(f=>[f.key,Math.round(s.eye[f.key]*100)/100]));
 if(['catcher','right','left'].includes(s.view))view=s.view;
 if(Number.isFinite(s.zoom))zoom=clamp(s.zoom,1,10);
 if(s.projection&&['wide','screen'].includes(s.projection.mode)){projectionSettings.mode=s.projection.mode;if(Number.isFinite(s.projection.width))projectionSettings.width=clamp(s.projection.width,3,150);if(Number.isFinite(s.projection.distance))projectionSettings.distance=clamp(s.projection.distance,10,300);}
 if(typeof s.ballSizeAid==='boolean')ballSizeAid=s.ballSizeAid;
 for(const [id,key,values]of [['speed','speed',['.1','0.1','0.25','0.5','0.75','1']],['gazeMode','gaze',['release','selected','follow']],['timingMode','timing',['real','near']],['endSpeed','endSpeed',['0.25','0.5','0.75']]])if(values.includes(String(s[key])))$(id).value=String(s[key])==='.1'?'0.1':String(s[key]);
 if(typeof s.trail==='boolean')$('trail').checked=s.trail;
 if(typeof s.loop==='boolean')$('loopPlayback').checked=s.loop;
 realism=s.realism===true;$('showPaths').checked=typeof s.showPaths==='boolean'?s.showPaths:true;
 return true;
}
function persist(){writeStored(STORAGE,{...snapshotSettings(),...(randomTiming||{})});}
function setMessage(message){$('cameraStatus').textContent=message;}
function settingsSummary(){const eyeSettings=activeEyes(),f=eyeSettings.forward;return `視点 ${view==='catcher'?'捕手':view==='right'?'右打者':'左打者'} / 高さ ${eyeSettings.height.toFixed(2)}m / ホーム中心から左右 ${eyeSettings.side.toFixed(2)}m / 前縁から${f<0?'捕手側':'投手側'} ${Math.abs(f).toFixed(2)}m / 拡大${effectiveZoom().toFixed(2)}倍${view==='catcher'?'（自動）':''} / ${realism&&view!=='catcher'?'ボール追尾・終盤固定':$('gazeMode').value==='follow'?'ボール追尾（観察用）':'リリース固定'} / ${$('timingMode').value==='near'?`手前5mから減速・終盤${Math.round(Number($('endSpeed').value)*100)}％`:'実時間'} / 基本速度${$('speed').value}倍 / ${projectionSettings.mode==='screen'?`画面幅${projectionSettings.width}cm・視距離${projectionSettings.distance}cm`:'広角'} / ${realism?'実戦・サイズ補助なし':ballSizeAid?'球のサイズ補助あり':'球のサイズ補助なし'}`;}
function syncControls(){
 $('projectionMode').value=projectionSettings.mode;$('screenWidth').value=projectionSettings.width;$('viewDistance').value=projectionSettings.distance;
 $('screenCalibration').hidden=projectionSettings.mode!=='screen';$('projectionMode').disabled=view==='catcher';
 $('screenWidth').disabled=view==='catcher';$('viewDistance').disabled=view==='catcher';
 $('calibrateScreen').disabled=view==='catcher'||projectionSettings.mode!=='screen';
 $('ballSizeAid').checked=ballSizeAid;$('ballSizeAid').disabled=realism||projectionSettings.mode==='screen';
 const angle=2*Math.atan(projectionSettings.width/(2*projectionSettings.distance))*180/Math.PI;
 $('projectionNote').textContent=view==='catcher'?'捕手視点は、ゾーン全体が収まる倍率に自動調整します。':projectionSettings.mode==='screen'&&calibratedWidth===null?'映像の表示幅を実測し、「この表示幅で校正」を押してください。':projectionSettings.mode==='screen'?`画面幅と視距離から横画角 ${angle.toFixed(1)}° を計算。1倍で画面の角度を合わせます。近い球は画面外へ進むことがあります。`:'広角で投球全体を確認します。実際の目に映る大きさとは異なります。';
 $('viewer').classList.toggle('catcher-view',view==='catcher');
 $('realismToggle').classList.toggle('active',realism);$('realismToggle').setAttribute('aria-pressed',String(realism));$('realismToggle').title=realism?'軌道比較に戻す':'実戦モード：線と球種の色を消す';
 $('showPaths').disabled=realism&&!randomMode;$('trail').disabled=!pathsVisible();
 $('playbackSpeed').value=$('speed').value;
 for(const id of ['pitchLegend','distanceStats']){$(id).hidden=realism;$(id).classList.toggle('hidden',realism);}
 for(const f of eyeFields)for(const id of [f.id,f.id+'Number']){const limits=fieldLimits(f);$(id).min=limits.min;$(id).max=limits.max;$(id).value=Math.round(activeEyes()[f.key]*100);$(id).disabled=false;}
 $('gazeMode').disabled=view==='catcher'||realism;$('endSpeed').disabled=$('timingMode').value!=='near';
 $('zoom').disabled=view==='catcher'||projectionSettings.mode==='screen';$('zoom').min=view==='catcher'?'0.05':'1';$('zoom').value=effectiveZoom();$('zoomValue').textContent=effectiveZoom().toFixed(2)+'×'+(view==='catcher'?'（自動）':'');
 $('cameraHint').textContent='図をドラッグ、または数値を1cmずつ調整';
 $('cameraSummary').value=settingsSummary();
 $('loadFavorite').disabled=!readStored(FAVORITE);
 document.querySelectorAll('[data-view]').forEach(b=>{const active=b.dataset.view===view;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
 if(positionPad)positionPad.draw();
 syncRandomControls(true);
}
const chosen=()=>randomMode?(randomPitch?.validTrajectory?[randomPitch]:[]):selected.map(s=>s.enabled?current?.pitches.find(p=>p.id===s.id):null).filter(p=>p?.validTrajectory);
function randomLocked(){return loadingPitcher||!!window.StudioValidation?.transportLocked()||!!window.StudioValidation?.isBlind?.();}
const endpointReviewEnabled=()=>realism&&progress>=1&&!window.StudioValidation?.transportLocked()&&!window.StudioValidation?.isBlind?.();
function syncRandomControls(force=false){
 const locked=randomLocked(),blind=randomMode&&!randomRevealed;
 const key=[current?.id,realism,randomMode,randomPitch?.id,randomDeck?.size,randomRevealed,randomCount,playing,progress>=1,loopUntil!==null,locked,$('timingMode').value].join(';');
 if(!force&&key===randomControlsKey)return;randomControlsKey=key;
 for(const [id,hidden]of [['randomToggle',!realism],['randomControls',!randomMode],['ordinaryTransport',randomMode],['slots',randomMode]]){$(id).hidden=hidden;$(id).classList.toggle('hidden',hidden);}
 // Keep the answer's space throughout the delivery so the canvas never shrinks
 // when an answer appears, or grows after it is cleared for the next pitch.
 $('randomResult').classList.toggle('answer-hidden',blind);$('randomResult').setAttribute('aria-hidden',String(blind));
 $('viewer').classList.toggle('random-mode',randomMode);
 $('randomToggle').classList.toggle('active',randomMode);$('randomToggle').setAttribute('aria-pressed',String(randomMode));$('randomToggle').disabled=locked||!current?.pitches.some(p=>p.validTrajectory);
 $('nextRandom').disabled=locked||!randomDeck?.size;$('replayRandom').disabled=locked||!randomPitch;
 $('pauseRandom').disabled=locked||!randomPitch||(!playing&&progress>=1);
 $('pauseRandom').textContent=playing?'一時停止':'続きから再生';$('randomAuto').disabled=locked||!randomDeck?.size;
 $('randomStatus').textContent=!randomDeck?.size?'再現できる投球がありません。':!randomPitch?'「次の球を投げる」で開始。球種・球速は投球後に表示します。':loopUntil!==null?'次のランダム投球を待機中':playing?`${randomCount}球目 · 球種・球速は投球後に表示`:randomRevealed?`${randomCount}球目 · 着弾地点を確認できます`:`${randomCount}球目 · 一時停止`;
 $('viewHint').textContent=endpointReviewEnabled()?'視点を替えて着弾地点を確認':'選ぶと先頭から再生';
 $('selectionNote').textContent=randomMode?'選択した投手の実投球を、球種・コースを問わず1球ずつ選びます。比較用のA〜Eの選択は保存されています。':'最初はAのストレートだけ表示します。B〜Eも実投球を自動で選んであります。チェックすると追加表示できます。ストレート未収録時は別の球種をAに選びます。';
 if(randomRevealed&&randomPitch){
  const p=randomPitch,verdict=pitchZoneVerdict(p);
  $('randomAnswer').textContent=pitchStyle(p.type)[1]+' · '+(Number.isFinite(p.velocity)?p.velocity.toFixed(1)+' km/h':'球速未記録')+' · '+verdict;
  $('randomCourse').textContent=`${p.date} ${p.inning}回 #${p.pitchNo}${verdict==='判定不可'?' · ホーム到達位置は未測定':''}`;
 }else{$('randomAnswer').textContent='';$('randomCourse').textContent='';}
 $('metricsTab').disabled=locked||randomMode;$('saveMetrics').disabled=locked||randomMode;$('saveTrajectory').disabled=locked||blind;
 $('realismToggle').disabled=locked;
 $('timingMode').disabled=locked;$('endSpeed').disabled=locked||$('timingMode').value!=='near';
 $('speed').disabled=locked;$('playbackSpeed').disabled=locked;
 $('showPaths').disabled=locked||(realism&&!randomMode);$('trail').disabled=locked||!pathsVisible();
}
function syncTransportControls(ps){
 const videoLocked=!!window.StudioValidation?.transportLocked(),key=[current?.id,ps.map(p=>p.id).join('|'),videoLocked,randomMode,randomRevealed,loadingPitcher].join(';');
 if(key===transportControlsKey)return;transportControlsKey=key;
 for(const id of ['play','reset','stepBack','stepForward','scrub'])$(id).disabled=!ps.length||videoLocked;
 for(const id of ['speed','season','team','pitcher','metricsTab','saveTrajectory','saveMetrics','resetSession','loopPlayback'])$(id).disabled=videoLocked;
 document.querySelectorAll('[data-view]').forEach(b=>b.disabled=videoLocked);
 document.querySelectorAll('#slots input,#slots select').forEach(el=>{if(videoLocked){if(el.dataset.videoDisabled===undefined)el.dataset.videoDisabled=String(el.disabled);el.disabled=true;}else if(el.dataset.videoDisabled!==undefined){el.disabled=el.dataset.videoDisabled==='true';delete el.dataset.videoDisabled;}});
 syncRandomControls(true);
}
function setRandomMode(enabled){
 if(enabled&&randomLocked())return;
 if(enabled&&!current?.pitches.some(p=>p.validTrajectory)){setMessage('この投手には再現できる投球がありません。');return;}
 stop();
 if(enabled&&!randomMode){
  randomTiming={speed:$('speed').value,timing:$('timingMode').value,endSpeed:$('endSpeed').value,loop:$('loopPlayback').checked,showPaths:$('showPaths').checked,trail:$('trail').checked};
  randomMode=true;realism=true;randomDeck=window.StudioSelection.makeDeck(current.pitches);randomPitch=null;randomRevealed=false;randomCount=0;progress=0;
  $('speed').value='1';$('timingMode').value='real';$('loopPlayback').checked=false;$('randomAuto').checked=false;$('showPaths').checked=false;$('trail').checked=false;
  setTab('trajectory');
 }else if(!enabled){
  randomMode=false;randomPitch=null;randomDeck=null;randomRevealed=false;randomCount=0;
  if(randomTiming){$('speed').value=randomTiming.speed;$('timingMode').value=randomTiming.timing;$('endSpeed').value=randomTiming.endSpeed;$('loopPlayback').checked=randomTiming.loop;$('showPaths').checked=randomTiming.showPaths;$('trail').checked=randomTiming.trail;}
  randomTiming=null;progress=1;
 }
 cachedTimeline=null;hudKey='';syncControls();refreshHud();repaint();persist();
 setMessage(enabled?'ランダムモード：初期設定は実時間・1倍です。「再生設定」で速度と軌道線を変更できます。':'比較用の投球選択に戻しました。');
}
function nextRandomPitch(){
 if(!randomMode||randomLocked())return;
 stop();const p=randomDeck?.next();if(!p)return;
 randomPitch=p;randomRevealed=false;randomCount++;progress=0;cachedTimeline=null;hudKey='';startPlayback();
}
const maxTime=()=>Math.max(.01,...chosen().map(p=>p.flightEndTime??p.time));
function getTimeline(){const ps=chosen(),key=activeSeason.id+';'+ps.map(p=>p.id).join('|')+';'+$('timingMode').value+';'+$('endSpeed').value;if(!cachedTimeline||key!==cachedTimelineKey){cachedTimelineKey=key;cachedTimeline=makePlaybackTimeline(ps,{mode:$('timingMode').value,endSpeed:Number($('endSpeed').value),startDistance:5});}return cachedTimeline;}
function refreshHud(){
 if(!current)return;
 const ps=chosen(),key=activeSeason.id+';'+current.id+';'+ps.map(p=>p.id).join('|')+';'+randomMode+';'+randomRevealed;
 if(key!==hudKey){
  hudKey=key;$('stageTitle').textContent=current.name;$('stageSubtitle').textContent=current.team+' · '+seasonLabel();
  $('stageEyebrow').textContent=seasonLabel()+' · TRACKMAN';
  $('selectionLabel').textContent=randomMode?'ランダムモード · 1球ずつ表示':ps.length?ps.map(p=>pitchStyle(p.type)[1]).join(' / '):'投球を選択';
  $('pitchLegend').replaceChildren();
  for(const p of (randomMode?[]:ps)){const item=document.createElement('span');item.className='legendItem';item.style.setProperty('--pitch-color',pitchStyle(p.type)[2]);const dot=document.createElement('span');dot.className='legendDot';const name=document.createElement('span');name.textContent=pitchStyle(p.type)[0];const speed=document.createElement('span');speed.className='legendSpeed';speed.textContent=(Number.isFinite(p.velocity)?p.velocity.toFixed(1):'—')+' km/h · '+pitchZoneVerdict(p);item.append(dot,name,speed);item.title=pitchStyle(p.type)[1]+' '+pitchLabel(p);$('pitchLegend').append(item);}
  $('distanceStats').replaceChildren();
  const label=document.createElement('span');label.className='distanceTitle';label.textContent=ps.length>=2?pitchStyle(ps[0].type)[0]+' × '+pitchStyle(ps[1].type)[0]+' 軌道差':'2球以上で軌道差を表示';$('distanceStats').append(label);
  if(ps.length>=2)for(const d of [15,10,5,0]){const item=document.createElement('span');item.className='distanceCell';const name=document.createElement('small');name.textContent=d===0?'ホーム':d+'m前';const n=document.createElement('b'),diff=pitchSeparation(ps[0],ps[1],d);n.textContent=diff===null?'—':diff.toFixed(1)+'cm';item.append(name,n);$('distanceStats').append(item);}
 }
 const near=$('timingMode').value==='near';
 $('playbackBadge').textContent=near?'観察用 · 終盤'+Math.round(Number($('endSpeed').value)*100)+'％':Number($('speed').value)===1?'実時間 · 1倍':'全体スロー · '+$('speed').value+'倍';
 $('playbackBadge').classList.toggle('observation',near||Number($('speed').value)!==1);
 $('timingNote').textContent=randomMode?(near?'手前5mから、設定したホーム付近の速度で減速します。':'設定した基本速度で1球ずつ再生します。'):near?'最初の球が手前5mに入った後、全球を共通の時計で減速します。実軌道は同じです。':'1倍ではCSVの実時間どおり。比較する球は同時にリリースします。';
 $('durationText').textContent=randomMode&&!randomRevealed?'':' / '+maxTime().toFixed(3)+' s';
 syncRandomControls();
}
function repaint(recordFrame=false,frameNow=null){
 if(!current)return;
 const started=performance.now(),ps=chosen(),result=(window.StudioValidation?.renderer()||drawTrajectory)($('trajectory'),current,ps,{view,progress,realism,endpointReview:endpointReviewEnabled(),showPaths:pathsVisible(),trail:$('trail').checked,batterEye:eyeSettings,catcherEye:catcherSettings,gazeMode:$('gazeMode').value,zoom:effectiveZoom(),...projectionOptions(),...window.StudioValidation?.renderOptions(),compact:true,pixelRatio:stageDpr});
 lastDraw=result;if(diagnosticRun&&(playing||recordFrame))diagnosticRun.record(result,frameNow??performance.now(),performance.now()-started,document.hidden);
 window.StudioValidation?.afterRender(result);
 const hasTrajectory=current.pitches.some(p=>p.validTrajectory);
 const emptyHidden=ps.length>0||randomMode&&hasTrajectory,emptyText=hasTrajectory?'「比較する球」で投球を選択してください':'この投手は軌道係数が未収録です。「投球データ」で数値を確認できます。';
 if($('trajectoryEmpty').hidden!==emptyHidden)$('trajectoryEmpty').hidden=emptyHidden;if($('trajectoryEmpty').textContent!==emptyText)$('trajectoryEmpty').textContent=emptyText;
 syncTransportControls(ps);
 if(!randomMode){$('timeText').textContent=(progress*maxTime()).toFixed(3)+' s';$('scrub').value=Math.round(progress*1000);$('scrub').style.setProperty('--progress',Math.round(progress*100)+'%');}else if($('timeText').textContent!=='')$('timeText').textContent='';
 const status=loopUntil!==null?'次の投球を待機':playing?'再生中':progress===0?'リリース':progress>=1?(realism?'着弾地点':'終着点'):'一時停止';if($('frameStatus').textContent!==status)$('frameStatus').textContent=status;
 const hideFollow=!(!realism&&view!=='catcher'&&$('gazeMode').value==='release'&&result?.offscreenCount>0&&ps.length>0&&progress>.05);if($('followHint').hidden!==hideFollow)$('followHint').hidden=hideFollow;
 $('followHint').classList.toggle('hidden',$('followHint').hidden);
 const followText='画面外 '+(result?.offscreenCount||0)+'球 · ボールを追う';if($('followHint').textContent!==followText)$('followHint').textContent=followText;
 syncRandomControls();
 const readyKey=activeSeason.id+'|'+current.id;if(!loadingPitcher&&window.StudioBoot&&bootReadyKey!==readyKey){bootReadyKey=readyKey;window.StudioBoot.ready();window.StudioIntegration?.ready(activeSeason.id);}
}
function resizeCanvas(shouldRepaint=true){
 const box=$('viewercanbox'),rect=box.getBoundingClientRect();
 if(rect.width<1||rect.height<1)return;
 stageDpr=clamp(Number(window.devicePixelRatio)||1,1,2);
 const w=Math.max(1,Math.round(rect.width*stageDpr)),h=Math.max(1,Math.round(rect.height*stageDpr)),canvas=$('trajectory');
 if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
 if(calibratedWidth!==null&&Math.abs(rect.width-calibratedWidth)>1){stop();calibratedWidth=null;setMessage('映像の表示幅が変わりました。画面幅を測り直して校正してください。');}
 box.classList.toggle('short-stage',rect.height<300);syncControls();if(shouldRepaint!==false)repaint();
}
function clearGazeReturn(ready=true){
 if(gazeReturnTimer!==null)clearTimeout(gazeReturnTimer);
 gazeReturnTimer=null;gazeReturnAt=null;practiceGazeReady=ready;
}
function scheduleGazeReturn(now,timeline){
 if(!realism||!['right','left'].includes(view)||gazeReturnAt!==null||practiceGazeReady)return;
 const stops=chosen().filter(p=>p.validTrajectory!==false).map(p=>pitchPracticeGaze(p,0).stopTime);
 if(!stops.length)return;
 const stopClock=timeline.toPlayback(Math.max(...stops));
 if(playbackClock<stopClock)return;
 // Recover the crossing time even when a frame spans the stopping point.
 gazeReturnAt=now-(playbackClock-stopClock)/Number($('speed').value)*1000+1000;
 const finish=()=>{gazeReturnTimer=null;practiceGazeReady=true;repaint();};
 if(gazeReturnAt<=now)finish();else gazeReturnTimer=setTimeout(finish,gazeReturnAt-now);
}
function stop(preserveGaze=false){if(!preserveGaze)clearGazeReturn();playing=false;lastTime=null;loopUntil=null;if(frame!==null)cancelAnimationFrame(frame);frame=null;$('play').textContent='再生';$('play').setAttribute('aria-label','再生');}
function startPlayback(){
 if(window.StudioValidation?.transportLocked()){setMessage('動画の同期再生は開発用パネルから操作してください。');return;}
 if(!chosen().length){setMessage('投球を1球以上選択してください');return;}
 if(randomMode)randomRevealed=false;refreshHud();
 clearGazeReturn(false);diagnosticRun=null;playing=true;loopUntil=null;$('play').textContent='一時停止';$('play').setAttribute('aria-label','一時停止');syncRandomControls();
 // Apply pending layout and canvas-size changes before the physical clock runs.
 if(randomMode)resizeCanvas(false);
 if(!playing)return;
 // Warm the background and seam geometry before starting the physical clock.
 repaint();getTimeline();diagnosticRun=window.createPitchDiagnostics?.({settings:snapshotSettings(),pitcherId:current.id,season:activeSeason.id});
 playbackClock=getTimeline().toPlayback(progress*maxTime());lastTime=performance.now();frame=requestAnimationFrame(tick);
}
function replayFromStart(){stop();if(randomMode)randomRevealed=false;progress=0;startPlayback();}
function tick(now){
 if(!playing)return;
 if(loopUntil!==null){if(now<loopUntil){lastTime=now;frame=requestAnimationFrame(tick);return;}if(randomMode){nextRandomPitch();return;}loopUntil=null;clearGazeReturn(false);progress=0;playbackClock=0;lastTime=now;repaint();frame=requestAnimationFrame(tick);return;}
 const timeline=getTimeline();if(lastTime!==null)playbackClock+=Math.max(0,now-lastTime)/1000*Number($('speed').value);lastTime=now;
 progress=Math.min(1,timeline.toPhysical(playbackClock)/maxTime());
 scheduleGazeReturn(now,timeline);
 if(playbackClock>=timeline.duration){progress=1;if(randomMode){randomRevealed=true;if($('randomAuto').checked)loopUntil=Math.max(now+1500,(gazeReturnAt??0)+100);else stop(true);refreshHud();}else if($('loopPlayback').checked&&chosen().length){loopUntil=Math.max(now+750,(gazeReturnAt??0)+100);}else stop(true);}
 repaint(true,now);if(playing)frame=requestAnimationFrame(tick);
}
function togglePlay(){if(playing){stop();repaint();return;}if(randomMode&&!randomPitch){nextRandomPitch();return;}if(progress>=1)progress=0;startPlayback();}
function step(seconds){if(window.StudioValidation?.transportLocked()||randomMode)return;stop();progress=clamp((progress*maxTime()+seconds)/maxTime(),0,1);repaint();}
function updateEye(field,value){
 if(value==='')return;const n=Number(value);if(!Number.isFinite(n))return;
 stop();activeEyes()[field.key]=clamp(Math.round(n),fieldLimits(field).min,fieldLimits(field).max)/100;syncControls();persist();repaint();
}
function adjustPosition(p){stop();const eyes=activeEyes();eyes.side=clamp(p.side,view==='catcher'?-2:0,2);eyes.forward=clamp(p.forward,-3,view==='catcher'?-.5:2);syncControls();persist();repaint();}
function switchView(next){
 const review=endpointReviewEnabled()&&chosen().length>0;
 stop();view=next;syncControls();persist();
 if(review){resizeCanvas();setMessage('同じ球の着弾地点を表示しています。「同じ球を再生」で投球を見直せます。');}else replayFromStart();
}
function option(value,text){const el=document.createElement('option');el.value=value;el.textContent=text;return el;}
function pitchLabel(p){return `${p.date} ${p.inning}回 #${p.pitchNo} · ${p.velocity?.toFixed(1)||'—'} km/h`;}
function populatePitchSelect(sel,type,value,allowMean=false){sel.replaceChildren();if(allowMean)sel.append(option('mean','球種別平均'));current.pitches.filter(p=>p.type===type&&(allowMean||p.validTrajectory)).forEach(p=>sel.append(option(p.id,pitchLabel(p))));if(value&&[...sel.options].some(o=>o.value===value))sel.value=value;}
function selectionChanged(){stop();progress=1;refreshHud();repaint();}
function isZonePitch(p){
 if(!p?.validTrajectory||p.endsBeforePlate||(p.flightEndTime??p.time)<p.time-1e-6)return false;
 const [x,y]=pitchPosition(p,p.time);
 return Number.isFinite(x)&&Number.isFinite(y)&&x>=-.216&&x<=.216&&y>=.50&&y<=1.10;
}
function pitchZoneVerdict(p){
 if(!p?.validTrajectory||p.endsBeforePlate||(p.flightEndTime??p.time)<p.time-1e-6)return '判定不可';
 const point=pitchPosition(p,p.time);if(!point.slice(0,2).every(Number.isFinite))return '判定不可';
 return isZonePitch(p)?'ストライク':'ボール';
}
function createSlots(){
 transportControlsKey='';
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
 stop();cachedTimeline=null;cachedTimelineKey='';hudKey='';transportControlsKey='';bootReadyKey='';
 randomPitch=null;randomDeck=null;randomRevealed=false;randomCount=0;
 syncRandomControls();
 const pitcher=seasonPitchers().find(p=>p.id===$('pitcher').value)||seasonPitchers()[0];
 if(pitcher&&!Array.isArray(pitcher.pitches)){
  current=null;selected=[];loadingPitcher=true;syncRandomControls();
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
 pitcherTarget=pitchReleaseTarget(current.pitches);
 $('pitcher').title=current.name;$('team').title=$('team').value||'全大学';
 $('saveTrajectory').disabled=false;$('saveMetrics').disabled=false;
 selected=window.StudioSelection.initialSlots(current,isZonePitch);
 if(randomMode)randomDeck=window.StudioSelection.makeDeck(current.pitches);
 createSlots();$('metricType').replaceChildren();current.summary.forEach(s=>$('metricType').append(option(s.type,`${pitchStyle(s.type)[1]} (${s.n}球)`)));
 $('metricType').value=current.summary.some(s=>s.type==='Fastball')?'Fastball':current.summary[0]?.type||'';populatePitchSelect($('metricPitch'),$('metricType').value,'mean',true);
 $('metricType').disabled=!current.summary.length;$('metricPitch').disabled=!current.summary.length;
 $('pitcherCoverage').textContent=`${current.n.toLocaleString()}球 · 軌道${current.trajectoryN.toLocaleString()}球`;progress=randomMode?0:1;metricsDirty=true;refreshHud();syncControls();resizeCanvas();repaint();
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
function setTab(tab){if(tab==='metrics'&&randomMode)return;stop();$('trajectorySection').classList.toggle('hidden',tab!=='trajectory');$('metricsSection').classList.toggle('hidden',tab!=='metrics');$('trajectoryTab').classList.toggle('active',tab==='trajectory');$('metricsTab').classList.toggle('active',tab==='metrics');$('trajectoryTab').setAttribute('aria-pressed',String(tab==='trajectory'));$('metricsTab').setAttribute('aria-pressed',String(tab==='metrics'));if(tab==='metrics')renderMetrics();else resizeCanvas();}
function openPanel(panel,open=true){
 activePanel=panel;panelOpen=open;document.body.classList.toggle('sidebar-open',open);
 document.querySelectorAll('[data-panel]').forEach(b=>{const active=b.dataset.panel===panel&&open;b.classList.toggle('active',active);b.setAttribute('aria-expanded',String(active));b.setAttribute('aria-pressed',String(active));});
 for(const key of ['view','playback','pitches']){const p=$('panel-'+key);p.hidden=key!==panel;p.classList.toggle('hidden',key!==panel);}
 $('studioSidebar').setAttribute('aria-hidden',String(!open));$('drawerToggle').setAttribute('aria-expanded',String(open));
 requestAnimationFrame(resizeCanvas);
}
function saveCanvas(canvas,suffix){if(!current||window.StudioValidation?.isBlind()||randomMode&&!randomRevealed)return;const filename=`${current.name.replaceAll(' ','')}_${seasonLabel()}_${suffix}.png`;canvas.toBlob(blob=>{if(!blob){setMessage('画像を保存できませんでした');return;}const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);},'image/png');}
function saveTrajectoryImage(){const canvas=document.createElement('canvas');canvas.width=1800;canvas.height=1120;drawTrajectory(canvas,current,chosen(),{view,progress,realism,endpointReview:endpointReviewEnabled(),showPaths:pathsVisible(),trail:$('trail').checked,batterEye:eyeSettings,catcherEye:catcherSettings,gazeMode:$('gazeMode').value,zoom:effectiveZoom(),...projectionOptions()});saveCanvas(canvas,realism?'実戦モード':'投球軌道');}
async function toggleFullscreen(){try{if(document.fullscreenElement){await document.exitFullscreen();}else if($('viewer').requestFullscreen){await $('viewer').requestFullscreen();}else{setMessage('このブラウザーでは全画面機能を利用できません');}}catch{setMessage('全画面に切り替えられませんでした。通常表示で操作できます。');}}
function openDataInfo(){const dialog=$('dataDialog');if(typeof dialog.showModal==='function')dialog.showModal();else{dialog.setAttribute('open','');dialog.classList.add('fallback-dialog');}}
function closeDataInfo(){const dialog=$('dataDialog');if(typeof dialog.close==='function')dialog.close();else dialog.removeAttribute('open');dialog.classList.remove('fallback-dialog');}
function resetSession(){stop();if(randomMode)setRandomMode(false);calibratedWidth=null;catcherSettings={...catcherDefaults};eyeSettings={...eyeDefaults};projectionSettings={mode:'wide',width:6.5,distance:35};ballSizeAid=true;zoom=9;realism=false;view='catcher';$('speed').value='1';$('gazeMode').value='release';$('timingMode').value='real';$('endSpeed').value='0.5';$('showPaths').checked=true;$('trail').checked=false;$('loopPlayback').checked=false;progress=1;syncControls();persist();refreshHud();resizeCanvas();repaint();setMessage('表示と再生設定を初期値に戻しました');}
seasons.forEach(s=>$('season').append(option(s.id,s.label||s.meta?.season||s.id)));$('season').value=activeSeason.id;
const first=seasonPitchers().find(p=>p.name.includes('子安'))||seasonPitchers()[0];
$('season').onchange=seasonChange;$('team').onchange=()=>teamChange();$('pitcher').onchange=selectPitcher;$('trajectoryTab').onclick=()=>setTab('trajectory');$('metricsTab').onclick=()=>setTab('metrics');
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
document.querySelectorAll('[data-panel]').forEach(b=>b.onclick=()=>openPanel(b.dataset.panel,!(panelOpen&&activePanel===b.dataset.panel)));
$('closeDrawer').onclick=()=>{openPanel(activePanel,false);$('drawerToggle').focus();};$('drawerToggle').onclick=()=>openPanel(activePanel,!panelOpen);
$('play').onclick=togglePlay;$('reset').onclick=()=>{stop();progress=0;repaint();};$('stepBack').onclick=()=>step(-.01);$('stepForward').onclick=()=>step(.01);
$('scrub').oninput=()=>{if(randomMode)return;stop();progress=Number($('scrub').value)/1000;repaint();};
$('loopPlayback').onchange=()=>{if(!$('loopPlayback').checked&&loopUntil!==null){stop();repaint();}persist();};
for(const id of ['speed','playbackSpeed','timingMode','endSpeed','gazeMode'])$(id).onchange=()=>{stop();if(id==='playbackSpeed')$('speed').value=$('playbackSpeed').value;syncControls();persist();refreshHud();repaint();};
$('trail').onchange=()=>{persist();repaint();};
$('realismToggle').onclick=()=>{stop();if(randomMode)setRandomMode(false);realism=!realism;syncControls();persist();resizeCanvas();setMessage(realism?'実戦モード：白いボールだけを表示します。「ランダム」で1球ずつ確認できます。':'軌道比較に戻しました');};
$('randomToggle').onclick=()=>setRandomMode(!randomMode);$('nextRandom').onclick=nextRandomPitch;$('replayRandom').onclick=replayFromStart;$('pauseRandom').onclick=togglePlay;
$('randomAuto').onchange=()=>{if(!$('randomAuto').checked&&loopUntil!==null){stop();repaint();}};
$('showPaths').onchange=()=>{if(realism&&!randomMode){syncControls();return;}stop();syncControls();persist();repaint();};
$('projectionMode').onchange=()=>{stop();projectionSettings.mode=$('projectionMode').value==='screen'?'screen':'wide';calibratedWidth=null;if(projectionSettings.mode==='screen'){zoom=1;ballSizeAid=false;}syncControls();persist();repaint();};
for(const [id,key,min,max]of [['screenWidth','width',3,150],['viewDistance','distance',10,300]])$(id).onchange=()=>{stop();calibratedWidth=null;projectionSettings[key]=clamp(Number($(id).value)||projectionSettings[key],min,max);syncControls();persist();repaint();};
$('ballSizeAid').onchange=()=>{if(realism){syncControls();return;}stop();ballSizeAid=$('ballSizeAid').checked;persist();repaint();};
for(const f of eyeFields){$(f.id).oninput=()=>updateEye(f,$(f.id).value);$(f.id+'Number').oninput=()=>{const n=Number($(f.id+'Number').value);if($(f.id+'Number').value!==''&&n>=fieldLimits(f).min&&n<=fieldLimits(f).max)updateEye(f,n);};$(f.id+'Number').onchange=()=>{$(f.id+'Number').value===''?syncControls():updateEye(f,$(f.id+'Number').value);};}
$('zoom').oninput=()=>{if(view==='catcher'){syncControls();return;}stop();zoom=clamp(Number($('zoom').value)||1,1,10);syncControls();persist();repaint();};
document.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>{if(!presets[b.dataset.preset])return;stop();if(view==='catcher'){const offsets={standard:0,back:-.5,near:.5};catcherSettings={...catcherDefaults,forward:catcherDefaults.forward+offsets[b.dataset.preset]};}else eyeSettings={...presets[b.dataset.preset]};syncControls();persist();repaint();});
$('resetEye').onclick=()=>{stop();if(view==='catcher')catcherSettings={...catcherDefaults};else eyeSettings={...eyeDefaults};syncControls();persist();repaint();setMessage('目の位置を初期値に戻しました');};
$('saveFavorite').onclick=()=>{const ok=writeStored(FAVORITE,snapshotSettings());syncControls();setMessage(ok?'この見え方を保存しました':'保存できませんでした。「設定をコピー」で控えられます。');};
$('loadFavorite').onclick=()=>{const saved=readStored(FAVORITE);if(!saved)return;stop();if(randomMode)setRandomMode(false);applySettings(saved);syncControls();persist();refreshHud();repaint();setMessage('保存した見え方を呼び出しました');};
$('copyEye').onclick=async()=>{const text=settingsSummary();$('cameraSummary').value=text;try{await navigator.clipboard.writeText(text);setMessage('設定をコピーしました。このチャットに貼り付けられます。');}catch{$('cameraSummary').focus();$('cameraSummary').select();setMessage('設定欄を選択しました。手動でコピーしてください。');}};
$('followHint').onclick=()=>{stop();$('gazeMode').value='follow';syncControls();persist();repaint();};
$('metricType').onchange=()=>{populatePitchSelect($('metricPitch'),$('metricType').value,'mean',true);renderMetrics();};$('metricPitch').onchange=renderMetrics;
$('saveTrajectory').onclick=saveTrajectoryImage;$('saveMetrics').onclick=()=>saveCanvas($('metrics'),'投球データ');$('fullscreen').onclick=toggleFullscreen;
$('showDataInfo').onclick=openDataInfo;$('closeDataInfo').onclick=closeDataInfo;$('resetSession').onclick=resetSession;
$('calibrateScreen').onclick=()=>{stop();zoom=1;ballSizeAid=false;calibratedWidth=$('viewercanbox').getBoundingClientRect().width;syncControls();persist();repaint();setMessage('現在の表示幅で校正しました。画面を回転・拡縮したら再校正してください。');};
window.StudioAdapter={getState:()=>({current,view,progress,realism,randomMode,settings:snapshotSettings(),result:lastDraw}),diagnostics:()=>diagnosticRun?.report(),renderOptions:()=>({view,progress,realism,endpointReview:endpointReviewEnabled(),showPaths:pathsVisible(),trail:$('trail').checked,batterEye:eyeSettings,catcherEye:catcherSettings,gazeMode:$('gazeMode').value,zoom:effectiveZoom(),...projectionOptions()}),repaint,stop,renderAt:t=>{progress=clamp(t/maxTime(),0,1);repaint();},configure:s=>{stop();if(randomMode)setRandomMode(false);applySettings(s);syncControls();refreshHud();repaint();},seek:t=>{stop();if(randomMode)return;progress=clamp(t/maxTime(),0,1);repaint();},selectOnly:p=>{stop();if(randomMode)setRandomMode(false);selected=[{id:p.id,type:p.type,enabled:true}];cachedTimeline=null;hudKey='';createSlots();refreshHud();},setRealism:()=>{stop();realism=true;syncControls();refreshHud();repaint();}};
document.addEventListener('keydown',event=>{
 if(event.defaultPrevented||window.StudioValidation?.isBlind()||window.StudioValidation?.transportLocked())return;
 if(event.key==='Escape'){if($('dataDialog').open)closeDataInfo();else openPanel(activePanel,false);return;}
 if(event.ctrlKey||event.metaKey||event.altKey||event.target?.isContentEditable||event.target?.closest?.('input,select,textarea,button,[role="application"]')||!$('metricsSection').classList.contains('hidden')||$('dataDialog').open)return;
 if(event.code==='Space'||event.key===' '){event.preventDefault();togglePlay();}
 else if(event.key==='ArrowLeft'){event.preventDefault();step(-.01);}else if(event.key==='ArrowRight'){event.preventDefault();step(.01);}
 else if(event.key.toLowerCase()==='r'){event.preventDefault();replayFromStart();}
 else if(event.key.toLowerCase()==='n'&&randomMode){event.preventDefault();nextRandomPitch();}
 else if(['1','2','3'].includes(event.key)){event.preventDefault();switchView(['catcher','right','left'][Number(event.key)-1]);}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&playing){stop();repaint();}});
document.addEventListener('fullscreenchange',()=>{$('fullscreen').setAttribute('aria-label',document.fullscreenElement===$('viewer')?'全画面を終了':'全画面表示');$('fullscreen').title=document.fullscreenElement===$('viewer')?'全画面を終了':'全画面表示';resizeCanvas();});
window.addEventListener('resize',resizeCanvas);
updateSeasonInfo();
const restored=readStored(STORAGE);if(restored)applySettings(restored);
if(restored?.defaultsVersion!==DEFAULTS_VERSION){eyeSettings={...eyeDefaults};zoom=9;persist();}
syncControls();
function initializeStudio(){
 populateTeams(first?.team,first?.id);
 positionPad=createPositionPad($('positionPad'),{getSettings:activeEyes,getView:()=>view,onChange:adjustPosition,isDisabled:()=>false});
 if(typeof ResizeObserver==='function'){resizeObserver=new ResizeObserver(resizeCanvas);resizeObserver.observe($('viewercanbox'));}
 openPanel('view',window.innerWidth>800&&!(window.innerWidth<=1000&&window.innerHeight<=560));resizeCanvas();
}
initializeStudio();
if(document.fonts?.ready)document.fonts.ready.then(()=>{resizeCanvas();if(!$('metricsSection').classList.contains('hidden'))renderMetrics();}).catch(()=>{});
if(window.visualViewport)window.visualViewport.addEventListener('resize',resizeCanvas);
