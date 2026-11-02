(function(){
const types={Fastball:['FB','ストレート','#d92d20'],Sinker:['2S','シンカー','#4086eb'],Slider:['SL','スライダー','#9746aa'],Cutter:['CT','カットボール','#6546ed'],Curveball:['CB','カーブ','#42a878'],Splitter:['SP','スプリット','#fb8500'],Changeup:['CH','チェンジアップ','#d5a000'],ChangeUp:['CH','チェンジアップ','#d5a000'],Other:['OTH','その他','#64748b'],Undefined:['—','未分類','#64748b'],Knuckleball:['KN','ナックル','#64748b']};
window.pitchStyle=t=>types[t]||[t,t,'#64748b'];
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),sub=(a,b)=>a.map((v,i)=>v-b[i]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],norm=a=>{let l=Math.hypot(...a);return a.map(v=>v/l)};
const poly=(c,t)=>c[0]+c[1]*t+c[2]*t*t;
window.pitchPosition=(p,t)=>[-poly(p.c[2],t),poly(p.c[1],t),poly(p.c[0],t)-poly(p.c[0],p.time)];
const usablePitches=pitches=>(Array.isArray(pitches)?pitches:[]).filter(p=>p&&p.validTrajectory!==false&&Number.isFinite(p.time)&&p.time>=0&&Array.isArray(p.c)&&p.c.length===3&&p.c.every(a=>Array.isArray(a)&&a.length===3&&a.every(Number.isFinite)));
const backgroundCache=new WeakMap();
// The field is immutable. Build its world vertices once, then reuse projection
// buffers per canvas. Keep the original polygons, near-plane clipping and depth
// order so moving the camera changes neither the geometry nor the rendered view.
let fieldGeometry=null;
const fieldWorkspaces=new WeakMap();
function makeFieldGeometry(){
 const vertices=[],surfaces=[],fieldMarkers=[],vertexIds=new Map();
 function face(points,fill,stroke=null,layer=surfaces){
  const indices=points.map(point=>{
   const key=point.join(',');
   if(vertexIds.has(key))return vertexIds.get(key);
   const id=vertices.length;vertices.push(point);vertexIds.set(key,id);return id;
  });
  layer.push({indices,fill,stroke});
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
 return {vertices,surfaces,fieldMarkers};
}
function drawFieldGeometry(c,canvas,eye,forward,right,up,focal,centerX,centerY,W,header,sh){
 const geometry=fieldGeometry||(fieldGeometry=makeFieldGeometry());
 let work=fieldWorkspaces.get(canvas);
 if(!work){
  const pool=faces=>faces.map(face=>({...face,pp:Array.from({length:face.indices.length*2},()=>[0,0,0]),count:0,z:0}));
  work={projected:new Float64Array(geometry.vertices.length*3),surfaces:pool(geometry.surfaces),markers:pool(geometry.fieldMarkers),visible:[],visibleMarkers:[]};
  fieldWorkspaces.set(canvas,work);
 }
 const projected=work.projected;
 // Shared ground/stand corners are projected once per frame, without creating
 // temporary vectors. The arithmetic order matches the original projector.
 for(let i=0;i<geometry.vertices.length;i++){
  const point=geometry.vertices[i],dx=point[0]-eye[0],dy=point[1]-eye[1],dz=point[2]-eye[2],offset=i*3;
  const depth=dx*forward[0]+dy*forward[1]+dz*forward[2];
  projected[offset]=centerX+(dx*right[0]+dy*right[1]+dz*right[2])*focal/depth;
  projected[offset+1]=centerY-(dx*up[0]+dy*up[1]+dz*up[2])*focal/depth;
  projected[offset+2]=depth;
 }
 const margin=Math.max(8,(c.miterLimit||10)/2+1);
 function prepare(faces,visible){
  visible.length=0;
  for(const face of faces){
   const ids=face.indices,points=face.pp;let count=0,depthSum=0;
   for(let i=0;i<ids.length;i++){
    const ia=ids[i],ib=ids[(i+1)%ids.length],ao=ia*3,bo=ib*3;
    const az=projected[ao+2],bz=projected[bo+2],insideA=az>=.09,insideB=bz>=.09;
    if(insideA){
     const point=points[count++];point[0]=projected[ao];point[1]=projected[ao+1];point[2]=az;depthSum+=az;
    }
    if(insideA!==insideB){
     const a=geometry.vertices[ia],b=geometry.vertices[ib],t=(.09-az)/(bz-az);
     const dx=a[0]+(b[0]-a[0])*t-eye[0],dy=a[1]+(b[1]-a[1])*t-eye[1],dz=a[2]+(b[2]-a[2])*t-eye[2];
     const depth=dx*forward[0]+dy*forward[1]+dz*forward[2],point=points[count++];
     point[0]=centerX+(dx*right[0]+dy*right[1]+dz*right[2])*focal/depth;
     point[1]=centerY-(dx*up[0]+dy*up[1]+dz*up[2])*focal/depth;
     point[2]=depth;depthSum+=depth;
    }
   }
   if(count<3)continue;
   // Discard only faces wholly outside the existing clip rectangle. Keep a
   // conservative margin for antialiasing and the original one-pixel miters.
   let minX=points[0][0],maxX=minX,minY=points[0][1],maxY=minY;
   for(let i=1;i<count;i++){const x=points[i][0],y=points[i][1];if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;}
   if(maxX < -margin || minX > W+margin || maxY < header-margin || minY > header+sh+margin)continue;
   face.count=count;face.z=depthSum/count;visible.push(face);
  }
  // Refill in source order before stable sorting, including equal-depth faces.
  visible.sort((a,b)=>b.z-a.z);
 }
 prepare(work.surfaces,work.visible);prepare(work.markers,work.visibleMarkers);
 function paint(faces){
  for(const face of faces){
   c.beginPath();c.moveTo(face.pp[0][0],face.pp[0][1]);
   for(let i=1;i<face.count;i++)c.lineTo(face.pp[i][0],face.pp[i][1]);
   c.closePath();c.fillStyle=face.fill;c.fill();
   if(face.stroke){c.strokeStyle=face.stroke;c.lineWidth=1;c.stroke();}
  }
 }
 paint(work.visible);paint(work.visibleMarkers);
}
const centerOf=points=>points.length?[0,1,2].map(i=>points.reduce((s,p)=>s+p[i],0)/points.length):[0,1.80,16];
const cameraFrame=(eye,target)=>{const direction=norm(sub(target,eye)),horizontal=cross(direction,[0,1,0]);const right=Math.hypot(...horizontal)>1e-8?norm(horizontal):[-1,0,0];return {direction,right,up:cross(right,direction)};};
// Kishita et al. (2020), doi:10.3389/fspor.2020.00003 and .00064.
// Onset is impact-aligned, not a visual-information or decision deadline.
// The display stops tracking at this time per the revised user requirement.
// Holding the screen is a viewing aid, not a literal reproduction of saccades.
const impactCache=new WeakMap(),impactPlane=.06,trackingLead=.120;
window.pitchImpact=function(p){
 if(!usablePitches([p]).length)return null;
 if(impactCache.has(p))return impactCache.get(p);
 let lo=0,hi=Math.min(p.time,p.flightEndTime??p.time),result=null;
 if(pitchPosition(p,lo)[2]>=impactPlane&&pitchPosition(p,hi)[2]<=impactPlane){
  for(let i=0;i<45;i++){const t=(lo+hi)/2;if(pitchPosition(p,t)[2]>impactPlane)lo=t;else hi=t;}
  const impactTime=(lo+hi)/2,impactPosition=pitchPosition(p,impactTime);
  result={impactTime,impactPosition,gazeTransitionTime:impactTime-trackingLead};
 }
 impactCache.set(p,result);return result;
};
window.pitchPracticeGaze=function(p,elapsed){
 const impact=pitchImpact(p),time=Math.max(0,Number.isFinite(elapsed)?elapsed:0);
 const end=Math.max(0,p.flightEndTime??p.time);
 const stopTime=impact?Math.max(0,Math.min(end,impact.gazeTransitionTime)):end;
 // Evaluate the exact stopping point, independent of frame rate and seeking.
 // After it, the camera holds this direction while the actual ball continues.
 return {stopTime,phase:time<stopTime?'tracking':'held',target:pitchPosition(p,Math.min(time,stopTime)),impact};
};
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
// center change; world coordinates and the physical clock do not.
window.catcherLensForViewport=function(width,height,{compact=true,eye=[0,.85,-1.75]}={}){
 const W=Math.max(1,width),H=Math.max(1,height),header=compact?0:100,foot=compact?0:132,sh=Math.max(1,H-header-foot);
 const top=header+(compact?(sh<300?Math.min(74,sh*.36):138):18);
 const bottom=header+sh-(compact?Math.min(48,sh*.18):18),marginX=Math.min(18,W*.08);
 const baseFocal=sh/(2*Math.tan(42*Math.PI/360));
 const depth=Math.max(.5,-eye[2]),xs=[(-.216+eye[0])/depth,(.216+eye[0])/depth],ys=[(eye[1]-1.10)/depth,(eye[1]-.50)/depth];
 const focal=Math.max(.01,Math.min(baseFocal*2.75,(bottom-top)/(ys[1]-ys[0]),(W-2*marginX)/(xs[1]-xs[0])));
 const centerX=W/2-(xs[0]+xs[1])*focal/2,centerY=(top+bottom)/2-(ys[0]+ys[1])*focal/2;
 return {zoom:focal/baseFocal,focal,centerX,centerY,bounds:{left:marginX,right:W-marginX,top,bottom}};
};
// Exact pinhole silhouette of a sphere, including off-axis ellipse and center shift.
window.projectSphere=function(position,eye,camera,focal,principalPoint,radius=.0366){
 const q=sub(position,eye),X=dot(q,camera.right),Y=-dot(q,camera.up),Z=dot(q,camera.forward),den=Z*Z-radius*radius;
 if(Z<=radius||den<=0)return null;
 const transverse=Math.hypot(X,Y),distance=Math.hypot(...q);
 return {center:[principalPoint[0]+focal*Z*X/den,principalPoint[1]+focal*Z*Y/den],minor:focal*radius/Math.sqrt(den),major:focal*radius*Math.sqrt(distance*distance-radius*radius)/den,angle:Math.atan2(Y,X),angularDiameter:2*Math.asin(Math.min(1,radius/distance))};
};
const clampEye=(v,min,max,fallback)=>Number.isFinite(v)?Math.max(min,Math.min(max,v)):fallback;
window.drawTrajectory=function(canvas,pitcher,pitches,options={}){
 // Interactive canvases use CSS pixels for all geometry and a larger backing
 // store for sharp output. Poster export keeps its original 1800 × 1120 layout.
 const compact=options.compact===true,pixelRatio=compact&&Number.isFinite(options.pixelRatio)&&options.pixelRatio>0?options.pixelRatio:1;
 let c=canvas.getContext('2d');const W=canvas.width/pixelRatio,H=canvas.height/pixelRatio;
 if(!c)throw new Error('投球画面を描画できません。この端末では Canvas 2D を利用できません。');
 c.save();c.setTransform(pixelRatio,0,0,pixelRatio,0,0);c.clearRect(0,0,W,H);
 const view=options.view||'catcher',progress=options.progress??1,trail=options.trail??true,realism=options.realism===true,showPaths=options.showPaths===true||(!realism&&options.showPaths!==false),ballSizeAid=!realism&&options.ballSizeAid!==false;
 // Review is a post-delivery display. Video and blind trials keep their own end.
 const endpointReview=options.endpointReview===true&&progress>=1&&!options.videoFrame;
 const maxTime=Math.max(...pitches.map(p=>p.flightEndTime??p.time),.01),elapsed=progress*maxTime;
 const gazeMode=!realism&&options.gazeMode==='follow'?'follow':'release',releaseTarget=pitchReleaseTarget(pitches);
 const pitcherTarget=options.pitcherTarget||pitchReleaseTarget(pitcher.pitches||[]);
 const fixedTarget=realism?pitcherTarget:(options.gazeMode==='selected'?releaseTarget:pitcherTarget);
 const header=compact?0:100,foot=compact?0:132,sh=H-header-foot;
 c.fillStyle='#f6f6f8';c.fillRect(0,0,W,H);c.fillStyle='#fff';c.fillRect(0,0,W,header);
 function txt(s,x,y,size=20,color='#1a2230',weight=400,align='left'){c.font=`${weight} ${size}px NotoLocal, sans-serif`;c.fillStyle=color;c.textAlign=align;c.fillText(s,x,y);}
 if(!compact){txt('ID東都',32,43,22,'#c8202b',700);txt(`${pitcher.name}  投球軌道`,176,44,29,'#161b26',700);
 txt(`${pitcher.teamLabel||pitcher.team}  /  ${pitcher.seasonLabel||'2026春'}季リーグ  /  ${realism?'実戦モード':'実投球の比較'}`,176,77,17,'#697180');}
 const vnames={catcher:'捕手視点',right:'右打者視点',left:'左打者視点'};
 if(!compact)txt(vnames[view],W-32,51,23,'#161b26',600,'right');
 let eye,target,fov,batter,gaze=null;
 if(view==='catcher'){const c=options.catcherEye||{};eye=[clampEye(c.side,-2,2,0),clampEye(c.height,.5,2.3,.85),clampEye(c.forward,-3,-.5,-1.75)];target=[eye[0],eye[1],14];fov=42;}
 if(view==='right'||view==='left'){batter=batterCamera(options.batterEye||{},view,gazeMode==='follow'?pitchAimTarget(pitches,elapsed,'follow'):fixedTarget,fixedTarget);({eye,target,fov}=batter);}
 if(realism&&batter&&!options.videoCamera&&!options.videoFrame&&!options.eye){
  const states=usablePitches(pitches).map(p=>({id:p.id,...pitchPracticeGaze(p,elapsed)}));
  const directionTo=point=>{const delta=sub(point,eye);return Math.hypot(...delta)>1e-8?norm(delta):[0,0,1];};
  const readyDirection=directionTo(fixedTarget);
  // The controller returns the gaze after the real-time hold, independently of ball time.
  if(options.practiceGazeReady===true||elapsed<=0){
   target=eye.map((v,i)=>v+readyDirection[i]);
   gaze=states.map(s=>({...s,phase:'ready'}));
  }else if(states.length){
   const tracked=centerOf(states.map(s=>directionTo(s.target)));
   // Acquire each real release continuously from the common ready direction.
   // 60 ms is display interpolation, not a physiological latency estimate.
   const acquisition=Math.min(.060,...states.map(s=>Math.max(.001,s.impact?.gazeTransitionTime??.060)));
   const u=Math.min(1,elapsed/acquisition),blend=u*u*(3-2*u);
   const mixed=readyDirection.map((v,i)=>v*(1-blend)+tracked[i]*blend);
   target=eye.map((v,i)=>v+mixed[i]);
   if(Math.hypot(...sub(target,eye))<1e-8)target=fixedTarget;
   gaze=states;
  }
 }
 if(!compact&&(view==='right'||view==='left'))txt(realism?'ボール追尾・終盤固定':gazeMode==='follow'?'ボールを追尾（試用）':'リリース方向に固定',W-32,79,15,'#697180',400,'right');
 if(batter&&Number.isFinite(options.batterFov))fov=Math.max(60,Math.min(120,options.batterFov));
 // A lens change magnifies the same physical scene; it does not shift the
 // eye, target, ball coordinates, or their common physical clock.
 const catcherLens=view==='catcher'?catcherLensForViewport(W,H,{compact,eye}):null;
 const zoom=catcherLens?catcherLens.zoom:Number.isFinite(options.zoom)?Math.max(1,Math.min(10,options.zoom)):9;
 // A screen-matched batter view uses the actual displayed canvas width and
 // viewing distance. This is a flat-screen pinhole projection, not a claim
 // to reproduce binocular vision or a batter's measured eye movements.
 // Catcher viewing fits the whole zone independently of batter calibration.
 const positive=(v,fallback)=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))&&Number(v)>0?Number(v):fallback;
 const projectionMode=batter&&options.projectionMode==='screen'?'screen':'wide';
 const screenWidthCm=positive(options.screenWidthCm,6.5),viewDistanceCm=positive(options.viewDistanceCm,35);
 const baseFocal=projectionMode==='screen'?W*viewDistanceCm/screenWidthCm:sh/(2*Math.tan(fov*Math.PI/360));
 let focal=catcherLens?catcherLens.focal:baseFocal*zoom,centerY=catcherLens?catcherLens.centerY:header+sh*.50;
 let centerX=catcherLens?catcherLens.centerX:W/2,videoRect=null;
 if(options.videoCamera){const v=options.videoCamera;eye=v.eye.slice();target=v.target.slice();const scale=Math.min(W/v.width,sh/v.height);videoRect={x:(W-v.width*scale)/2,y:header+(sh-v.height*scale)/2,width:v.width*scale,height:v.height*scale};focal=v.focal*scale;centerX=videoRect.x+v.principalPoint[0]*scale;centerY=videoRect.y+v.principalPoint[1]*scale;}
 fov=(Math.atan((centerY-header)/focal)+Math.atan((header+sh-centerY)/focal))*180/Math.PI;
 const horizontalFov=2*Math.atan(W/(2*focal))*180/Math.PI;
 if(options.eye){eye=options.eye;target=[0,0.9,8];}
 const {direction:forward,right,up}=cameraFrame(eye,target);
 fov=(Math.atan((centerY-header)/focal)+Math.atan((header+sh-centerY)/focal))*180/Math.PI;
 const project=p=>{const q=sub(p,eye),z=dot(q,forward);return z>0.08?[centerX+dot(q,right)*focal/z,centerY-dot(q,up)*focal/z,z]:null;};
 c.save();c.beginPath();c.rect(0,header,W,sh);c.clip();
 // Cache only the static field; balls, overlays and occlusion are never cached.
 const cacheKey=JSON.stringify([canvas.width,canvas.height,pixelRatio,header,sh,eye,target,focal,centerX,centerY]);
 let cached=backgroundCache.get(canvas),backgroundHit=false;
 if(options.videoFrame){c.fillStyle='#111';c.fillRect(0,header,W,sh);const r=videoRect||{x:0,y:header,width:W,height:sh};c.drawImage(options.videoFrame,r.x,r.y,r.width,r.height);}
 else if(cached?.key===cacheKey){c.drawImage(cached.image,0,0,W,H);backgroundHit=true;}
 else {
  const displayContext=c;
  // Reuse the backing store while gaze rotates instead of allocating each frame.
  const layer=typeof document!=='undefined'?(cached?.image||document.createElement('canvas')):null;
  if(layer){if(layer.width!==canvas.width)layer.width=canvas.width;if(layer.height!==canvas.height)layer.height=canvas.height;c=layer.getContext('2d');c.clearRect(0,0,layer.width,layer.height);c.setTransform(pixelRatio,0,0,pixelRatio,0,0);c.save();c.beginPath();c.rect(0,header,W,sh);c.clip();}
 const sky=c.createLinearGradient(0,header,0,header+sh);sky.addColorStop(0,'#7badd5');sky.addColorStop(.65,'#d6ecf5');sky.addColorStop(1,'#d6e0dc');c.fillStyle=sky;c.fillRect(0,header,W,sh);
 drawFieldGeometry(c,canvas,eye,forward,right,up,focal,centerX,centerY,W,header,sh);
  if(layer){c.restore();c=displayContext;c.drawImage(layer,0,0,W,H);backgroundCache.set(canvas,{key:cacheKey,image:layer});}
 }
 function line3(points,color,width=2,dash=[]){let pp=points.map(project);c.strokeStyle=color;c.lineWidth=width;c.setLineDash(dash);c.beginPath();let move=true;for(const p of pp){if(!p){move=true;continue;}if(move)c.moveTo(p[0],p[1]);else c.lineTo(p[0],p[1]);move=false;}c.stroke();c.setLineDash([]);}
 const seg=[];if(showPaths)for(const p of pitches){let end=trail?(p.flightEndTime??p.time):Math.min(elapsed,p.flightEndTime??p.time);const col=realism?'#40556b':pitchStyle(p.type)[2];for(let j=0;j<140;j++){let t=j/140*end,t1=(j+1)/140*end,a=project(pitchPosition(p,t)),b=project(pitchPosition(p,t1));if(a&&b)seg.push({a,b,col,alpha:trail&&t>elapsed?.25:1});}}
 seg.sort((a,b)=>(b.a[2]+b.b[2])-(a.a[2]+a.b[2]));for(const s of seg){c.beginPath();c.moveTo(s.a[0],s.a[1]);c.lineTo(s.b[0],s.b[1]);c.strokeStyle=s.col;c.globalAlpha=s.alpha;c.lineWidth=Math.max(compact?1.5:2.8,Math.min(12,focal*.018/s.a[2]));c.lineCap='round';c.stroke();}c.globalAlpha=1;
 // A reference zone; no batter-specific strike-zone measurements are present.
 if(!realism||endpointReview)for(let i=0;i<=3;i++){let x=-.216+i*.432/3;line3([[x,.50,0],[x,1.10,0]],'#29332f',i===0||i===3?3:1.4);let y=.5+i*.6/3;line3([[-.216,y,0],[.216,y,0]],'#29332f',i===0||i===3?3:1.4);}
 const aim=project(releaseTarget),inside=p=>!!p&&p[0]>=0&&p[0]<=W&&p[1]>=header&&p[1]<=header+sh;
 if(!realism&&batter&&pitches.length&&inside(aim)){c.beginPath();c.arc(aim[0],aim[1],compact?8:13,0,Math.PI*2);c.strokeStyle='#ffffffb3';c.lineWidth=1.5;c.setLineDash([3,3]);c.stroke();c.setLineDash([]);if(!compact)txt('リリース中心',aim[0]+21,aim[1]-14,15,'#30465c',500);}
 const projectedBalls=pitches.map(p=>{
  const time=Math.min(elapsed,p.flightEndTime??p.time),position=pitchPosition(p,time),q=project(position);
  const sphere=q?projectSphere(position,eye,{right,up,forward},focal,[centerX,centerY]):null;
  if(sphere){q[0]=sphere.center[0];q[1]=sphere.center[1];}
  const physicalRadius=sphere?sphere.minor:null;
  const radius=q?(ballSizeAid?Math.max(compact?2.5:5,Math.min(Math.max(23,Math.min(160,sh*.35)),physicalRadius)):physicalRadius):null;
  return {p,q,time,position,physicalRadius,radius,sphere,ended:realism&&elapsed>=(p.flightEndTime??p.time),occluded:typeof options.isOccluded==='function'&&options.isOccluded(p,time,q)};
 });
 const balls=projectedBalls.filter(x=>x.q&&(!x.ended||endpointReview)&&!x.occluded).sort((a,b)=>b.q[2]-a.q[2]);
 for(const ball of balls){const {p,q,time,radius,sphere}=ball;
  c.save();if(!ballSizeAid&&sphere){c.translate(q[0],q[1]);c.rotate(sphere.angle);c.scale(sphere.major/sphere.minor,1);c.rotate(-sphere.angle);c.translate(-q[0],-q[1]);}
  ball.renderSpinState=window.drawSpinningBaseball(c,{x:q[0],y:q[1],radius,pitch:p,elapsed:time,camera:{right,up,forward},color:pitchStyle(p.type)[2],outline:!realism,pixelRatio,seamVariant:options.seamVariant||0,seamExposure:options.seamExposure||0});
  c.restore();
 }

 // Confirmed body masks re-project source video above the CG sphere. Masks
 // are manual observations, never inferred from ball or pitch type.
 if(options.videoFrame&&videoRect)for(const mask of options.foregroundMasks||[]){
  const scale=videoRect.width/options.videoCamera.width;c.save();c.beginPath();mask.polygon.forEach((p,i)=>{const x=videoRect.x+p[0]*scale,y=videoRect.y+p[1]*scale;i?c.lineTo(x,y):c.moveTo(x,y);});c.closePath();c.clip();c.drawImage(options.videoFrame,videoRect.x,videoRect.y,videoRect.width,videoRect.height);c.restore();
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
 const visibleCount=projectedBalls.filter(({q,ended,occluded})=>inside(q)&&(!ended||endpointReview)&&!occluded).length;
 return {backgroundHit,endpointReview,gaze,camera:{eye:eye.slice(),target:target.slice(),fov,horizontalFov:2*Math.atan(W/(2*focal))*180/Math.PI,projectionMode,focal,zoom,principalPoint:[centerX,centerY],...(catcherLens?{zoneBounds:catcherLens.bounds}:{}),...(projectionMode==='screen'?{screenWidthCm,viewDistanceCm}:{})},referenceZone:[[-.216,.50,0],[.216,.50,0],[.216,1.10,0],[-.216,1.10,0]].map(project),elapsed,duration:maxTime,visibleCount,offscreenCount:pitches.length-visibleCount,releaseVisible:inside(aim),width:W,height:H,ballSizeAid,balls:projectedBalls.map(({p,q,time,position,physicalRadius,radius,sphere,ended,occluded,renderSpinState})=>({id:p.id,time,position,screenPoint:q?q.slice(0,2):null,depth:q?q[2]:null,physicalRadius,radius,silhouette:sphere,ended,endpointVisible:endpointReview&&ended&&!occluded&&inside(q),occluded,renderSpinState}))};
};
})();
