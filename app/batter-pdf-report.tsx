'use client';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { catcherGridIndex } from '../lib/catcher-view';
import { BattedBallDirectionChart, BattedDirectionLegend } from './batted-ball-direction';
import type { Row } from '../lib/dataset-types';
import { BATTER_FAMILIES, batterFamily, reportAverage, reportContact, reportNineZone, reportRate, reportRisp, reportStats, reportPlayer, reportPlayerGroups, reportOpponentSide, reportPeriod, type ReportPerspective } from '../lib/batter-side-report';
import { printReport } from './print-report';

export type BatterReportProps = { pitches: Row[]; label: string; locationPlot: (rows: Row[], scaleRows: Row[])=>ReactNode; legend: ReactNode; pitchColors?: Record<string,string>; perspective?: ReportPerspective };
const counts=['0-0','1-0','2-0','3-0','0-1','1-1','2-1','3-1','0-2','1-2','2-2','3-2'];
const mixOf=(rows:Row[])=>[...new Set(rows.map(p=>p.pitchType||'不明'))].map(type=>({type,n:rows.filter(p=>(p.pitchType||'不明')===type).length})).sort((a,b)=>b.n-a.n);

function NineMap({rows,frequency=false}:{rows:Row[];frequency?:boolean}) {
  return <svg viewBox="0 0 240 240" role="img" aria-label={frequency?'9エリア別投球数と全投球に対する割合':'9エリア別打数・安打・打率・本塁打・三振'}>{Array.from({length:9},(_,i)=>{
    const subset=rows.filter(p=>reportNineZone(p)===i),s=reportStats(subset),x=catcherGridIndex(i,3)%3*80,y=Math.floor(i/3)*80;
    const share=rows.length?subset.length/rows.length:0;
    return <g key={i}><rect x={x} y={y} width="80" height="80" stroke="#9aa9b2" fill={frequency&&subset.length?(share>=.15?'#f8d2cb':share<.1?'#cce9eb':'#fff'):'#fff'}/>
      {frequency?<><text x={x+40} y={y+34} textAnchor="middle" fontSize="23" fontWeight="700">{subset.length}</text><text x={x+40} y={y+59} textAnchor="middle" fontSize="16">{rows.length?`${(share*100).toFixed(1)}%`:'—'}</text></>:<>
        <text x={x+40} y={y+18} textAnchor="middle" fontSize="16">{s.ab}–{s.hits}</text><text x={x+40} y={y+40} textAnchor="middle" fontSize="20" fontWeight="700" fill={s.ab>=5&&s.avg!==null&&s.avg>=.3?'#b52b35':'#173e43'}>{reportRate(s.avg)}</text>
        <text x={x+40} y={y+57} textAnchor="middle" fontSize="13">HR:{s.hr} K:{s.k}</text><text x={x+40} y={y+73} textAnchor="middle" fontSize="11" fill="#53616c">{s.ab>0&&s.ab<5?'少数':' '}</text>
      </>}</g>;
  })}</svg>;
}
function Spray({rows}:{rows:Row[]}) {
  return <div><BattedBallDirectionChart rows={rows} compact/></div>;
}
function FamilyTable({rows}:{rows:Row[]}) {
  return <div className="bp-families">{BATTER_FAMILIES.map(f=>{const subset=rows.filter(p=>batterFamily(p.pitchType)===f),s=reportStats(subset);const contact=subset.filter(reportContact);return <section key={f}><h4>{f} <b>{reportAverage(subset)}</b></h4><p>HR:{s.hr}　K:{s.k}　{ subset.length}球</p><p>ゴ:{contact.filter(p=>p.hitType==='GroundBall').length}　フ:{contact.filter(p=>['FlyBall','Popup'].includes(p.hitType)).length}　ラ:{contact.filter(p=>p.hitType==='LineDrive').length}　他:{contact.filter(p=>!['GroundBall','FlyBall','Popup','LineDrive'].includes(p.hitType)).length}</p></section>;})}</div>;
}
function PitchMix({rows,colors}:{rows:Row[];colors:Record<string,string>}) {
  const mix=mixOf(rows);
  const arcs=mix.reduce<{type:string;start:number;end:number}[]>((result,{type,n})=>{
    const start=result.length?result[result.length-1].end:-Math.PI/2;
    result.push({type,start,end:start+n/rows.length*Math.PI*2});
    return result;
  },[]);
  return <div className="bp-mix"><svg viewBox="0 0 200 180" role="img" aria-label="球種割合"><circle cx="100" cy="85" r="70" fill="#edf0f2"/>{arcs.map(({type,start,end})=>{const path=`M100 85 L${100+70*Math.cos(start)} ${85+70*Math.sin(start)} A70 70 0 ${end-start>Math.PI?1:0} 1 ${100+70*Math.cos(end)} ${85+70*Math.sin(end)} Z`;return <g key={type}>{mix.length===1?<circle cx="100" cy="85" r="70" fill={colors[type]||'#7a7f86'}/>:<path d={path} fill={colors[type]||'#7a7f86'} stroke="white" strokeWidth="1"/>}</g>;})}<text x="100" y="177" textAnchor="middle" fontSize="16">投球数：{rows.length}球</text></svg><div className="bp-mix-key">{mix.map(({type,n})=><span key={type}><i style={{background:colors[type]||'#7a7f86'}}/>{type} {n}（{(n/rows.length*100).toFixed(1)}%）</span>)}</div></div>;
}
function CountChart({rows,colors}:{rows:Row[];colors:Record<string,string>}) {
  const mix=mixOf(rows),groups=counts.map(c=>rows.filter(p=>`${p.balls}-${p.strikes}`===c));const max=Math.max(4,Math.ceil(Math.max(0,...groups.map(g=>g.length))/4)*4);
  return <svg viewBox="0 0 430 220" role="img" aria-label="カウント別の球種・投球数（投球前のボール数−ストライク数）">{[0,.25,.5,.75,1].map(t=><g key={t}><line x1="30" x2="426" y1={185-t*160} y2={185-t*160} stroke="#cad3d8"/><text x="26" y={189-t*160} textAnchor="end" fontSize="12">{Math.round(max*t)}</text></g>)}{groups.map((g,i)=>{let y=185;return <g key={counts[i]}>{mix.map(({type})=>{const n=g.filter(p=>(p.pitchType||'不明')===type).length,h=n/max*160;y-=h;return <rect key={type} x={36+i*32.4} y={y} width="21" height={h} fill={colors[type]||'#7a7f86'}/>;})}<text x={46+i*32.4} y="205" textAnchor="middle" fontSize="12">{counts[i]}</text></g>;})}</svg>;
}
function StatsTable({rows}:{rows:Row[]}) {
  const all=reportStats(rows),rispRows=reportRisp(rows),risp=reportStats(rispRows);
  const metrics:[string, keyof typeof all,boolean][]=[['打数','ab',false],['安打','hits',false],['本塁打','hr',false],['打点','rbi',false],['打率','avg',true],['長打率','slg',true],['出塁率','obp',true]];
  return <table className="bp-stats"><thead><tr><th scope="col">成績</th><th scope="col">通算</th><th scope="col">得点圏（推定）</th></tr></thead><tbody>{metrics.map(([name,key,rate])=><tr key={name}><th scope="row">{name}</th>{[all,risp].map((s,i)=><td key={i}>{rate?reportRate(s[key] as number|null):s[key]===null?'—':String(s[key])}</td>)}</tr>)}</tbody></table>;
}
export default function BatterPdfReport({pitches,label,locationPlot,legend,pitchColors={},perspective='batter'}:BatterReportProps) {
  const id=useId().replace(/[^a-zA-Z0-9_-]/g,'');
  const groups=useMemo(()=>reportPlayerGroups(pitches,perspective),[pitches,perspective]);
  const keyOf=(p:Row)=>reportPlayer(p,perspective).key;
  const isPitcher=perspective==='pitcher';
  const [selected,setSelected]=useState('');const current=groups.find(g=>keyOf(g[0])===selected)||groups[0];
  return <section className="bs-report bp-report" id={`bp-${id}`}><div className="bs-actions"><label>{isPitcher?'表示する投手':'表示する選手'} <select value={current?keyOf(current[0]):''} onChange={e=>setSelected(e.target.value)} disabled={!groups.length}>{!groups.length&&<option value="">対象なし</option>}{groups.map(g=><option key={keyOf(g[0])} value={keyOf(g[0])}>{reportPlayer(g[0],perspective).name}（{reportPlayer(g[0],perspective).team}）</option>)}</select></label><button className="secondary-button" disabled={!current} onClick={()=>printReport(`#bp-${id}`,'batter-side')}>{isPitcher?'この投手をA4横で印刷':'この選手をA4横で印刷'}</button></div>
    {!current?<p>対象データがありません。選手・期間・検索条件を確認してください。</p>:<BatterPdfPage perspective={perspective} rows={current} label={label} locationPlot={locationPlot} legend={legend} pitchColors={pitchColors}/>}
  </section>;
}

export function BatterPdfPage({rows,label,locationPlot,legend,pitchColors={},perspective='batter'}: Omit<BatterReportProps,'pitches'> & {rows:Row[]}) {
  if (!rows.length) return null;
  const p=reportPlayer(rows[0],perspective),isPitcher=perspective==='pitcher',opponent=isPitcher?'打者':'投手';
  return <article className="bs-sheet bp-sheet"><header className="bs-heading bp-heading"><div><h2>{p.name}</h2><span>{p.team}・{p.side}{isPitcher?'投':'打'}</span></div><div><strong>{isPitcher?'左右別打者分析（投手）':'左右別投球分析（打者）'}</strong><span>収録期間 {reportPeriod(rows)}・{rows.length}球</span><span>{label}</span></div></header>
      <div className="bp-halves">{['右','左'].map(side=>{const subset=rows.filter(r=>reportOpponentSide(r,perspective)===side);return <section className="bp-half" key={side}><h3>対{side}{opponent}</h3><div className="bp-top"><section><h4>投球結果</h4>{locationPlot(subset,rows)}</section><section><h4>9エリア別打率</h4><NineMap rows={subset}/></section><section><h4>9エリア別投球割合</h4><NineMap rows={subset} frequency/></section></div><div className="bp-middle"><section><h4>打球方向・距離</h4><Spray rows={subset}/></section><FamilyTable rows={subset}/><PitchMix rows={subset} colors={pitchColors}/></div><div className="bp-bottom"><section><h4>カウント別球種（B−S）</h4><CountChart rows={subset} colors={pitchColors}/></section><StatsTable rows={subset}/></div><p className="bp-missing">位置不明 {subset.filter(r=>reportNineZone(r)===null).length}球・走者不明 {subset.filter(r=>!/^[0-7]$/.test(String(r.runnerStateCode))).length}球・その他球種 {subset.filter(r=>batterFamily(r.pitchType)==='その他').length}球</p></section>;})}</div>
      <div className="bs-key bp-key">{legend}<BattedDirectionLegend/></div><details className="chart-definition bp-definitions"><summary>集計方法</summary><p>括弧内は打数−安打。犠打・犠飛は打数から除外、失策は含む。コース図は9エリア（ゾーン外を外周へ合算、位置不明は除外／割合の分母は全投球）。5打数未満は少数。得点圏は走者の推定値・不明は除外。打点未収録、犠打／犠飛を区別できない場合の出塁率は「—」。通算は現在の検索条件内。球種分類はID東都準拠。</p></details>
      {rows.some(r=>!['右','左'].includes(reportOpponentSide(r,perspective)))&&<p className="bp-missing">{opponent}左右不明：{rows.filter(r=>!['右','左'].includes(reportOpponentSide(r,perspective))).length}球（左右の図表から除外）</p>}
    </article>;
}
