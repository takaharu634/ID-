import * as THREE from './vendor/three.module.js';
import {validPitch,typeLabel,viewpoint,calibrateRig,PitchClock,clamp,pitchPosition,toXR} from './model.mjs';
import {chooseInitialPitches,isZonePitch} from './selection.mjs';
import {buildWorld} from './world.mjs';
import {VRPanel} from './vr-panel.mjs';
import {XRSessionFlow} from './xr-session.mjs';

const $=id=>document.getElementById(id),clock=new PitchClock();
let renderer,scene,camera,rig,world,panel,flow,catalog,season,current=null,selected=[],singleIndex=0,view='right',side=.34,forward=.25,compare=false,loading=false,requestId=0;
let needsCalibration=false,floorReference=true,xrTracked=false,drag=null,orbitYaw=0,orbitPitch=0,lastPanelState=0;
const cache=new Map(),controllers=[],headPos=new THREE.Vector3(),headQuat=new THREE.Quaternion(),gazeDirection=new THREE.Vector3();
const names={right:'右打者',left:'左打者',catcher:'捕手'};
const message=text=>{$('status').textContent=text;};
function option(value,label){const el=document.createElement('option');el.value=value;el.textContent=label;return el;}
function pitchText(p){return `${typeLabel(p.type)}  ${Number.isFinite(p.velocity)?p.velocity.toFixed(1):'—'} km/h  ·  ${p.date}  ${p.inning}回 #${p.pitchNo}`;}
function chosen(){const ps=selected.map(id=>current?.pitches.find(p=>p.id===id)).filter(validPitch);return compare?ps:ps.length?[ps[clamp(singleIndex,0,ps.length-1)]]:[];}
function renderSlots(){
  const host=$('slots');host.replaceChildren();
  for(let i=0;i<5;i++){
    const slot=document.createElement('div');slot.className='slot';const label=document.createElement('span');label.textContent='ABCDE'[i];
    const type=document.createElement('select'),pitch=document.createElement('select');type.setAttribute('aria-label',`投球${label.textContent}の球種`);pitch.setAttribute('aria-label',`投球${label.textContent}の実投球`);
    type.append(option('','球種を選択（空き枠）'));const ps=(current?.pitches||[]).filter(validPitch),p=ps.find(p=>p.id===selected[i]);
    for(const t of [...new Set(ps.map(p=>p.type))])type.append(option(t,typeLabel(t)));type.value=p?.type||'';
    const fill=()=>{pitch.replaceChildren();for(const p of ps.filter(p=>p.type===type.value))pitch.append(option(p.id,`${isZonePitch(p)?'● ':''}${pitchText(p)}`));pitch.disabled=!type.value;};
    fill();if(p)pitch.value=p.id;
    type.onchange=()=>{fill();const pool=ps.filter(p=>p.type===type.value),first=pool.find(isZonePitch)||pool[0];selected[i]=first?.id||null;if(first)pitch.value=first.id;singleIndex=Math.max(0,selected.filter(Boolean).findIndex(id=>id===selected[i]));selectionChanged();};
    pitch.onchange=()=>{selected[i]=pitch.value;singleIndex=Math.max(0,selected.filter(Boolean).findIndex(id=>id===pitch.value));selectionChanged();};
    slot.append(label,type,pitch);host.append(slot);
  }
}
function selectionChanged(){clock.setPitches(chosen());world.setPitches(chosen());updateInfo();setDesktopCamera();sync();}
function updateInfo(){
  const ps=chosen();$('pitcherName').textContent=current?.name||'投球を選択';
  $('pitchInfo').textContent=ps.length?(compare?`${ps.length}球を比較 · `:'')+ps.map(p=>`${typeLabel(p.type)} ${Number.isFinite(p.velocity)?p.velocity.toFixed(1):'—'} km/h`).join(' / '):'「投球・立ち位置」から球を選択してください';
  if(season)$('dataInfo').textContent=`収録：${season.label} / ${season.meta?.lastDate||'—'}まで / ${Number(season.meta?.counts?.rows||0).toLocaleString()}球`;
}
function sync(){
  const available=chosen().length>0&&!loading;
  for(const id of ['replay','pause','scrub'])$(id).disabled=!available;
  $('pause').textContent=clock.playing?'一時停止':'再開';$('compare').checked=compare;
  $('paths').checked=world.paths.visible;$('zone').checked=world.zone.visible;$('loop').checked=clock.loop;
  $('side').value=Math.round(side*100);$('forward').value=Math.round(forward*100);$('side').disabled=view==='catcher';$('forward').disabled=view==='catcher';
  $('sideValue').textContent=`${Math.round(side*100)}cm`;$('forwardValue').textContent=`${forward<0?'捕手側':'投手側'}${Math.round(Math.abs(forward)*100)}cm`;
  $('viewBadge').textContent=names[view];$('speedBadge').textContent=clock.speed===1?'実時間 1×':`スロー ${clock.speed}×`;$('speed').value=String(clock.speed);
  document.querySelectorAll('[data-view]').forEach(b=>{const active=b.dataset.view===view;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
  if(flow){$('enterVR').disabled=flow.state!=='idle'||!flow.supported||loading||!available;}
  updatePanel();
}
function updatePanel(){
  if(!panel)return;const ps=chosen(),seconds=clock.countdownUntil===null?0:clock.countdownUntil<0?3:Math.max(1,Math.ceil((clock.countdownUntil-performance.now())/1000));panel.setState({pitcher:current?`${current.name} · ${current.team} · ${season.label}`:loading?'読み込み中':'投球を選択',pitch:ps.map(p=>`${typeLabel(p.type)} ${p.velocity?.toFixed(1)||'—'} km/h`).join(' / '),detail:`${names[view]} / 左右${Math.round(side*100)}cm / 前縁から${forward<0?'捕手':'投手'}側${Math.round(Math.abs(forward)*100)}cm / ${floorReference?'装着した目の高さ':'床取得なし・高さ1.50m基準'}`,playing:clock.playing,compare,speed:clock.speed,paths:world.paths.visible,zone:world.zone.visible,loop:clock.loop,status:loading?'データを読み込み中':seconds?`リリースまで ${seconds} 秒。投手方向をご覧ください。`:clock.playing?'再生中':clock.time>=clock.duration?'終着点':'準備ができたら「最初から再生」を選択'});
}
function populateTeams(preferred){
  const teams=[...new Set(season.pitchers.map(p=>p.team))];$('team').replaceChildren(...teams.map(t=>option(t,t)));if(teams.includes(preferred))$('team').value=preferred;populatePitchers();
}
function populatePitchers(preferred){
  const pitchers=season.pitchers.filter(p=>p.team===$('team').value);$('pitcher').replaceChildren(...pitchers.map(p=>option(p.id,p.name)));if(pitchers.some(p=>p.id===preferred))$('pitcher').value=preferred;
}
async function loadPitcher(){
  const ticket=++requestId,meta=season.pitchers.find(p=>p.id===$('pitcher').value),seasonId=season.id;
  clock.pause();loading=true;current=null;selected=[];world.setPitches([]);$('loading').hidden=false;$('errorBox').hidden=true;sync();updateInfo();
  if(!meta){loading=false;$('loading').hidden=true;message('この条件の投手は未収録です');sync();return;}
  try{
    let data=cache.get(meta.dataUrl);
    if(!data){const response=await fetch(meta.dataUrl);if(!response.ok)throw new Error('データ取得');data=await response.json();if(data.id!==meta.id||data.seasonId!==seasonId||!Array.isArray(data.pitches))throw new Error('データ不一致');cache.set(meta.dataUrl,data);if(cache.size>8)cache.delete(cache.keys().next().value);}
    if(ticket!==requestId)return;
    const pitches=data.pitches.filter(validPitch);current={...meta,pitches,summary:[...new Set(pitches.map(p=>p.type))].map(type=>({type}))};
    selected=chooseInitialPitches(current).map(p=>p.id);while(selected.length<5)selected.push(null);singleIndex=0;loading=false;$('loading').hidden=true;
    renderSlots();selectionChanged();message(selected.some(Boolean)?'再生できます。VR内では実寸表示になります。':'ゾーン内の球がありません。「投球・立ち位置」で選択してください。');
    const url=new URL(location.href);url.searchParams.set('season',season.id);url.searchParams.set('pitcher',meta.id);history.replaceState(null,'',url);
  }catch(error){if(ticket!==requestId)return;loading=false;$('loading').hidden=true;$('errorBox').hidden=false;$('errorText').textContent='投球データを読み込めませんでした。通信を確認して再読み込みしてください。';message('読み込みに失敗しました');renderSlots();sync();}
}
function setDesktopCamera(){
  if(renderer.xr.isPresenting)return;
  rig.position.set(0,0,0);rig.rotation.set(0,0,0);camera.position.fromArray(viewpoint(view,side,forward));
  if(view==='catcher')camera.position.y=.95;
  const ps=chosen(),target=ps.length?toXR(pitchPosition(ps[0],0)):[0,1.8,-16];camera.lookAt(...target);
  if(orbitYaw||orbitPitch){camera.rotateY(orbitYaw);camera.rotateX(orbitPitch);}
  camera.fov=view==='catcher'?58:70;camera.updateProjectionMatrix();
}
function changeView(next){view=next;orbitYaw=orbitPitch=0;clock.pause();if(renderer.xr.isPresenting)needsCalibration=true;else setDesktopCamera();sync();}
function relocate(){clock.pause();if(renderer.xr.isPresenting)needsCalibration=true;else setDesktopCamera();sync();}
function placePanel(){if(!renderer.xr.isPresenting)return;const cam=renderer.xr.getCamera();cam.getWorldPosition(headPos);cam.getWorldQuaternion(headQuat);panel.place(headPos,headQuat);}
function replay(){if(!chosen().length||loading)return;clock.reset();clock.play(renderer.xr.isPresenting?3000:0);sync();}
function togglePause(){if(!chosen().length||loading)return;if(clock.playing)clock.pause();else clock.play(renderer.xr.isPresenting&&clock.time===0?3000:0);sync();}
function nextBall(direction=1){
  if(!current||loading)return;const ids=selected.filter(Boolean);
  if(ids.length>1){singleIndex=(singleIndex+direction+ids.length)%ids.length;compare=false;}
  else{const ps=current.pitches.filter(validPitch);const index=ps.findIndex(p=>p.id===ids[0]);selected[0]=ps[(index+direction+ps.length)%ps.length]?.id||null;renderSlots();}
  selectionChanged();
}
function nextPitcher(direction){const items=[...$('pitcher').options];if(items.length<1)return;let i=items.findIndex(o=>o.value===$('pitcher').value);$('pitcher').value=items[(i+direction+items.length)%items.length].value;loadPitcher();}
function action(id){
  switch(id){
    case 'replay':replay();break;case 'pause':togglePause();break;case 'next':nextBall();break;
    case 'compare':compare=!compare;singleIndex=0;selectionChanged();break;
    case 'right':case 'left':case 'catcher':changeView(id);break;
    case 'recenter':clock.pause();needsCalibration=true;sync();break;
    case 'paths':world.paths.visible=!world.paths.visible;sync();break;
    case 'zone':world.zone.visible=!world.zone.visible;sync();break;
    case 'loop':clock.loop=!clock.loop;sync();break;
    case 'slower':{const speeds=[1,.75,.5,.25];clock.speed=speeds[(speeds.indexOf(clock.speed)+1)%speeds.length];clock.last=null;sync();break;}
    case 'closer':if(view!=='catcher'){side=clamp(Math.round((side-.05)*100)/100,0,1.5);relocate();}break;
    case 'farther':if(view!=='catcher'){side=clamp(Math.round((side+.05)*100)/100,0,1.5);relocate();}break;
    case 'forward':if(view!=='catcher'){forward=clamp(Math.round((forward+.05)*100)/100,-2,1.5);relocate();}break;
    case 'back':if(view!=='catcher'){forward=clamp(Math.round((forward-.05)*100)/100,-2,1.5);relocate();}break;
    case 'prevPitcher':nextPitcher(-1);break;case 'nextPitcher':nextPitcher(1);break;
    case 'menu':placePanel();break;case 'exit':flow.exit();break;
  }
}
function resize(){if(!renderer||renderer.xr.isPresenting)return;const r=$('stage').getBoundingClientRect();renderer.setSize(Math.max(1,r.width),Math.max(1,r.height),false);camera.aspect=r.width/Math.max(1,r.height);camera.updateProjectionMatrix();}
function connectXR(){
  flow=new XRSessionFlow({xr:navigator.xr,secure:window.isSecureContext,
    initialize:async(session,floor)=>{
      clock.pause();floorReference=floor;needsCalibration=true;xrTracked=false;
      camera.position.set(0,0,0);camera.quaternion.identity();rig.position.set(0,0,0);rig.quaternion.identity();
      renderer.xr.setReferenceSpaceType(floor?'local-floor':'local');await renderer.xr.setSession(session);
      if(flow.session!==session)return;
      renderer.xr.getReferenceSpace()?.addEventListener('reset',()=>{clock.pause();needsCalibration=true;});
      document.body.classList.add('xr-active');$('settings').hidden=true;
    },
    onChange:(state,error)=>{
      if(state==='unsupported'){$('enterVR').textContent='通常画面で再生';$('xrStatus').textContent='対応VRのブラウザで開くとVR表示を利用できます';}
      else if(state==='ready'){$('enterVR').textContent='VRで入る';$('xrStatus').textContent='VR対応を確認しました';}
      else if(state==='starting'){$('enterVR').textContent='VRを準備中';}
      else if(state==='active'){$('enterVR').textContent='VR使用中';}
      else if(state==='error'){message(error?.name==='NotAllowedError'?'VRの開始が許可されませんでした。もう一度お試しください。':'VRを開始できませんでした。通常画面で再生できます。');$('enterVR').textContent='VRを再試行';}
      sync();
    },
    onVisibility:visible=>{if(!visible){clock.pause();sync();}},
    onEnd:()=>{clock.pause();panel.hide();xrTracked=false;needsCalibration=false;document.body.classList.remove('xr-active');for(const c of controllers)c.userData.line.visible=false;requestAnimationFrame(()=>{setDesktopCamera();resize();sync();});}
  });
  for(let i=0;i<2;i++){
    const controller=renderer.xr.getController(i);rig.add(controller);controllers.push(controller);
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(0,0,-1)]),new THREE.LineBasicMaterial({color:'#c8e8ee',transparent:true,opacity:.7}));line.scale.z=2;line.visible=false;controller.add(line);controller.userData.line=line;controller.userData.connected=false;
    controller.addEventListener('connected',e=>{controller.userData.connected=true;controller.userData.mode=e.data.targetRayMode;});controller.addEventListener('disconnected',()=>{controller.userData.connected=false;line.visible=false;});
    controller.addEventListener('select',()=>{if(!renderer.xr.isPresenting||!xrTracked)return;if(!panel.mesh.visible){clock.pause();sync();placePanel();return;}const hit=panel.fromController(controller);if(hit)action(hit.id);else placePanel();});
  }
  navigator.xr?.addEventListener?.('devicechange',()=>{if(flow.state==='idle')flow.probe();});
  $('enterVR').onclick=()=>flow.enter();flow.probe();
}
function frame(now,xrFrame){
  const presenting=renderer.xr.isPresenting;
  let visible=!document.hidden;
  if(presenting){
    visible=flow.session?.visibilityState==='visible';
    const pose=xrFrame?.getViewerPose(renderer.xr.getReferenceSpace());xrTracked=!!pose;
    if(pose){
      if(needsCalibration){const t=pose.transform,cal=calibrateRig(t.position,t.orientation,viewpoint(view,side,forward),floorReference);rig.position.fromArray(cal.position);rig.rotation.set(0,cal.yaw,0);rig.updateMatrixWorld(true);needsCalibration=false;
        // XR camera world transform is refreshed before using it for UI placement.
        renderer.xr.updateCamera(camera);placePanel();}
    }else{visible=false;panel.reticle.visible=false;}
  }
  clock.tick(now,visible);world.update(clock.time);
  if(presenting&&xrTracked&&visible){
    // Keep the full flight unobstructed. A trigger pauses and recalls the panel.
    const inFlight=clock.playing&&clock.countdownUntil===null&&clock.waitUntil===null;
    panel.mesh.visible=!inFlight;
    renderer.xr.updateCamera(camera);const active=controllers.filter(c=>c.userData.connected&&c.visible&&c.userData.mode!=='gaze');let hit=null;
    for(const c of controllers){c.userData.line.visible=active.includes(c)&&!inFlight;if(!active.includes(c))continue;const h=panel.fromController(c);c.userData.line.scale.z=h?.distance||1.5;if(h&&!hit)hit=h;}
    if(active.length===0){const xrCamera=renderer.xr.getCamera();xrCamera.getWorldPosition(headPos);xrCamera.getWorldQuaternion(headQuat);gazeDirection.set(0,0,-1).applyQuaternion(headQuat);hit=panel.hit(headPos,gazeDirection);}
    panel.setHover(hit,now,active.length===0);
    if(now-lastPanelState>150){updatePanel();lastPanelState=now;}
  }
  $('time').value=clock.time.toFixed(3)+' s';$('scrub').value=Math.round(clock.time/clock.duration*1000);
  const counting=clock.countdownUntil!==null&&clock.countdownUntil>now;$('countdown').hidden=!counting;if(counting)$('countdown').textContent=Math.ceil((clock.countdownUntil-now)/1000);
  const pauseLabel=clock.playing?'一時停止':'再開';if($('pause').textContent!==pauseLabel)$('pause').textContent=pauseLabel;
  renderer.render(scene,camera);
}
function bindUI(){
  $('season').onchange=()=>{const team=$('team').value,id=$('pitcher').value;season=catalog.seasons.find(s=>s.id===$('season').value);populateTeams(team);populatePitchers(id);loadPitcher();};
  $('team').onchange=()=>{populatePitchers();loadPitcher();};$('pitcher').onchange=loadPitcher;$('retry').onclick=loadPitcher;
  $('replay').onclick=replay;$('pause').onclick=togglePause;$('speed').onchange=()=>{clock.speed=Number($('speed').value);clock.last=null;sync();};$('scrub').oninput=()=>{clock.seek(Number($('scrub').value)/1000*clock.duration);sync();};
  $('settingsButton').onclick=()=>{$('settings').hidden=!$('settings').hidden;};$('closeSettings').onclick=()=>{$('settings').hidden=true;};
  for(const id of ['paths','zone','loop','compare'])$(id).onchange=()=>action(id);
  $('nextPitch').onclick=()=>nextBall(1);$('prevPitch').onclick=()=>nextBall(-1);
  $('side').oninput=()=>{side=Number($('side').value)/100;relocate();};$('forward').oninput=()=>{forward=Number($('forward').value)/100;relocate();};
  $('resetPosition').onclick=()=>{side=.34;forward=.25;relocate();};
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>changeView(b.dataset.view));
  $('copyLink').onclick=async()=>{try{await navigator.clipboard.writeText(location.href);message('この投手のリンクをコピーしました');}catch{message('アドレス欄のURLをコピーして共有してください');}};
  $('infoButton').onclick=()=>$('info').showModal();$('closeInfo').onclick=()=>$('info').close();
  document.addEventListener('visibilitychange',()=>{if(document.hidden){clock.pause();sync();}});
  document.addEventListener('keydown',e=>{if(e.target.closest('input,select,textarea,button')||$('info').open)return;if(e.code==='Space'){e.preventDefault();togglePause();}if(e.key==='r')replay();});
  $('scene').addEventListener('pointerdown',e=>{if(renderer.xr.isPresenting)return;drag={x:e.clientX,y:e.clientY,yaw:orbitYaw,pitch:orbitPitch};$('scene').setPointerCapture(e.pointerId);});
  $('scene').addEventListener('pointermove',e=>{if(!drag||renderer.xr.isPresenting)return;orbitYaw=drag.yaw-(e.clientX-drag.x)*.003;orbitPitch=clamp(drag.pitch-(e.clientY-drag.y)*.003,-.75,.75);setDesktopCamera();});
  for(const ev of ['pointerup','pointercancel'])$('scene').addEventListener(ev,()=>{drag=null;});
  window.addEventListener('resize',resize);new ResizeObserver(resize).observe($('stage'));
}
async function boot(){
  try{
    renderer=new THREE.WebGLRenderer({canvas:$('scene'),antialias:true,alpha:false,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.75));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.xr.enabled=true;renderer.xr.setFramebufferScaleFactor(1);renderer.xr.setFoveation(.5);
    scene=new THREE.Scene();camera=new THREE.PerspectiveCamera(70,1,.015,160);rig=new THREE.Group();rig.add(camera);scene.add(rig);world=buildWorld(scene);panel=new VRPanel(scene,action);
    document.fonts?.load('500 26px NotoLocal').then(()=>panel.paint()).catch(()=>{});
    const response=await fetch('./catalog.json');if(!response.ok)throw new Error('投手一覧を取得できません');catalog=await response.json();
    const params=new URL(location.href).searchParams;season=catalog.seasons.find(s=>s.id===params.get('season'))||catalog.seasons.find(s=>s.id===catalog.defaultSeasonId)||catalog.seasons[0];
    $('season').replaceChildren(...catalog.seasons.map(s=>option(s.id,s.label)));$('season').value=season.id;
    const first=season.pitchers.find(p=>p.id===params.get('pitcher'))||season.pitchers.find(p=>p.name.includes('子安'))||season.pitchers[0];populateTeams(first?.team);populatePitchers(first?.id);
    bindUI();connectXR();resize();setDesktopCamera();renderer.setAnimationLoop(frame);await loadPitcher();
  }catch(error){$('loading').hidden=true;$('errorBox').hidden=false;$('errorText').textContent='3D画面を準備できませんでした。ブラウザの3D表示を有効にして再読み込みしてください。';$('retry').onclick=()=>location.reload();$('xrStatus').textContent='この環境では画面を起動できません';message('起動できませんでした');console.error(error);}
}
boot();
