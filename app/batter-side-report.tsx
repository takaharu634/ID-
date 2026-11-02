'use client';
import { useId, useMemo, useState } from 'react';
import BatterPdfReport, { BatterPdfPage, type BatterReportProps } from './batter-pdf-report';
import { catcherGridIndex } from '../lib/catcher-view';
import { fieldSector } from '../lib/chart-geometry';
import type { Row } from '../lib/dataset-types';
import { BATTER_FAMILIES, batterFamily, reportAverage, reportContact, reportDirection, reportEV, reportZone, measuredEV, reportPlayer, reportPlayerGroups, reportOpponentSide } from '../lib/batter-side-report';
import { printReport } from './print-report';
import AnalysisPrintSelection from './analysis-print-selection';

const num = (n: number | null) => n === null ? '—' : n.toFixed(1);
const evColor = (n: number | null) => n === null ? '#ffffff' : n < 120 ? '#dce8f5' : n < 140 ? '#a6cae4' : n < 160 ? '#f4b571' : '#e96a5d';

function EVMap({ rows }: { rows: Row[] }) {
  return <svg viewBox="0 0 250 305" role="img" aria-label="捕手側から見たコース別平均打球速度と有効打球数">
    {Array.from({length:25},(_,i)=>{const v=reportEV(rows.filter(p=>reportZone(p)===i)); const x=catcherGridIndex(i,5)%5*50,y=Math.floor(i/5)*59.055118; return <g key={i}>
      <rect x={x} y={y} width="50" height="59.055118" fill={v.n>=5?evColor(v.avg):'#fff'} stroke="#c5d0d2"/>
      <text x={x+25} y={y+23} textAnchor="middle" fontSize="15" fontWeight="700">{num(v.avg)}</text>
      <text x={x+25} y={y+41} textAnchor="middle" fontSize="11" fill="#48595d">n={v.n}</text>
    </g>;})}
    <rect x="50" y="59.055118" width="150" height="177.165354" fill="none" stroke="#173e43" strokeWidth="2"/>
  </svg>;
}
function DirectionMap({ rows }: { rows: Row[] }) {
  const valid=rows.filter(p=>reportContact(p)&&Number.isFinite(p.sprayAngle??p.direction)&&Math.abs(p.sprayAngle??p.direction)<=90&&Number.isFinite(p.distance)&&p.distance>=0);
  const max=Math.max(120,...valid.map(p=>p.distance));
  return <div><svg viewBox="0 0 250 150" role="img" aria-label="打球方向・距離と打球速度">
    <path d={fieldSector(125,135,110)} fill="#f4f7f7" stroke="#b8c7ca"/>
    {valid.map((p,i)=>{const angle=(p.sprayAngle??p.direction)*Math.PI/180;const r=p.distance/max*110;return <circle key={i} cx={125+Math.sin(angle)*r} cy={135-Math.cos(angle)*r} r="3" fill={evColor(measuredEV(p)?p.exitVelocity:null)} stroke="#173e43" strokeWidth=".7"><title>{`${p.playResult}・${measuredEV(p)?p.exitVelocity:'—'} km/h・${p.distance} m`}</title></circle>;})}
    <text x="125" y="17" textAnchor="middle" fontSize="11">{Math.ceil(max)} m</text>
  </svg><div className="bs-directions">{['引張','中堅','逆方向'].map(d=>{const v=reportEV(rows.filter(p=>reportDirection(p)===d));return <span key={d}>{d}<b>{num(v.avg)}</b><small>n={v.n}</small></span>;})}</div></div>;
}
export default function BatterSideReport(props: BatterReportProps) {
  const [format,setFormat]=useState('pdf');
  return <div><AnalysisPrintSelection key={`${props.perspective || 'batter'}|${props.label}|${format}`} pitches={props.pitches} perspective={props.perspective || 'batter'} kind="batter-side" renderPages={rows=>format==='pdf'?<BatterPdfPage {...props} rows={rows}/>:<BatterSideDetail {...props} pitches={rows}/>}/><div className="bs-format" role="group" aria-label={props.perspective==='pitcher'?'左右別打者分析（投手）の表示形式':'左右別打者分析の表示形式'}><button type="button" aria-pressed={format==='pdf'} onClick={()=>setFormat('pdf')}>PDF形式</button><button type="button" aria-pressed={format==='detail'} onClick={()=>setFormat('detail')}>球種別の詳細（打球速度・方向）</button></div>{format==='pdf'?<BatterPdfReport {...props}/>:<BatterSideDetail {...props}/>}</div>;
}
export function BatterSideDetail({ pitches, label, locationPlot, legend, perspective='batter' }: BatterReportProps) {
  const id=useId().replace(/[^a-zA-Z0-9_-]/g,'');
  const groups=useMemo(()=>reportPlayerGroups(pitches,perspective),[pitches,perspective]);
  const isPitcher=perspective==='pitcher',title=isPitcher?'左右別打者分析（投手）':'左右別打者分析',opponent=isPitcher?'打者':'投手';
  return <section id={`bs-${id}`} className="bs-report">
    <div className="bs-actions"><h2>{title}</h2><button className="secondary-button" disabled={!groups.length} onClick={()=>printReport(`#bs-${id}`,'batter-side')}>A4横で印刷（{groups.length}人）</button></div>
    {!groups.length&&<p>対象データがありません。</p>}
    {groups.map(rows=>{const p=reportPlayer(rows[0],perspective);return <article className="bs-sheet" key={p.key}>
      <header className="bs-heading"><div><h2>{p.name}</h2><span>{p.team}・{[...new Set(rows.map(r=>reportPlayer(r,perspective).side))].join('/')}{isPitcher?'投':'打'}</span></div><div><strong>{title}</strong><span>{label}・{rows.length}球</span></div></header>
      <div className="bs-halves">{['右','左'].map(side=><section key={side} className="bs-half"><h3>対{side}{opponent}</h3>{BATTER_FAMILIES.map(f=>{const subset=rows.filter(r=>reportOpponentSide(r,perspective)===side&&batterFamily(r.pitchType)===f);const ev=reportEV(subset);return <section className="bs-family" key={f}>
        <header><strong>{f}</strong><b>{reportAverage(subset)}</b><span>{subset.length}球</span></header>
        <div className="bs-plots"><div><h4>投球結果</h4>{locationPlot(subset,rows)}</div><div><h4>平均打球速度</h4><EVMap rows={subset}/></div><div><h4>打球方向</h4><DirectionMap rows={subset}/></div></div>
        <footer><span>平均 {num(ev.avg)}</span><span>最高 {num(ev.max)} km/h</span><span>有効打球 {ev.n}</span><span>位置不明 {subset.filter(r=>reportZone(r)===null).length}</span><span>方向不明 {subset.filter(r=>reportContact(r)&&(!Number.isFinite(r.sprayAngle??r.direction)||!Number.isFinite(r.distance))).length}</span></footer>
      </section>;})}</section>)}</div>
      <div className="bs-key">{legend}<span>捕手側から見た図・◎安打</span><span>打球速度 km/h：<i style={{background:evColor(100)}}/>120未満 <i style={{background:evColor(130)}}/>120–139 <i style={{background:evColor(150)}}/>140–159 <i style={{background:evColor(170)}}/>160以上 □未計測</span></div>
      {rows.some(r=>!['右','左'].includes(reportOpponentSide(r,perspective))||batterFamily(r.pitchType)==='その他')&&<small>{opponent}左右不明 {rows.filter(r=>!['右','左'].includes(reportOpponentSide(r,perspective))).length}球・その他球種 {rows.filter(r=>batterFamily(r.pitchType)==='その他').length}球</small>}
    </article>;})}
  </section>;
}
