import { catcherX } from './catcher-view.ts';
import type { Dataset, Row } from './dataset-types.ts';
import { DEFAULT_ZONE as ZONE } from './scouting-analytics.ts';

// User's 2026 autumn plate-umpire memos, supplied 2026-09-17 and 2026-09-26. Exact game IDs,
// dates and both teams are checked; future games are never assigned by rotation.
export const UMPIRE_ASSIGNMENTS = [
  ['5ecf7804-f446-4d0e-9999-e24514f6a185','2026-09-08','立正大学','國學院大學','岩崎'],
  ['e7d32124-4801-42db-a9a9-45af606bcf6b','2026-09-09','國學院大學','立正大学','吉田'],
  ['e901d7dd-66fa-44d7-afc3-81d75a94b74b','2026-09-10','國學院大學','立正大学','大槻'],
  ['9a31c327-3a1e-4967-bf27-b9697f8bcd66','2026-09-09','東洋大学','亜細亜大学','福壽'],
  ['5833e511-9ac7-4759-b3fe-c1cddef76bfe','2026-09-10','亜細亜大学','東洋大学','寺尾'],
  ['723a31a5-4d73-4b62-8aa1-66f696860a74','2026-09-08','中央大学','青山学院大学','川合'],
  ['408de075-ce56-491e-a7d4-1221b0dcd78a','2026-09-09','青山学院大学','中央大学','石丸'],
  ['e11c8806-a948-40df-abfc-f2c4670766d4','2026-09-10','青山学院大学','中央大学','熊倉'],
  ['26184f26-271e-450b-87db-b18a0a533e27','2026-09-18','東洋大学','青山学院大学','吉田'],
  ['844da01e-4d2a-4ebc-ab43-0fd62c44be20','2026-09-18','立正大学','亜細亜大学','湯田'],
  ['9d464b82-3ccc-4002-8d69-b87e3cf8048d','2026-09-18','中央大学','國學院大學','石丸'],
  ['ad7b3b80-0af4-473b-a57b-66c15b5177fb','2026-09-24','青山学院大学','東洋大学','熊倉'],
  ['75ba3be9-caa5-4715-b40e-62c4d90e45b2','2026-09-24','亜細亜大学','立正大学','菅原'],
  ['b04e7d0c-7511-4d10-b192-06401e4f01f2','2026-09-24','國學院大學','中央大学','吉田'],
] as const;
// The 2026-09-25 CSV is not available yet. Keep the user's explicit memo without
// inventing a GameUID; apply it only to one exact date/home/away match after import.
export const UMPIRE_MEMOS_WITHOUT_GAME_ID = [
  ['2026-09-25','國學院大學','中央大学','福壽'],
] as const;
export type Take = Row & { actual: number; expected: number | null; umpire: string; plateX: number; plateZ: number };
export type Summary = ReturnType<typeof summarize>;
export function sampleLabel(n: number) { return n < 30 ? '参考' : n < 80 ? '低' : n < 150 ? '中' : '高'; }
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
export function isTaken(p: Row) { return p.result === '見逃しストライク' || p.result === 'ボール'; }
export function inside(p: Row) { return p.plateX >= ZONE.left && p.plateX <= ZONE.right && p.plateZ >= ZONE.bottom && p.plateZ <= ZONE.top; }
const state = (p: Row) => `${p.strikes === 2 ? 2 : 0}:${p.balls === 3 ? 3 : 0}`;

// Local empirical probability, no geometric/prior probability masquerading as
// league measurements. At least two reference games and effective n>=5.
export function localProbability(rows: Take[], x: number, z: number) {
  let sum=0, weights=0, squares=0; const games=new Set<string>();
  for (const p of rows) {
    const dx=(p.plateX-x)/0.085, dz=(p.plateZ-z)/0.095;
    if (Math.abs(dx)>3 || Math.abs(dz)>3) continue;
    const w=Math.exp(-0.5*(dx*dx+dz*dz)); sum+=w*p.actual; weights+=w; squares+=w*w; games.add(p.gameId);
  }
  const effective=squares ? weights*weights/squares : 0;
  return { probability: weights>=1 && effective>=5 ? sum/weights : null, effective, games:games.size };
}
export function buildUmpireAnalysis(data: Dataset) {
  const assignments=new Map<string,string>(); const mismatches:string[]=[];
  for(const [id,date,home,away,name] of UMPIRE_ASSIGNMENTS) {
    const g=data.games.find(g=>g.id===id); if(!g) continue;
    if(g.date!==date || g.homeTeam!==home || g.awayTeam!==away) { mismatches.push(name); continue; }
    assignments.set(id,name);
  }
  for(const [date,home,away,name] of UMPIRE_MEMOS_WITHOUT_GAME_ID) {
    const matches=data.games.filter(g=>g.date===date && g.homeTeam===home && g.awayTeam===away);
    if(!matches.length) continue;
    if(matches.length!==1 || (assignments.has(matches[0].id) && assignments.get(matches[0].id)!==name)) { mismatches.push(name); continue; }
    assignments.set(matches[0].id,name);
  }
  const ids=new Set<string>(); const takes:Take[]=[]; let missingLocation=0;
  for(const p of data.pitches) {
    if(!isTaken(p) || ids.has(p.id)) continue; ids.add(p.id);
    if(!finite(p.plateX)||!finite(p.plateZ)) {missingLocation++;continue;}
    takes.push({...p,plateX:p.plateX,plateZ:p.plateZ,actual:p.result==='見逃しストライク'?1:0,expected:null,umpire:assignments.get(p.gameId)??''});
  }
  const pools=new Map<string,Take[]>();
  for(const p of takes) {
    if(!p.umpire || !['右','左'].includes(p.batterSide) || !Number.isInteger(p.balls) || !Number.isInteger(p.strikes)) continue;
    const key=`${p.gameId}|${p.batterSide}|${state(p)}`;
    if(!pools.has(key)) pools.set(key,takes.filter(q=>q.gameId!==p.gameId && q.batterSide===p.batterSide && state(q)===state(p) && Number.isInteger(q.balls)&&Number.isInteger(q.strikes)));
    const model=localProbability(pools.get(key)!,p.plateX,p.plateZ);
    p.expected=model.games>=2?model.probability:null;
  }
  return {takes, assignments, mismatches, missingLocation, unknownGames:data.games.filter(g=>!assignments.has(g.id))};
}
export function summarize(rows: Take[]) {
  const n=rows.length, actual=rows.reduce((s,p)=>s+p.actual,0), supported=rows.filter(p=>p.expected!==null);
  const extra=supported.reduce((s,p)=>s+p.actual-p.expected!,0);
  const zone=rows.filter(inside), outside=rows.filter(p=>!inside(p));
  return {n, actual, games:new Set(rows.map(p=>p.gameId)).size, rate:n?actual/n:null, compared:supported.length,
    expected:supported.length?supported.reduce((s,p)=>s+p.expected!,0)/supported.length:null,
    comparedRate:supported.length?supported.reduce((s,p)=>s+p.actual,0)/supported.length:null,
    delta:supported.length?extra/supported.length:null, extra:supported.length?extra:null,
    zoneN:zone.length,zoneRate:zone.length?zone.reduce((s,p)=>s+p.actual,0)/zone.length:null,
    outsideN:outside.length,outsideRate:outside.length?outside.reduce((s,p)=>s+p.actual,0)/outside.length:null};
}
export type Perspective = 'umpire'|'batter';
// Keep optional batter-relative calculations inside-left; all site maps use catcher view.
export function displayX(p: Row, perspective: Perspective) {
  const x = catcherX(p.plateX);
  return perspective === 'batter' && p.batterSide === '左' ? -x : x;
}
export const REGIONS=['高め','低め','左','右','左上','右上','左下','右下'];
export function region(p: Take,perspective: Perspective) {
  const x=displayX(p,perspective), z=p.plateZ;
  if(Math.abs(x)>ZONE.right+.15||z<ZONE.bottom-.15||z>ZONE.top+.15)return '';
  const horizontal=x<0?'左':'右', vertical=z<0.75?'低め':'高め';
  const dx=Math.abs(Math.abs(x)-ZONE.right), dz=Math.min(Math.abs(z-ZONE.top),Math.abs(z-ZONE.bottom));
  if(Math.min(dx,dz)>.15)return '';
  if(dx<.15&&dz<.15)return horizontal+(z<.75?'下':'上');
  return dx<dz?horizontal:vertical;
}
export function displayRegion(label:string,p:Perspective){return p==='batter'?label.replace('左','内角').replace('右','外角'):label;}
export function heatCells(rows:Take[],perspective:Perspective) {
  return Array.from({length:49},(_,i)=>{
    const col=i%7,row=Math.floor(i/7),x0=-.65+col*1.3/7,z1=1.35-row*1.2/7;
    const pitches=rows.filter(p=>{const x=displayX(p,perspective);return x>=x0&&x<x0+1.3/7&&p.plateZ<=z1&&p.plateZ>z1-1.2/7;});
    return {i,x0,z1,...summarize(pitches)};
  });
}
// Find a supported 50% crossing along the midpoint of an edge. No conversion
// from percentage points to cm and no extrapolation through unsupported cells.
export function edgeCrossing(rows:Take[],edge:string) {
  const horizontal=edge==='左'||edge==='右', fixed=horizontal?.75:0;
  const start=horizontal?(edge==='左'?-.50:0):(edge==='低め'?.20:.75);
  const end=horizontal?(edge==='左'?0:.50):(edge==='低め'?.75:1.30);
  const near=rows.filter(p=>Math.abs((horizontal?p.plateZ:p.plateX)-fixed)<.15);
  if(near.length<20||near.filter(p=>p.actual===1).length<5||near.filter(p=>p.actual===0).length<5)return null;
  const hits:number[]=[]; let previous:{v:number;p:number}|null=null;
  for(let v=start;v<=end+.00001;v+=.01){
    const m=localProbability(near,horizontal?v:fixed,horizontal?fixed:v);
    if(m.probability===null){previous=null;continue;}
    if(previous&&(previous.p-.5)*(m.probability-.5)<0) hits.push(previous.v+(.5-previous.p)*(v-previous.v)/(m.probability-previous.p));
    previous={v,p:m.probability};
  }
  return hits.length===1?hits[0]:null;
}
export function edgeWidths(rows:Take[],reference:Take[],perspective:Perspective) {
  if(new Set(reference.map(p=>p.gameId)).size<2)return [];
  const projected=(rs:Take[])=>rs.map(p=>({...p,plateX:displayX(p,perspective)}));
  return ['高め','低め','左','右'].map(edge=>{const a=edgeCrossing(projected(rows),edge), b=edgeCrossing(projected(reference),edge);return {edge,cm:a===null||b===null?null:(a-b)*100*(edge==='低め'||edge==='左'?-1:1)};});
}
// Separate reference column, NOT a replacement of the existing framing metric.
// Estimate umpire residual using OTHER catchers only; do not deduct the target's
// own performance. Conservative shrinkage, and require 20 peer opportunities.
export function adjustedCatcher(rows:Take[],all:Take[]) {
  let adjusted=0,n=0; const cache=new Map<string,number|null>();
  for(const p of rows) {
    if(p.expected===null||!p.catcherId)continue;
    const key=`${p.umpire}|${p.catcherId}`;
    if(!cache.has(key)){
      const peer=all.filter(q=>q.umpire===p.umpire&&q.catcherId&&q.catcherId!==p.catcherId&&q.expected!==null);
      cache.set(key,peer.length>=20?peer.reduce((s,q)=>s+q.actual-q.expected!,0)/(peer.length+50):null);
    }
    const shift=cache.get(key);if(shift===null||shift===undefined)continue;
    adjusted+=p.actual-Math.max(0,Math.min(1,p.expected+shift));n++;
  }
  return {n,extra:n?adjusted:null,raw:n?rows.filter(p=>p.expected!==null&&cache.get(`${p.umpire}|${p.catcherId}`)!=null).reduce((s,p)=>s+p.actual-p.expected!,0):null};
}
