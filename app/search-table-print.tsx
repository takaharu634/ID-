'use client';
import type { ReactNode } from 'react';
import type { Row } from '../lib/dataset-types';
import { reportPlayer } from '../lib/batter-side-report';
import { summarizeByPitchType } from '../lib/pitch-summary';
import PitcherGameLog from './pitcher-game-log';

const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : '—';
const chunks = <T,>(rows: T[], size: number): T[][] => Array.from({ length: Math.ceil(rows.length / size) }, (_, i) => rows.slice(i * size, (i + 1) * size));
export function AnalysisPrintHeading({rows,title,label}:{rows:Row[];title:string;label:string}) {
  const player = reportPlayer(rows[0], 'pitcher');
  return <header className="analysis-print-heading"><h2><span className="analysis-print-player">{player.name}</span>｜{title}</h2><p>{player.team}・対象 {rows.length}球</p><p>{label}</p></header>;
}
export function PitchListPrintPages({rows,label}:{rows:Row[];label:string}) {
  return <>{chunks(rows, 20).map((page, index) => <article key={index} className="analysis-print-page"><AnalysisPrintHeading rows={rows} title={`一球一覧 ${index+1}/${Math.ceil(rows.length/20)}`} label={label}/>
    <table className="data-table"><thead><tr>{['日付','捕手','打者','走者','カウント','球種','球速','回転数','縦変化','横変化','結果','打球速度'].map(name=><th key={name}>{name}</th>)}</tr></thead><tbody>{page.map((row,i)=><tr key={row.id || i}><td>{row.date}</td><td>{row.catcherKanji||row.catcher||"—"}</td><td>{row.batterKanji || row.batter}</td><td>{row.runnerState || '不明'}</td><td>{row.balls}–{row.strikes}</td><td>{row.pitchType}</td><td>{number(row.velocity)}</td><td>{number(row.spin)}</td><td>{number(row.ivb)}</td><td>{number(row.hb)}</td><td>{row.playResult || row.result}</td><td>{number(row.exitVelocity)}</td></tr>)}</tbody></table><p>球速・打球速度 km/h／回転数 rpm／変化量 cm</p>
  </article>)}</>;
}
export function GameLogPrintPages({rows,allPitches,games,pitcher,label}:{rows:Row[];allPitches:Row[];games:Row[];pitcher:Row;label:string}) {
  const ids = [...new Set(rows.map(row=>row.gameId).filter(Boolean))];
  return <>{ids.map(id=><article key={id} className="analysis-print-page"><AnalysisPrintHeading rows={rows.filter(row=>row.gameId===id)} title="試合別" label={label}/><PitcherGameLog pitches={rows.filter(row=>row.gameId===id)} allPitches={allPitches} games={games} pitcher={pitcher}/></article>)}</>;
}
export function PitchTypePrintPages({rows,label,family,locationPlot}:{rows:Row[];label:string;family:(type:string)=>boolean;locationPlot:(rows:Row[])=>ReactNode}) {
  const summary = summarizeByPitchType(rows, 'pitcher').filter(row=>family(row.pitchType));
  return <>{['右','左'].flatMap(side=>chunks(summary,3).map((types,index)=><article key={`${side}-${index}`} className="analysis-print-page"><AnalysisPrintHeading rows={rows} title={`左右×球種｜対${side}打者`} label={label}/>
    <table className="data-table"><thead><tr>{['球種','球数','使用率','最高球速','最低球速','平均球速','右打者','左打者'].map(name=><th key={name}>{name}</th>)}</tr></thead><tbody>{types.map(type=>{const pitches=rows.filter(row=>row.pitchType===type.pitchType),speeds=pitches.map(row=>row.velocity).filter((v):v is number=>typeof v==='number'&&Number.isFinite(v));return <tr key={type.pitchType}><th>{type.pitchType}</th><td>{pitches.length}</td><td>{(pitches.length/rows.length*100).toFixed(1)}%</td><td>{number(type.maxVelocity)}</td><td>{number(speeds.length?Math.min(...speeds):null)}</td><td>{number(type.avgVelocity)}</td><td>{pitches.filter(row=>row.batterSide==='右').length}</td><td>{pitches.filter(row=>row.batterSide==='左').length}</td></tr>;})}</tbody></table>
    <div className="analysis-location-grid">{types.map(type=><section key={type.pitchType}><h3>{type.pitchType}・{rows.filter(row=>row.batterSide===side&&row.pitchType===type.pitchType).length}球</h3>{locationPlot(rows.filter(row=>row.batterSide===side&&row.pitchType===type.pitchType))}</section>)}</div>
  </article>))}</>;
}
