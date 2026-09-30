import {pitchPosition,positionAtDistance} from './model.mjs';
export function isZonePitch(p){
 if(!p?.validTrajectory||p.endsBeforePlate||(p.flightEndTime??p.time)<p.time-1e-6)return false;
 const [x,y]=pitchPosition(p,p.time);
 return Number.isFinite(x)&&Number.isFinite(y)&&x>=-.216&&x<=.216&&y>=.50&&y<=1.10;
}
// Select existing deliveries only. Rank distinct-type groups by their spatial
// separation before the plate, without translating or changing any trajectory.
export function chooseInitialPitches(pitcher,limit=3){
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
