import { useMemo } from 'react';
import type { Dataset, Row } from '../lib/dataset-types';
import { annotatePlateAppearances, isSwing, isStrikeEquivalent } from '../lib/scouting-analytics';
const ratio=(n:number,d:number)=>d?n/d:null;
const sum=(rows:Row[],key:string)=>rows.reduce((n,r)=>n+(Number(r[key])||0),0);
const mean=(values:number[])=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
const measured=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
export function leagueComparison(data:Dataset){
 const ordered=[...data.pitches].sort((a,b)=>String(a.gameId).localeCompare(String(b.gameId))||(a.pitchNo??0)-(b.pitchNo??0));
 const annotated=annotatePlateAppearances(ordered);
 return [...data.teams.map(t=>t.name),'リーグ平均'].map(name=>{
  const all=name==='リーグ平均';
  const bat=data.batters.filter(p=>all||p.team===name),pit=data.pitchers.filter(p=>all||p.team===name);
  const batting=annotated.filter(p=>all||p.batterTeam===name),pitching=annotated.filter(p=>all||p.pitcherTeam===name);
  const fs=batting.filter(p=>p._isPaFirstStrike),first=pitching.filter(p=>p._isPaFirstPitch),swings=pitching.filter(isSwing);
  const fair=batting.filter(p=>p.result==='インプレー'),ev=fair.filter(p=>measured(p.exitVelocity));
  const typed=fair.filter(p=>['GroundBall','LineDrive','FlyBall','Popup','Bunt'].includes(String(p.hitType)));
  const velocity=pitching.filter(p=>p.pitchType==='ストレート'&&measured(p.velocity)).map(p=>p.velocity as number);
  const pa=sum(bat,'pa'),ab=sum(bat,'ab');
  return {name,avg:ratio(sum(bat,'hits'),ab),slg:ratio(sum(bat,'hits')+sum(bat,'doubles')+2*sum(bat,'triples')+3*sum(bat,'homeRuns'),ab),k:ratio(sum(bat,'strikeouts'),pa),bb:ratio(sum(bat,'walks')+sum(bat,'hbp'),pa),fs:ratio(fs.filter(isSwing).length,fs.length),ev:mean(ev.map(p=>p.exitVelocity as number)),hard:ratio(ev.filter(p=>Number(p.exitVelocity)>=(data.league.hardHitThreshold??152.9)).length,ev.length),gb:ratio(typed.filter(p=>p.hitType==='GroundBall').length,typed.length),fb:ratio(typed.filter(p=>p.hitType==='FlyBall'||p.hitType==='Popup').length,typed.length),first:ratio(first.filter(isStrikeEquivalent).length,first.length),whiff:ratio(swings.filter(p=>p.result==='空振り').length,swings.length),allowed:ratio(sum(pit,'walks')+sum(pit,'hbp'),sum(pit,'pa')),velocity:mean(velocity),max:velocity.length?Math.max(...velocity):null};
 });
}
const groups:[string,[string,string,string,boolean][]][]=[
 ['打撃',[['avg','打率','decimal',true],['slg','長打率','decimal',true],['k','三振率','rate',false],['bb','四死球率','rate',true],['fs','FSスイング率','rate',true]]],
 ['打球',[['ev','平均打球速度（km/h）','number',true],['hard','強打率','rate',true],['gb','ゴロ率','rate',true],['fb','フライ率','rate',true]]],
 ['投球',[['first','初球ストライク率','rate',true],['whiff','空振り率','rate',true],['allowed','与四死球率','rate',false]]],
 ['球速',[['velocity','ストレート平均（km/h）','number',true],['max','ストレート最高（km/h）','number',true]]]
];
export default function LeagueComparison({data}:{data:Dataset}){
 const rows=useMemo(()=>leagueComparison(data),[data]);
 return <div className="league-comparison">{groups.map(([title,metrics])=><section key={title}><h2>{title}</h2><div className="table-scroll"><table className="data-table"><thead><tr><th>項目</th>{rows.map(r=><th key={r.name}>{r.name}</th>)}</tr></thead><tbody>{metrics.map(([key,label,format,higher])=>{
 const values=rows.slice(0,-1).map(r=>(r as Row)[key]).filter(measured);return <tr key={key}><th>{label}</th>{rows.map((r,i)=>{const v=(r as Row)[key] as number|null;const rank=v===null?null:1+values.filter(n=>higher?n>v:n<v).length;return <td key={r.name} className={i===rows.length-1?'league-average-cell':rank===1?'league-rank-first':rank===2?'league-rank-second':''}>{v===null?'—':format==='rate'?`${(v*100).toFixed(1)}%`:format==='decimal'?v.toFixed(3):v.toFixed(1)}</td>})}</tr>})}</tbody></table></div></section>)}<details className="chart-definition"><summary>集計条件</summary><p>リーグ平均は全記録の合算値です。最高球速はリーグ全体の最高値。色は大学間の上位2校（三振率・与四死球率は低い順、その他は高い順）。FSスイング率・ゴロ率・フライ率の高低は優劣を示しません。</p><p>FSは打席で最初のストライク相当球。初球ストライク率は打席初球のストライク相当球の割合。空振り率はスイングを分母とします。打球速度・強打率は計測済みインプレー、ゴロ率・フライ率は打球種別の記録済みインプレーが対象。フライにはポップフライを含みます。</p></details></div>;
}
