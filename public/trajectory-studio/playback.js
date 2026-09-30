(function(){
'use strict';
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
const finite=(value,fallback)=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))?Number(value):fallback;
const endTime=p=>Math.max(0,Math.min(Number(p.time),finite(p.flightEndTime,Number(p.time))));
const isPitch=p=>p&&p.validTrajectory!==false&&Number.isFinite(Number(p.time))&&Number(p.time)>0&&Array.isArray(p.c)&&p.c.length===3&&p.c.every(c=>Array.isArray(c)&&c.length===3&&c.every(Number.isFinite));
const poly=(c,t)=>c[0]+c[1]*t+c[2]*t*t;
/**
 * Shared display clock for all compared pitches. Positions are always evaluated
 * at the same physical time; this function never changes trajectory data.
 * In `near` mode, dt/d(display time) eases from 1 to endSpeed during the
 * anchor pitch's last startDistance metres. It never exceeds real time.
 */
window.makePlaybackTimeline=function(pitches=[],options={}){
 const valid=pitches.filter(isPitch),anchor=valid[0]||null;
 const physicalDuration=Math.max(.01,...valid.map(endTime));
 const requestedMode=options.mode==='near'?'near':'real';
 const mode=anchor?requestedMode:'real';
 const endSpeed=clamp(finite(options.endSpeed,.5),.2,1);
 const startDistance=Math.max(.01,finite(options.startDistance,5));
 const boundedPhysical=value=>clamp(finite(value,0),0,physicalDuration);
 const anchorEnd=anchor?endTime(anchor):0;
 const anchorHome=anchor?poly(anchor.c[0],Number(anchor.time)):0;
 const anchorDistanceAtPhysical=value=>anchor?Math.max(0,poly(anchor.c[0],clamp(boundedPhysical(value),0,anchorEnd))-anchorHome):null;
 const rateAtPhysical=value=>{
  if(mode!=='near'||endSpeed===1)return 1;
  const u=clamp(1-anchorDistanceAtPhysical(value)/startDistance,0,1);
  const eased=u*u*(3-2*u);
  return Math.max(endSpeed,1-(1-endSpeed)*eased);
 };
 const base={mode,physicalDuration,endSpeed,startDistance,anchorId:anchor?.id??null,rateAtPhysical,anchorDistanceAtPhysical};
 if(mode==='real'||endSpeed===1){
  return {...base,duration:physicalDuration,toPhysical:boundedPhysical,toPlayback:boundedPhysical};
 }
 // Integrate display seconds = integral(physical seconds / display rate).
 // A dense monotone LUT keeps forward and inverse seeking consistent.
 const count=4096,physical=new Float64Array(count+1),playback=new Float64Array(count+1);
 let previousInvRate=1/rateAtPhysical(0);
 for(let i=1;i<=count;i++){
  physical[i]=physicalDuration*i/count;
  const invRate=1/rateAtPhysical(physical[i]);
  playback[i]=playback[i-1]+(physical[i]-physical[i-1])*(previousInvRate+invRate)/2;
  previousInvRate=invRate;
 }
 const duration=playback[count];
 const interpolate=(value,from,to)=>{
  const x=clamp(finite(value,0),0,from[count]);
  if(x<=0)return 0;
  if(x>=from[count])return to[count];
  let lo=0,hi=count;
  while(hi-lo>1){const mid=(lo+hi)>>1;if(from[mid]<=x)lo=mid;else hi=mid;}
  const fraction=(x-from[lo])/(from[hi]-from[lo]);
  return to[lo]+(to[hi]-to[lo])*fraction;
 };
 return {...base,duration,toPhysical:value=>interpolate(value,playback,physical),toPlayback:value=>interpolate(value,physical,playback)};
};
})();
