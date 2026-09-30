(function(){
const types={Fastball:['FB','ストレート','#d92d20'],Sinker:['2S','シンカー','#4086eb'],Slider:['SL','スライダー','#9746aa'],Cutter:['CT','カットボール','#6546ed'],Curveball:['CB','カーブ','#42a878'],Splitter:['SP','スプリット','#fb8500'],Changeup:['CH','チェンジアップ','#d5a000'],ChangeUp:['CH','チェンジアップ','#d5a000'],Other:['OTH','その他','#64748b'],Undefined:['—','未分類','#64748b'],Knuckleball:['KN','ナックル','#64748b']};
window.pitchStyle=t=>types[t]||[t,t,'#64748b'];
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=a=>{let l=Math.hypot(...a);return a.map(v=>v/l)};
const poly=(c,t)=>c[0]+c[1]*t+c[2]*t*t;
window.pitchPosition=(p,t)=>[-poly(p.c[2],t),poly(p.c[1],t),poly(p.c[0],t)-poly(p.c[0],p.time)];
const usablePitches=pitches=>(Array.isArray(pitches)?pitches:[]).filter(p=>p&&p.validTrajectory!==false&&Number.isFinite(p.time)&&p.time>=0&&Array.isArray(p.c)&&p.c.length===3&&p.c.every(a=>Array.isArray(a)&&a.length===3&&a.every(Number.isFinite)));
const centerOf=points=>points.length?[0,1,2].map(i=>points.reduce((s,p)=>s+p[i],0)/points.length):[0,1.80,16];
const cameraFrame=(eye,target)=>{const direction=norm(sub(target,eye)),horizontal=cross(direction,[0,1,0]);const right=Math.hypot(...horizontal)>1e-8?norm(horizontal):[-1,0,0];return {direction,right,up:cross(right,direction)};};
// Lock the gaze to the selected pitches' actual release center. Neither the
// current ball positions nor playback progress may change this point.
window.pitchReleaseTarget=function(pitches=[]){
 return centerOf(usablePitches(pitches).map(p=>pitchPosition(p,0)).filter(p=>p.every(Number.isFinite)));
};
// Optional experimental gaze follows the mean of the balls at one shared
// physical time; faster pitches remain at their own endpoints after arrival.
window.pitchAimTarget=function(pitches=[],elapsed=0,mode='release'){
 if(mode!=='follow')return pitchReleaseTarget(pitches);
 const time=Number.isFinite(elapsed)?Math.max(0,elapsed):0;
 return centerOf(usablePitches(pitches).map(p=>pitchPosition(p,Math.min(time,Math.max(0,Number.isFinite(p.flightEndTime)?p.flightEndTime:p.time)))).filter(p=>p.every(Number.isFinite)));
};
window.batterCamera=function(settings={},view='right',aimTarget=[0,1.80,16],fallbackTarget=[0,1.80,16]){
 settings=settings&&typeof settings==='object'?settings:{};
 const value=(v,fallback,min,max)=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Math.max(min,Math.min(max,Number(v))):fallback;
 const height=value(settings.height,1.50,.50,2.30),side=value(settings.side,.34,0,2.00),forward=value(settings.forward,.25,-3.00,2.00);
 const eye=[(view==='left'?-1:1)*side,height,forward];
 const finitePoint=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
 let target=finitePoint(aimTarget)?aimTarget.slice():(finitePoint(fallbackTarget)?fallbackTarget.slice():[0,1.80,16]);
 if(Math.hypot(...sub(target,eye))<1e-6)target=finitePoint(fallbackTarget)?fallbackTarget.slice():[0,1.80,16];
 if(Math.hypot(...sub(target,eye))<1e-6)target=[0,1.80,16];
 // Keep the requested eye position and a fixed field of view. The plate can
 // leave the frame when the user moves in front of it; never warp the flight.
 return {eye,target,...cameraFrame(eye,target),fov:115,settings:{height,side,forward}};
};
window.positionAtDistance=(p,d)=>{if(!p?.validTrajectory||d<0||d>pitchPosition(p,0)[2])return null;let lo=0,hi=p.time;for(let k=0;k<45;k++){let m=(lo+hi)/2;if(pitchPosition(p,m)[2]>d)lo=m;else hi=m;}let t=(lo+hi)/2;return t>(p.flightEndTime??p.time)+1e-6?null:pitchPosition(p,t);};
window.pitchSeparation=(a,b,d)=>{const x=positionAtDistance(a,d),y=positionAtDistance(b,d);return x&&y?Math.hypot(x[0]-y[0],x[1]-y[1])*100:null;};
// Compose the entire reference zone below the HUD. Only the lens and viewport
// center change; the catcher eye, world coordinates and physical clock do not.
window.catcherLensForViewport=function(width,height,{compact=true}={}){
 const W=Math.max(1,width),H=Math.max(1,height),header=compact?0:100,foot=compact?0:132,sh=Math.max(1,H-header-foot);
 const top=header+(compact?(sh<300?Math.min(74,sh*.36):138):18);
 const bottom=header+sh-(compact?Math.min(48,sh*.18):18),marginX=Math.min(18,W*.08);
 const baseFocal=sh/(2*Math.tan(42*Math.PI/360));
 const focal=Math.max(.01,Math.min(baseFocal*2.75,(bottom-top)*1.75/.60,(W-2*marginX)*1.75/.432));
 const centerY=(top+bottom)/2-.05*focal/1.75;
 return {zoom:focal/baseFocal,focal,centerY,bounds:{left:marginX,right:W-marginX,top,bottom}};
};
window.drawTrajectory=function(canvas,pitcher,pitches,options={}){
 // Interactive canvases use CSS pixels for all geometry and a larger backing
 // store for sharp output. Poster export keeps its original 1800 × 1120 layout.
 const compact=options.compact===true,pixelRatio=compact&&Number.isFinite(options.pixelRatio)&&options.pixelRatio>0?options.pixelRatio:1;
 const c=canvas.getContext('2d'),W=canvas.width/pixelRatio,H=canvas.height/pixelRatio;
 if(!c)throw new Error('投球画面を描画できません。この端末では Canvas 2D を利用できません。');
 c.save();c.setTransform(pixelRatio,0,0,pixelRatio,0,0);c.clearRect(0,0,W,H);
 const view=options.view||'catcher',progress=options.progress??1,trail=options.trail??true,realism=options.realism===true,showPaths=!realism&&options.showPaths!==false,ballSizeAid=!realism&&options.ballSizeAid!==false;
 const maxTime=Math.max(...pitches.map(p=>p.flightEndTime??p.time),.01),elapsed=progress*maxTime;
 const gazeMode=options.gazeMode==='follow'?'follow':'release',releaseTarget=pitchReleaseTarget(pitches);
 const header=compact?0:100,foot=compact?0:132,sh=H-header-foot;
 c.fillStyle='#f6f6f8';c.fillRect(0,0,W,H);c.fillStyle='#fff';c.fillRect(0,0,W,header);
 function txt(s,x,y,size=20,color='#1a2230',weight=400,align='left'){c.font=`${weight} ${size}px NotoLocal, sans-serif`;c.fillStyle=color;c.textAlign=align;c.fillText(s,x,y);}
 if(!compact){txt('ID東都',32,43,22,'#c8202b',700);txt(`${pitcher.name}  投球軌道`,176,44,29,'#161b26',700);
 txt(`${pitcher.teamLabel||pitcher.team}  /  ${pitcher.seasonLabel||'2026春'}季リーグ  /  ${realism?'実戦モード':'実投球の比較'}`,176,77,17,'#697180');}
 const vnames={catcher:'捕手視点',right:'右打者視点',left:'左打者視点'};
 if(!compact)txt(vnames[view],W-32,51,23,'#161b26',600,'right');
 let eye,target,fov,batter;
 if(view==='catcher'){eye=[0,.85,-1.75];target=[0,.85,14];fov=42;}
 if(view==='right'||view==='left'){batter=batterCamera(options.batterEye||{},view,pitchAimTarget(pitches,elapsed,gazeMode),releaseTarget);({eye,target,fov}=batter);}
 if(!compact&&(view==='right'||view==='left'))txt(gazeMode==='follow'?'ボールを追尾（試用）':'リリース方向に固定',W-32,79,15,'#697180',400,'right');
 if(batter&&Number.isFinite(options.batterFov))fov=Math.max(60,Math.min(120,options.batterFov));
 // A lens change magnifies the same physical scene; it does not shift the
 // eye, target, ball coordinates, or their common physical clock.
 const catcherLens=view==='catcher'?catcherLensForViewport(W,H,{compact}):null;
 const zoom=catcherLens?catcherLens.zoom:Number.isFinite(options.zoom)?Math.max(1,Math.min(10,options.zoom)):9;
 // A screen-matched batter view uses the actual displayed canvas width and
 // viewing distance. This is a flat-screen pinhole projection, not a claim
 // to reproduce binocular vision or a batter's measured eye movements.
 // Catcher viewing fits the whole zone independently of batter calibration.
 const positive=(v,fallback)=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))&&Number(v)>0?Number(v):fallback;
 const projectionMode=batter&&options.projectionMode==='screen'?'screen':'wide';
 const screenWidthCm=positive(options.screenWidthCm,6.5),viewDistanceCm=positive(options.viewDistanceCm,35);
 const baseFocal=projectionMode==='screen'?W*viewDistanceCm/screenWidthCm:sh/(2*Math.tan(fov*Math.PI/360));
 const focal=catcherLens?catcherLens.focal:baseFocal*zoom,centerY=catcherLens?catcherLens.centerY:header+sh*.50;
 fov=(Math.atan((centerY-header)/focal)+Math.atan((header+sh-centerY)/focal))*180/Math.PI;
 const horizontalFov=2*Math.atan(W/(2*focal))*180/Math.PI;
 if(options.eye){eye=options.eye;target=[0,0.9,8];}
 const {direction:forward,right,up}=cameraFrame(eye,target);
 const project=p=>{const q=sub(p,eye),z=dot(q,forward);return z>0.08?[W/2+dot(q,right)*focal/z,centerY-dot(q,up)*focal/z,z]:null;};
 c.save();c.beginPath();c.rect(0,header,W,sh);c.clip();
 const sky=c.createLinearGradient(0,header,0,header+sh);sky.addColorStop(0,'#7badd5');sky.addColorStop(.65,'#d6ecf5');sky.addColorStop(1,'#d6e0dc');c.fillStyle=sky;c.fillRect(0,header,W,sh);
 const surfaces=[],fieldMarkers=[];
 function face(vertices,fill,stroke=null,layer=surfaces){
  const clipped=[];for(let i=0;i<vertices.length;i++){const a=vertices[i],b=vertices[(i+1)%vertices.length],az=dot(sub(a,eye),forward),bz=dot(sub(b,eye),forward),insideA=az>=.09,insideB=bz>=.09;if(insideA)clipped.push(a);if(insideA!==insideB){let t=(.09-az)/(bz-az);clipped.push(a.map((v,k)=>v+(b[k]-v)*t));}}
  if(clipped.length<3)return;let pp=clipped.map(project);if(pp.some(p=>!p))return;layer.push({pp,fill,stroke,z:pp.reduce((s,p)=>s+p[2],0)/pp.length});
 }
 for(let z=-30;z<62;z+=2.5) for(let x=-45;x<45;x+=5){let dirt=(z<7&&Math.abs(x+2.5)<8)||(Math.abs(z-18.0)<2&&Math.abs(x+2.5)<3);face([[x,0,z],[x+5,0,z],[x+5,0,z+2.5],[x,0,z+2.5]],dirt?'#c8b18d':(Math.round(z/2.5)%2?'#8faa6b':'#99b674'));}
 for(let x=-45;x<45;x+=5){face([[x,0,58],[x+5,0,58],[x+5,9,64],[x,9,64]],'#334b48');for(let h=1;h<9;h+=1.2)face([[x,h,58+h*.66],[x+5,h,58+h*.66],[x+5,h+.12,58+h*.66],[x,h+.12,58+h*.66]],'#798782');}
 for(const x of [-34,34]){face([[x,0,43],[x+.3,0,43],[x+.3,22,43],[x,22,43]],'#bdc5c4');face([[x-2,22,43],[x+2,22,43],[x+2,23,43],[x-2,23,43]],'#eeeeea');}
 let mound=[];for(let i=0;i<48;i++){let a=i/48*Math.PI*2;mound.push([Math.sin(a)*2.7,.025,18.0+Math.cos(a)*2.7]);}face(mound,'#c9b28f');
 // The rubber's front edge is 60 ft 6 in from the rendered home tip.
 // Keep the existing schematic mound level; markers draw after terrain so
 // the mound's average-depth sorting cannot paint over this small surface.
 const rubberFront=18.4404-.432,rubberBack=rubberFront+.1524,rubberHalf=.6096/2;
 face([[-rubberHalf,.025,rubberFront],[rubberHalf,.025,rubberFront],[rubberHalf,.04,rubberFront],[-rubberHalf,.04,rubberFront]],'#e3e6e8','#d5d9dc',fieldMarkers);
 face([[-rubberHalf,.04,rubberFront],[rubberHalf,.04,rubberFront],[rubberHalf,.04,rubberBack],[-rubberHalf,.04,rubberBack]],'#fff','#fff',fieldMarkers);
 face([[-.216,.025,0],[.216,.025,0],[.216,.025,-.216],[0,.025,-.432],[-.216,.025,-.216]],'#fcfcfc','#e2e4e6');
 for(let s of [-1,1])face([[0,.016,-.432],[s*30,.016,29.6],[s*30+.045,.016,29.65],[.045,.016,-.4]],'#f7f8ef');
 surfaces.sort((a,b)=>b.z-a.z);fieldMarkers.sort((a,b)=>b.z-a.z);for(const a of [...surfaces,...fieldMarkers]){c.beginPath();a.pp.forEach((p,i)=>i?c.lineTo(p[0],p[1]):c.moveTo(p[0],p[1]));c.closePath();c.fillStyle=a.fill;c.fill();if(a.stroke){c.strokeStyle=a.stroke;c.lineWidth=1;c.stroke();}}
 function line3(points,color,width=2,dash=[]){let pp=points.map(project);c.strokeStyle=color;c.lineWidth=width;c.setLineDash(dash);c.beginPath();let move=true;for(const p of pp){if(!p){move=true;continue;}if(move)c.moveTo(p[0],p[1]);else c.lineTo(p[0],p[1]);move=false;}c.stroke();c.setLineDash([]);}
 const seg=[];if(showPaths)for(const p of pitches){let end=trail?(p.flightEndTime??p.time):Math.min(elapsed,p.flightEndTime??p.time);const col=pitchStyle(p.type)[2];for(let j=0;j<140;j++){let t=j/140*end,t1=(j+1)/140*end,a=project(pitchPosition(p,t)),b=project(pitchPosition(p,t1));if(a&&b)seg.push({a,b,col,alpha:trail&&t>elapsed?.25:1});}}
 seg.sort((a,b)=>(b.a[2]+b.b[2])-(a.a[2]+a.b[2]));for(const s of seg){c.beginPath();c.moveTo(s.a[0],s.a[1]);c.lineTo(s.b[0],s.b[1]);c.strokeStyle=s.col;c.globalAlpha=s.alpha;c.lineWidth=Math.max(compact?1.5:2.8,Math.min(12,focal*.018/s.a[2]));c.lineCap='round';c.stroke();}c.globalAlpha=1;
 // A reference zone; no batter-specific strike-zone measurements are present.
 if(!realism)for(let i=0;i<=3;i++){let x=-.216+i*.432/3;line3([[x,.50,0],[x,1.10,0]],'#29332f',i===0||i===3?3:1.4);let y=.5+i*.6/3;line3([[-.216,y,0],[.216,y,0]],'#29332f',i===0||i===3?3:1.4);}
 const aim=project(releaseTarget),inside=p=>!!p&&p[0]>=0&&p[0]<=W&&p[1]>=header&&p[1]<=header+sh;
 if(!realism&&batter&&pitches.length&&inside(aim)){c.beginPath();c.arc(aim[0],aim[1],compact?8:13,0,Math.PI*2);c.strokeStyle='#ffffffb3';c.lineWidth=1.5;c.setLineDash([3,3]);c.stroke();c.setLineDash([]);if(!compact)txt('リリース中心',aim[0]+21,aim[1]-14,15,'#30465c',500);}
 const projectedBalls=pitches.map(p=>{
  const time=Math.min(elapsed,p.flightEndTime??p.time),position=pitchPosition(p,time),q=project(position);
  const physicalRadius=q?focal*.0366/q[2]:null;
  const radius=q?(ballSizeAid?Math.max(compact?2.5:5,Math.min(Math.max(23,Math.min(160,sh*.35)),physicalRadius)):physicalRadius):null;
  return {p,q,time,position,physicalRadius,radius};
 });
 const balls=projectedBalls.filter(x=>x.q).sort((a,b)=>b.q[2]-a.q[2]);
 for(const {p,q,time,radius} of balls){
  window.drawSpinningBaseball(c,{x:q[0],y:q[1],radius,pitch:p,elapsed:time,camera:{right,up,forward},color:pitchStyle(p.type)[2],outline:!realism});
 }

 // Overlay panel lets colors and selected pitch dates remain readable on grass.
 if(!compact&&!realism){c.fillStyle='#ffffffed';c.fillRect(24,header+22,330,42+pitches.length*41);
 txt('選択した実投球',42,header+52,18,'#293443',600);
 pitches.forEach((p,i)=>{let y=header+84+i*41; c.fillStyle=pitchStyle(p.type)[2];c.beginPath();c.arc(47,y-6,5,0,Math.PI*2);c.fill();txt(`${pitchStyle(p.type)[0]}  ${Number(p.velocity).toFixed(1)} km/h`,63,y,19,'#1e293b',600);txt(`${p.date.slice(5)}  #${p.pitchNo}`,333,y,15,'#586575',400,'right');});}
 c.restore();
 if(!compact&&realism){c.fillStyle='#fff';c.fillRect(0,H-foot,W,foot);txt('実戦モード',32,H-foot+45,22,'#29313c',600);txt('白いボールと赤い縫い目を表示',32,H-foot+81,18,'#697586');}
 if(!compact&&!realism){c.fillStyle='#fff';c.fillRect(0,H-foot,W,foot);txt('同じ距離での軌道差',32,H-foot+34,19,'#29313c',600);
 if(pitches.length>=2){let a=pitches[0],b=pitches[1];txt(`${pitchStyle(a.type)[0]} × ${pitchStyle(b.type)[0]}`,32,H-foot+67,22,'#151b25',700);let ds=[15,10,5,0];let left=300,step=(W-left-36)/4;ds.forEach((d,i)=>{let x=left+i*step;txt(d===0?'ホーム前縁':`ホーム手前 ${d} m`,x,H-foot+35,16,'#75808e');let diff=pitchSeparation(a,b,d);txt(diff===null?'—':diff.toFixed(1),x,H-foot+79,34,'#18212c',700);txt('cm',x+110,H-foot+79,17,'#788290');});}
 else txt('2球以上を選ぶと、最初の2球の距離別の差を表示します。',32,H-foot+76,18,'#697586');
 const eyeNote=batter?`目の高さ${batter.settings.height.toFixed(2)} m・中心から${batter.settings.side.toFixed(2)} m・ホーム前縁から${batter.settings.forward>=0?'投手':'捕手'}側${Math.abs(batter.settings.forward).toFixed(2)} m。${projectionMode==='screen'?'画面幅・視距離に合わせた仮想視点':'広角の仮想視点'}。球場は模式図。`:'';
 txt(batter?eyeNote:'各球のリリース時刻をそろえて再生。ゾーンは高さ0.50–1.10 mの参考枠。球場は模式図。',32,H-16,14,'#7d8590');}
 c.restore();
 const visibleCount=projectedBalls.filter(({q})=>inside(q)).length;
 return {camera:{eye:eye.slice(),target:target.slice(),fov,horizontalFov,projectionMode,focal,zoom,principalPoint:[W/2,centerY],...(catcherLens?{zoneBounds:catcherLens.bounds}:{}),...(projectionMode==='screen'?{screenWidthCm,viewDistanceCm}:{})},referenceZone:[[-.216,.50,0],[.216,.50,0],[.216,1.10,0],[-.216,1.10,0]].map(project),elapsed,duration:maxTime,visibleCount,offscreenCount:pitches.length-visibleCount,releaseVisible:inside(aim),width:W,height:H,ballSizeAid,balls:projectedBalls.map(({p,q,time,position,physicalRadius,radius})=>({id:p.id,time,position,screenPoint:q?q.slice(0,2):null,depth:q?q[2]:null,physicalRadius,radius}))};
};
})();
