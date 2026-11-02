(function(root){
 'use strict';
 const radius=.0366,dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),subtract=(a,b)=>a.map((v,i)=>v-b[i]);
 const angle=(a,b)=>Math.atan2(Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]),dot(a,b));
 root.pitchAngularTravel=function(before,after,middle,eye){
  const distance=Math.hypot(...subtract(middle,eye));if(distance<=radius)return null;
  return angle(subtract(before,eye),subtract(after,eye))/(2*Math.asin(radius/distance));
 };
 root.createPitchDiagnostics=function(metadata={},policy={}){
  const gapLimit=Number.isFinite(policy.maxGapMs)?policy.maxGapMs:50,frames=[];let previous=null,truncated=false;
  return {
   record(result,now,drawMs,hidden=false){
    if(hidden||!result||!Number.isFinite(now)){previous=null;return;}
    if(previous&&(result.elapsed<=previous.result.elapsed||JSON.stringify(result.camera)!==JSON.stringify(previous.result.camera)))previous=null;
    const gap=previous?now-previous.now:null,balls=[];
    for(const ball of result.balls||[]){
     const old=previous?.result.balls?.find(b=>b.id===ball.id);let travel=null;
     if(old&&ball.time>old.time){
      const p=root.StudioAdapter?.getState().current?.pitches.find(p=>p.id===ball.id);
      const middle=p&&root.pitchPosition?root.pitchPosition(p,(old.time+ball.time)/2):old.position.map((v,i)=>(v+ball.position[i])/2);
      travel=root.pitchAngularTravel(old.position,ball.position,middle,result.camera.eye);
     }
     balls.push({id:ball.id,time:ball.time,position:ball.position,screenPoint:ball.screenPoint,angularDiameter:ball.silhouette?.angularDiameter??null,physicalRadius:ball.physicalRadius,displayRadius:ball.radius,angularTravelInDiameters:travel,ended:!!ball.ended,occluded:!!ball.occluded,renderSpinState:ball.renderSpinState});
    }
    if(frames.length<4096)frames.push({time:result.elapsed,callbackTime:now,gapMs:gap,drawMs,backgroundHit:!!result.backgroundHit,camera:result.camera,balls});else truncated=true;
    previous={result,now};
   },
   report(){const gaps=frames.map(f=>f.gapMs).filter(Number.isFinite),maximum=gaps.length?Math.max(...gaps):null;
    return {version:1,metadata,frames,truncated,maxGapMs:maximum,comparisonEligible:!truncated&&frames.length>=2&&maximum!==null&&maximum<=gapLimit,exclusionPolicy:{maxGapMs:gapLimit,note:'比較結果の品質管理用の設定値。知覚限界ではありません。'},timing:'requestAnimationFrame callback/render timing; not measured display presentation'};
   }
  };
 };
 root.validateVideoCalibration=function(value){
  const point=p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite);
  if(!value||!point(value.eye)||!point(value.target)||Math.hypot(...subtract(value.eye,value.target))<.001||!Number.isFinite(value.focal)||value.focal<=0||!Number.isFinite(value.width)||value.width<=0||!Number.isFinite(value.height)||value.height<=0||!Array.isArray(value.principalPoint)||value.principalPoint.length!==2||!value.principalPoint.every(Number.isFinite))throw new Error('撮影カメラの位置・向き・焦点距離・映像寸法を確認してください');
  if(!Array.isArray(value.checks)||value.checks.length<6||new Set(value.checks.map(c=>JSON.stringify(c.world))).size<6)throw new Error('独立した6点以上の実測対応点が必要です');
  const forward=subtract(value.target,value.eye),norm=v=>v.map(x=>x/Math.hypot(...v));const f=norm(forward);if(Math.hypot(f[0],f[2])<1e-8)throw new Error('カメラが垂直を向いています');const right=norm([-f[2],0,f[0]]),up=[right[1]*f[2]-right[2]*f[1],right[2]*f[0]-right[0]*f[2],right[0]*f[1]-right[1]*f[0]];
  if(Math.hypot(...right)<.1)throw new Error('カメラの向きが無効です');
  for(const mask of value.occlusionMasks||[]){if(mask.ballBehindBodyConfirmed!==true||typeof mask.pitchId!=='string'||!Number.isFinite(mask.start)||!Number.isFinite(mask.end)||mask.start<0||mask.end<mask.start||!Array.isArray(mask.polygon)||mask.polygon.length<3||mask.polygon.some(p=>!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)))throw new Error('身体マスクの実測区間と前後関係を確認してください');}
  const errors=value.checks.map(check=>{
   if(!point(check.world)||!Array.isArray(check.pixel)||check.pixel.length!==2||!check.pixel.every(Number.isFinite))throw new Error('対応点を確認してください');
   const q=subtract(check.world,value.eye),z=dot(q,f);if(z<=0)throw new Error('対応点がカメラの背後です');
   return Math.hypot(value.principalPoint[0]+value.focal*dot(q,right)/z-check.pixel[0],value.principalPoint[1]-value.focal*dot(q,up)/z-check.pixel[1]);
  });
  const rms=Math.sqrt(errors.reduce((n,x)=>n+x*x,0)/errors.length);
  return {...value,reprojectionRmsPx:rms,reprojectionMaxPx:Math.max(...errors),validated:true};
 };
})(typeof window!=='undefined'?window:globalThis);
