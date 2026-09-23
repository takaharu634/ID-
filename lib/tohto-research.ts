import type { Dataset, Row } from './dataset-types';
import { LEGACY_PITCH_VELOCITY } from './legacy-pitch-velocity.js';
export const RESEARCH_VERSION = 'tohto-research-2026-09-v1';
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const hit = (p:Row) => ['単打','二塁打','三塁打','本塁打'].includes(p.playResult);
export const isSwing = (p:Row) => ['空振り','ファウル','ファウルフライ','インプレー'].includes(p.result);
const identity = (s:unknown) => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s,，.．・'’\-_]/g,'');
export function researchPitchType(p:Row): string {
  if (p.playerRulesApplied) return p.pitchType;
  const raw = p.rawPitchTypeDisplay || p.pitchType;
  const legacy=(LEGACY_PITCH_VELOCITY as Record<string,number|null>)[p.id];
  const velocity = finite(p.rawVelocity) ? p.rawVelocity : finite(legacy) ? legacy : p.velocity;
  if (p.pitcherTeam === '立正大学' && identity(p.pitcher) === 'nitaharuto' && ['ストレート','シンカー'].includes(raw) && finite(velocity)) return velocity >= 145 ? 'ストレート' : 'シンカー';
  if (p.pitcherTeam === '國學院大學' && identity(p.pitcher) === 'fujimotoshisei' && finite(velocity) && velocity <= 120) return 'チェンジアップ';
  return p.pitchType;
}
export function proportion(success:number,n:number) {
  if (!n) return {success,n,rate:null,low:null,high:null};
  const rate=success/n,z=1.96,den=1+z*z/n,center=(rate+z*z/(2*n))/den,half=z*Math.sqrt(rate*(1-rate)/n+z*z/(4*n*n))/den;
  return {success,n,rate,low:Math.max(0,center-half),high:Math.min(1,center+half)};
}
export type Rate = ReturnType<typeof proportion>;
export type ThresholdKind = 'ivb'|'ground';
export function thresholdRows(pitches:Row[],kind:ThresholdKind) {
  return pitches.filter(p=>kind==='ivb'
    ? researchPitchType(p)==='ストレート' && finite(p.plateX) && finite(p.plateZ) && Math.abs(p.plateX)<=.254 && p.plateZ>=.85 && p.plateZ<=1.05 && finite(p.ivb) && isSwing(p)
    : p.result==='インプレー' && p.hitType==='GroundBall' && finite(p.exitVelocity) && p.exitVelocity>0);
}
const valueOf = (p:Row,kind:ThresholdKind):number => kind==='ivb'?p.ivb:p.exitVelocity;
function rateFor(rows:Row[],kind:ThresholdKind) {return proportion(rows.filter(p=>kind==='ivb'?p.result==='空振り':hit(p)).length,rows.length);}
export function thresholdCompare(pitches:Row[],kind:ThresholdKind,boundary:number) {
  const rows=thresholdRows(pitches,kind),lower=rows.filter(p=>valueOf(p,kind)<boundary),upper=rows.filter(p=>valueOf(p,kind)>=boundary);
  const a=rateFor(lower,kind),b=rateFor(upper,kind),role=kind==='ivb'?'pitcherId':'batterId';
  const lowerPlayers=new Set(lower.map(p=>p[role]).filter(Boolean)).size,upperPlayers=new Set(upper.map(p=>p[role]).filter(Boolean)).size;
  return {boundary,lower:a,upper:b,lowerPlayers,upperPlayers,difference:a.rate===null||b.rate===null?null:b.rate-a.rate,qualified:a.n>=50&&b.n>=50&&lowerPlayers>=5&&upperPlayers>=5};
}
export function thresholdStudy(training:Row[],validation:Row[],kind:ThresholdKind) {
  const candidates=(kind==='ivb'?[35,40,45,50,55,60]:[120,130,140,150,160,170]).map(v=>thresholdCompare(training,kind,v));
  const selected=candidates.filter(c=>c.qualified && c.difference!==null && c.difference>0).sort((a,b)=>b.difference!-a.difference!)[0] || null;
  return {candidates,selected,validation:selected?thresholdCompare(validation,kind,selected.boundary):null};
}
export function thresholdBins(pitches:Row[],kind:ThresholdKind) {
  const groups=new Map<number,Row[]>(),step=kind==='ivb'?5:10;
  for (const p of thresholdRows(pitches,kind)) {const key=Math.floor(valueOf(p,kind)/step)*step;groups.set(key,[...(groups.get(key)||[]),p]);}
  return [...groups].sort(([a],[b])=>a-b).map(([start,rows])=>({start,end:start+step,...rateFor(rows,kind)}));
}
export function pearson(pairs:{x:number;y:number}[]):number|null {
  if (pairs.length<2) return null;
  const x=pairs.reduce((s,p)=>s+p.x,0)/pairs.length,y=pairs.reduce((s,p)=>s+p.y,0)/pairs.length;
  const vx=pairs.reduce((s,p)=>s+(p.x-x)**2,0),vy=pairs.reduce((s,p)=>s+(p.y-y)**2,0);
  return vx===0||vy===0?null:pairs.reduce((s,p)=>s+(p.x-x)*(p.y-y),0)/Math.sqrt(vx*vy);
}
export function isOuterBreaking(p:Row) {
  return !['ストレート','不明','その他',''].includes(researchPitchType(p)) && finite(p.plateX) && (p.batterSide==='右'?p.plateX<-.25:p.batterSide==='左'?p.plateX>.25:false);
}
function chasePlayers(pitches:Row[]) {
  const groups=new Map<string,{name:string;team:string;ids:Set<string>;rows:Row[]}>();
  for (const p of pitches) {
    const normalized=identity(p.batterKanji || p.batter);if (!normalized || !p.batterTeam) continue;
    const key=`${p.batterTeam}|${normalized}`;
    if (!groups.has(key)) groups.set(key,{name:p.batterKanji||p.batter,team:p.batterTeam,ids:new Set(),rows:[]});
    const g=groups.get(key)!;if (p.batterId) g.ids.add(p.batterId);if(isOuterBreaking(p)) g.rows.push(p);
  }
  return groups;
}
export function chaseStability(before:Row[],after:Row[],minimum=20) {
  const a=chasePlayers(before),b=chasePlayers(after);let ambiguous=0;
  const pairs=[];
  for (const [key,old] of a) {
    const next=b.get(key);if (!next) continue;
    if (old.ids.size!==1||next.ids.size!==1) {ambiguous++;continue;}
    const first=proportion(old.rows.filter(isSwing).length,old.rows.length),second=proportion(next.rows.filter(isSwing).length,next.rows.length);
    if (!first.n || !second.n) continue;
    pairs.push({key,name:old.name,team:old.team,before:first,after:second,qualified:first.n>=minimum&&second.n>=minimum});
  }
  const qualified=pairs.filter(p=>p.qualified),r=qualified.length>=10?pearson(qualified.map(p=>({x:p.before.rate!,y:p.after.rate!}))):null;
  return {pairs:pairs.sort((a,b)=>Number(b.qualified)-Number(a.qualified)||b.before.n+b.after.n-a.before.n-a.after.n),qualified:qualified.length,r,ambiguous};
}
export function droppingStudy(data:Dataset) {
  const rows=data.teams.map(team=>{
    const pitches=data.pitches.filter(p=>p.pitcherTeam===team.name),known=pitches.filter(p=>!['不明','その他',''].includes(researchPitchType(p)));
    const dropped=known.filter(p=>['フォーク','チェンジアップ'].includes(researchPitchType(p))).length;
    const games=data.games.filter(g=>g.homeTeam===team.name||g.awayTeam===team.name);let wins=0,losses=0,ties=0,missing=0;
    for(const g of games) {if(!finite(g.homeRuns)||!finite(g.awayRuns)){missing++;continue;} const diff=(g.homeRuns-g.awayRuns)*(g.homeTeam===team.name?1:-1);if(diff>0)wins++;else if(diff<0)losses++;else ties++;}
    return {name:team.name,usage:proportion(dropped,known.length),unknown:pitches.length-known.length,wins,losses,ties,missing,winRate:wins+losses?wins/(wins+losses):null};
  });
  const valid=rows.filter(r=>r.usage.rate!==null&&r.winRate!==null);
  return {rows,r:valid.length>=5?pearson(valid.map(r=>({x:r.usage.rate!,y:r.winRate!}))):null};
}
export function mixDistance(a:Row[],b:Row[]) {
  if (!a.length || !b.length) return 0;
  const types = new Set([...a,...b].map(researchPitchType));
  return [...types].reduce((s,type)=>s+Math.abs(a.filter(p=>researchPitchType(p)===type).length/a.length-b.filter(p=>researchPitchType(p)===type).length/b.length),0)/2;
}

function outcome(rows:Row[]) {
  const swings=rows.filter(isSwing); const endings=rows.filter(p=>p.result==='インプレー'||p.korbb==='Strikeout');
  return {whiff:proportion(swings.filter(p=>p.result==='空振り').length,swings.length),hit:proportion(endings.filter(hit).length,endings.length)};
}
export function repeatMatchupStudy(data:Dataset,minimum=5,changeBoundary=.15) {
  const dates=new Map<string,Set<string>>();
  for (const p of data.pitches) { if (!p.gameId || !p.date || !Number.isFinite(Date.parse(p.date))) continue; const d = new Date(p.date).toISOString().slice(0,10); if (!dates.has(p.gameId)) dates.set(p.gameId,new Set()); dates.get(p.gameId)!.add(d); }
  const cards=new Map<string,Row[]>();let excludedGames=0;
  for (const original of data.games) {
    const recovered=dates.get(original.id);const date=Number.isFinite(Date.parse(original.date))?original.date:recovered?.size===1?[...recovered][0]:null;
    if (!date) {excludedGames++;continue;}
    const g:Row={...original,date},key=[g.homeTeam,g.awayTeam].sort().join('|');cards.set(key,[...(cards.get(key)||[]),g]);
  }
  const series=new Map<string,{series:string;order:number;date:string}>();
  for (const [card,games] of cards) {
    games.sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)||String(a.id).localeCompare(String(b.id)));
    let start='',previous=0,order=0;
    for (const g of games) {const t=Date.parse(g.date);if(!Number.isFinite(t))continue;if(!previous||t-previous>7*86400000){start=g.id;order=0;}order++;previous=t;series.set(g.id,{series:`${card}|${start}`,order,date:g.date});}
  }
  const groups=new Map<string,Map<number,Row[]>>();
  for(const p of data.pitches) {const s=series.get(p.gameId);if(!s||!p.pitcherId||!p.batterId)continue;const key=`${s.series}|${p.pitcherId}|${p.batterId}`;if(!groups.has(key))groups.set(key,new Map());const g=groups.get(key)!;g.set(s.order,[...(g.get(s.order)||[]),p]);}
  const comparisons: {key:string;order:number;pitcher:string;batter:string;team:string;firstN:number;laterN:number;distance:number;changed:boolean;before:ReturnType<typeof outcome>;after:ReturnType<typeof outcome>;priorHit:boolean}[]=[];
  for(const [key,g] of groups) {
    const meetings=[...g].sort(([a],[b])=>a-b),first=meetings[0]?.[1];if(!first||first.length<minimum)continue;
    for(let index=1;index<Math.min(3,meetings.length);index++) {
      const later=meetings[index][1];if(later.length<minimum)continue;const order=index+1,distance=mixDistance(first,later);
      comparisons.push({key:`${key}|${order}`,order,pitcher:first[0].pitcherKanji||first[0].pitcher,batter:first[0].batterKanji||first[0].batter,team:first[0].pitcherTeam,firstN:first.length,laterN:later.length,distance,changed:distance>=changeBoundary,before:outcome(first),after:outcome(later),priorHit:first.some(hit)});
    }
  }

  const summaries=[false,true].map(changed=>{
    const rows=comparisons.filter(r=>r.changed===changed);
    const rate=(period:'before'|'after',metric:'whiff'|'hit')=>proportion(rows.reduce((s,r)=>s+r[period][metric].success,0),rows.reduce((s,r)=>s+r[period][metric].n,0));
    return {changed,n:rows.length,before:rate('before','whiff'),after:rate('after','whiff'),beforeHit:rate('before','hit'),afterHit:rate('after','hit')};
  });
  return {excludedGames,comparisons:comparisons.sort((a,b)=>b.distance-a.distance),summaries};
}
