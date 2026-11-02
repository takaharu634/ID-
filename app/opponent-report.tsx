'use client';
import { useId, useMemo, useState, type ReactNode } from 'react';
import type { Row } from '../lib/dataset-types';
import { groupReportPlayers, REPORT_SIDES, REPORT_PITCH_GROUPS, reportPitchGroup, teamBattingSummary, drawableBattedBall } from '../lib/opponent-report';
import { summarizeByPitchType } from '../lib/pitch-summary';
import { BatterPdfPage } from './batter-pdf-report';
import { BattedBallDirectionChart, BattedDirectionLegend } from './batted-ball-direction';
import { printReport } from './print-report';
import AnalysisPrintSelection from './analysis-print-selection';

type PlayerGroup = ReturnType<typeof groupReportPlayers>[number];
type Props = { team:string; pitches:Row[]; label:string; countMatrix:(rows:Row[])=>ReactNode; locationPlot:(rows:Row[],scaleRows:Row[])=>ReactNode; legend:ReactNode; pitchColors:Record<string,string> };
const num=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)?n.toFixed(1):'—';
const ratio=(r:{n:number;total:number;value:number|null})=>r.value===null?'—':`${(r.value*100).toFixed(0)}%（${r.n}/${r.total}）`;
function Heading({name,team,title,label}:{name:string;team:string;title:string;label:string}) {
  return <header className="opponent-heading"><div><h2>{name}</h2><b>{team}｜{title}</b></div><p>{label}</p></header>;
}
export function PitcherPacketPage({player,team,label,side,countMatrix}:{player:PlayerGroup;team:string;label:string;side:string;countMatrix:Props['countMatrix']}) {
  const rows=player.pitches.filter(p=>p.batterSide===side),summary=summarizeByPitchType(rows,'pitcher');
  return <article className="opponent-print-page opponent-pitcher-page" data-print-kind="count">
    <Heading name={player.name} team={team} title={`対${side}打者｜カウント別投球分析`} label={label}/>
    <h3>球種別球速 <small>{rows.length}球</small></h3>
    <table className="opponent-table arsenal-table"><colgroup>{Array.from({length:4},(_,i)=><col key={i}/>)}</colgroup><thead><tr><th colSpan={2}>球種・球数</th><th colSpan={2}>球速 km/h</th></tr><tr><th>球種</th><th>球数</th>{['平均','最高'].map((x,i)=><th key={i}>{x}</th>)}</tr></thead><tbody>{summary.map(r=><tr key={r.pitchType}><th>{r.pitchType}</th><td>{r.pitches}</td>{[r.avgVelocity,r.maxVelocity].map((x,i)=><td key={i}>{num(x)}</td>)}</tr>)}</tbody></table>
    <h3>カウント別投球分析</h3>{countMatrix(rows)}
    {!rows.length&&<p>この左右条件の投球データはありません。</p>}
  </article>;
}
export function TeamBattingPage({team,label,players,teamPitches,page,totalPages}:{team:string;label:string;players:PlayerGroup[];teamPitches:Row[];page:number;totalPages:number}) {
  const groups=[{id:'team',name:`${team} 全体`,pitches:teamPitches},...players];
  return <article className="opponent-print-page opponent-summary-page" data-print-kind="batter-side">
    <Heading name={team} team="打者一覧" title={`FS・外変・打球方向 ${page}/${totalPages}`} label={label}/>
    <table className="opponent-table batting-summary-table"><thead><tr><th>選手</th><th>打</th><th>FS直球Swing</th><th>FS変化球Swing</th><th>外変Swing</th><th>外変Whiff</th><th>引張</th><th>中堅</th><th>逆方向</th><th>打球数</th></tr></thead><tbody>{groups.map(g=>{const s=teamBattingSummary(g.pitches);return <tr key={g.id} className={g.id==='team'?'team-summary-row':''}><th>{g.name}</th><td>{[...new Set(g.pitches.map(p=>p.batterSide).filter(Boolean))].join('/')}</td>{[s.fsStraight,s.fsBreaking,s.outsideSwing,s.outsideWhiff].map((v,i)=><td key={i}>{ratio(v)}</td>)}{[s.directions.pull,s.directions.center,s.directions.opposite].map((v,i)=><td key={i}>{s.batted?`${(v/s.batted*100).toFixed(0)}%`:'—'}</td>)}<td>{s.batted}</td></tr>})}</tbody></table>
  </article>;
}
export function DirectionPacketPage({player,team,label}:{player:PlayerGroup;team:string;label:string}) {
  const maxDistance=Math.max(120,...player.pitches.filter(drawableBattedBall).map(p=>p.distance));
  return <article className="opponent-print-page opponent-direction-page" data-print-kind="batter-side">
    <Heading name={player.name} team={team} title="左右別打球方向｜捕手視点" label={label}/>
    <div className="opponent-direction-grid">{REPORT_PITCH_GROUPS.map(group=>REPORT_SIDES.map(side=>{
      const rows=player.pitches.filter(p=>p.pitcherThrows===side&&reportPitchGroup(p)===group);
      return <section key={`${group}-${side}`}><h3>対{side}投手・{group}</h3><BattedBallDirectionChart rows={rows} maxDistance={maxDistance}/></section>;
    }))}</div><BattedDirectionLegend/>
  </article>;
}
export function OpponentPacket({team,label,pitchers,batters,teamBatting,include,countMatrix,locationPlot,legend,pitchColors}:{team:string;label:string;pitchers:PlayerGroup[];batters:PlayerGroup[];teamBatting:Row[];include:Record<string,boolean>;countMatrix:Props['countMatrix'];locationPlot:Props['locationPlot'];legend:ReactNode;pitchColors:Record<string,string>}) {
  const chunks=Array.from({length:Math.ceil(batters.length/10)},(_,i)=>batters.slice(i*10,i*10+10));
  return <>
    {include.pitchers&&pitchers.flatMap(player=>REPORT_SIDES.map(side=><PitcherPacketPage key={`${player.id}-${side}`} {...{player,team,label,side,countMatrix}}/>))}
    {include.pitcherBatterSides&&pitchers.map(player=><div className="opponent-print-page bp-report" data-print-kind="batter-side" key={`pitcher-sides-${player.id}`}><BatterPdfPage perspective="pitcher" rows={player.pitches} {...{label,locationPlot,legend,pitchColors}}/></div>)}
    {include.summary&&chunks.map((players,i)=><TeamBattingPage key={i} {...{players,team,label,teamPitches:teamBatting,page:i+1,totalPages:chunks.length}}/>)}
    {batters.map(player=><div className="opponent-batter-group" key={player.id}>
      {include.batters&&<div className="opponent-print-page bp-report" data-print-kind="batter-side"><BatterPdfPage rows={player.pitches} {...{label,locationPlot,legend,pitchColors}}/></div>}
      {include.directions&&<DirectionPacketPage {...{player,team,label}}/>}
    </div>)}
  </>;
}
export default function OpponentReport({team,pitches,label,countMatrix,locationPlot,legend,pitchColors}:Props) {
  const id=`opponent-${useId().replace(/[^a-zA-Z0-9_-]/g,'')}`;
  const [open,setOpen]=useState(false);
  const pitchers=useMemo(()=>groupReportPlayers(pitches,team,'pitcher'),[pitches,team]);
  const batters=useMemo(()=>groupReportPlayers(pitches,team,'batter'),[pitches,team]);
  const [pitcherIds,setPitcherIds]=useState<string[]>([]),[batterIds,setBatterIds]=useState<string[]>([]);
  const [include,setInclude]=useState({pitchers:true,pitcherBatterSides:true,batters:true,summary:true,directions:true});
  const selectedPitchers=pitchers.filter(p=>pitcherIds.includes(p.id)),selectedBatters=batters.filter(p=>batterIds.includes(p.id));
  const pages=(include.pitchers?selectedPitchers.length*2:0)+(include.pitcherBatterSides?selectedPitchers.length:0)+(include.batters?selectedBatters.length:0)+(include.directions?selectedBatters.length:0)+(include.summary?Math.ceil(selectedBatters.length/10):0);
  const toggle=(id:string,ids:string[],set:(ids:string[])=>void)=>set(ids.includes(id)?ids.filter(x=>x!==id):[...ids,id]);
  return <details className="opponent-picker" onToggle={e=>setOpen(e.currentTarget.open)}><summary>{team}｜対戦大学の資料を一括印刷</summary>
    <p className="opponent-context">{label}｜現在の検索条件を適用</p>
    <div className="opponent-report-options">{([['pitchers','投手：左右別カウント・球速'],['pitcherBatterSides','投手：左右別打者分析（投手）'],['batters','打者：左右別打者分析'],['summary','大学別：FS・外変・打球方向'],['directions','打者：左右×球種別打球方向']] as const).map(([key,text])=><label key={key}><input type="checkbox" checked={include[key]} onChange={e=>setInclude({...include,[key]:e.target.checked})}/>{text}</label>)}</div>
    <div className="opponent-player-pickers">{([{role:'投手',players:pitchers,ids:pitcherIds,set:setPitcherIds},{role:'打者',players:batters,ids:batterIds,set:setBatterIds}]).map(({role,players,ids,set})=><fieldset key={role}><legend>{role}</legend><div className="opponent-selection-actions"><button type="button" onClick={()=>set(players.map(p=>p.id))}>{role}を全選択</button><button type="button" onClick={()=>set([])}>選択解除</button></div><div className="opponent-player-list">{players.map(p=><label key={p.id}><input type="checkbox" checked={ids.includes(p.id)} onChange={()=>toggle(p.id,ids,set)}/>{p.name}<small>{p.pitches.length}球</small></label>)}</div>{!players.length&&<p>対象選手なし</p>}</fieldset>)}</div>
    <button type="button" className="primary-button" disabled={!pages} onClick={()=>void printReport(`#${id}`,'opponent')}>選択資料を印刷／PDF保存（{pages}ページ）</button>
    <details className="opponent-definitions"><summary>集計方法</summary><p>内角ストレートは打者側のゾーン1/3とその外側のボール球。割合は各カウントの全球数が分母です。投球位置不明は内角に含めません。FSは打席で最初のストライク相当球。直球はストレート、変化球はその他の判別できた球種。外変は打者の外側25cm超の変化球、Whiffの分母は外変を振った回数です。方向はバントを除くフェア打球。距離未計測は方向図に描画せず、種別不明は終点のみ表示します。</p></details>
    {open&&<section id={id} className="opponent-print-source" aria-hidden="true"><OpponentPacket {...{team,label,countMatrix,locationPlot,legend,pitchColors,include}} pitchers={selectedPitchers} batters={selectedBatters} teamBatting={pitches.filter(p=>p.batterTeam===team)}/></section>}
  </details>;
}

export function BatterDirectionReport({pitches,label,printOnly=false}:{pitches:Row[];label:string;printOnly?:boolean}) {
  const id=`direction-${useId().replace(/[^a-zA-Z0-9_-]/g,'')}`;
  const rows=pitches.filter(p=>REPORT_SIDES.includes(p.batterSide));
  const maxDistance=Math.max(120,...rows.filter(drawableBattedBall).map(p=>p.distance));
  return <section id={id} className="direction-report">
    {!printOnly&&<AnalysisPrintSelection key={label} pitches={pitches} kind="batter-direction" renderPages={rows=><BatterDirectionReport printOnly pitches={rows} label={`${rows[0].pitcherKanji||rows[0].pitcher}（${rows[0].pitcherTeam}）・${label}`}/>}/>}
    <div className="bs-actions"><button type="button" className="secondary-button" disabled={!rows.some(drawableBattedBall)} onClick={()=>void printReport(`#${id}`,'batter-direction')}>打球方向を印刷／PDF保存</button></div>
    {rows.length?<article className="opponent-print-page opponent-direction-page" data-print-kind="batter-side">
      <Heading name={printOnly?`${pitches[0].pitcherKanji||pitches[0].pitcher}｜右打者・左打者の通算`:"右打者・左打者の通算"} team="検索条件内" title="左右別打球方向｜捕手視点" label={label}/>
      <div className="opponent-direction-grid">{REPORT_PITCH_GROUPS.map(group=>(['右','左'] as const).map(side=>{
        const subset=rows.filter(p=>p.batterSide===side&&reportPitchGroup(p)===group);
        return <section key={`${group}-${side}`}><h3>対{side}打者・{group}</h3><BattedBallDirectionChart rows={subset} maxDistance={maxDistance}/></section>;
      }))}</div><BattedDirectionLegend/>
    </article>:<p>対象データがありません。</p>}
  </section>;
}
