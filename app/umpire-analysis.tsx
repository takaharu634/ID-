'use client';
import { useMemo, useState } from 'react';
import { pitchProjection } from '../lib/chart-geometry';
import type { Dataset } from '../lib/dataset-types';
import { adjustedCatcher, buildUmpireAnalysis, displayRegion, displayX, edgeWidths, heatCells, region, REGIONS, sampleLabel, summarize, type Perspective, type Summary, type Take } from '../lib/umpire-analytics';

const pct=(v:number|null)=>v===null?'—':`${(v*100).toFixed(1)}%`;
const signed=(v:number|null,suffix='')=>v===null?'—':`${v>0?'+':''}${v.toFixed(1)}${suffix}`;
const delta=(v:number|null)=>v===null?'—':signed(v*100,'pt');
const card=(p:Take)=>[p.pitcherTeam,p.batterTeam].sort().join(' × ');
const color=(v:number|null)=>v===null?'#edf1f2':v>=0?`rgba(193,48,62,${.1+Math.min(v/.3,1)*.75})`:`rgba(38,107,178,${.1+Math.min(-v/.3,1)*.75})`;

export function UmpireMap({rows,perspective}:{rows:Take[];perspective:Perspective}) {
  const cells=heatCells(rows,perspective),[active,setActive]=useState<number|null>(null),[points,setPoints]=useState(true);
  const selected=active===null?null:cells[active];
  const {x,y,scale}=pitchProjection(500,470,{left:-.65,right:.65,bottom:.15,top:1.35},35);
  const shown=rows.filter(p=>Math.abs(displayX(p,perspective))<=.65&&p.plateZ>=.15&&p.plateZ<=1.35);
  return <div className="ump-map">
    <label className="ump-toggle"><input type="checkbox" checked={points} onChange={e=>setPoints(e.target.checked)}/>判定位置を重ねる（●ストライク・×ボール）</label>
    <svg viewBox="0 0 500 470" role="img" aria-label="球審のコース別・リーグ期待率との差">
      {cells.map(c=><g key={c.i}><rect x={x(c.x0)} y={y(c.z1)} width={1.3/7*scale} height={1.2/7*scale} fill={color(c.delta)} fillOpacity={c.compared<5?.35:1} stroke="white" role="button" tabIndex={0} aria-label={`領域${c.i+1} ${delta(c.delta)} 比較${c.compared}球`} onClick={()=>setActive(c.i)} onFocus={()=>setActive(c.i)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();setActive(c.i);}}}><title>{`${delta(c.delta)}／比較${c.compared}球・見逃し${c.n}球`}</title></rect>{c.compared>0&&<text pointerEvents="none" x={x(c.x0)+1.3/14*scale} y={y(c.z1)+1.2/14*scale+5} textAnchor="middle" fontSize="14" fill="#14242a">{delta(c.delta)}</text>}</g>)}
      <rect x={x(-.254)} y={y(1.05)} width={x(.254)-x(-.254)} height={y(.45)-y(1.05)} fill="none" stroke="#132c33" strokeWidth="2.5" pointerEvents="none"/>
      {points&&<g pointerEvents="none">{shown.map(p=>p.actual?<circle key={p.id} cx={x(displayX(p,perspective))} cy={y(p.plateZ)} r="2.5" fill="#152a31" stroke="white" strokeWidth=".7"/>:<path key={p.id} d={`M${x(displayX(p,perspective))-2.4},${y(p.plateZ)-2.4}l4.8,4.8m0,-4.8l-4.8,4.8`} stroke="#546570" strokeWidth="1.2"/>)}</g>}
      <text x="70" y="457" fontSize="15">{perspective==='umpire'?'捕手から見て左':'内角'}</text><text x="430" y="457" textAnchor="end" fontSize="15">{perspective==='umpire'?'捕手から見て右':'外角'}</text>
    </svg>
    <div className="ump-scale"><span>青：取りにくい</span><i/><span>赤：取りやすい</span></div>
    <p className="ump-map-detail" aria-live="polite">{selected?`実率 ${pct(selected.comparedRate)} ／ 期待率 ${pct(selected.expected)} ／ 差 ${delta(selected.delta)} ／ 比較 ${selected.compared}球（${sampleLabel(selected.compared)}）`:'領域を選ぶと実率・期待率・比較球数を表示'}</p>

  </div>;
}
function ResultsTable({items,extra,compact=false}:{items:{label:string;stats:Summary;action?:()=>void}[];extra?:boolean;compact?:boolean}) {
  if(compact) return <div className="ump-table-scroll"><table className="ump-table"><thead><tr><th>コース</th><th>実率</th><th>期待率</th><th>差</th><th>比較球</th></tr></thead><tbody>{items.map(({label,stats:s})=><tr key={label}><th>{label}</th><td>{pct(s.comparedRate)}</td><td>{pct(s.expected)}</td><td>{delta(s.delta)}</td><td>{s.compared}<small className="ump-sample">{sampleLabel(s.compared)}</small></td></tr>)}</tbody></table></div>;
  return <div className="ump-table-scroll"><table className="ump-table"><thead><tr><th>対象</th><th>見逃し球</th><th>Called Strike%</th><th>比較実率</th><th>期待率</th><th>差</th>{extra&&<th>追加S</th>}<th>比較球数</th><th>件数区分</th></tr></thead><tbody>{items.map(({label,stats:s,action})=><tr key={label}><th>{action?<button onClick={action}>{label}</button>:label}</th><td>{s.n}</td><td>{pct(s.rate)}</td><td>{pct(s.comparedRate)}</td><td>{pct(s.expected)}</td><td>{delta(s.delta)}</td>{extra&&<td>{signed(s.extra)}</td>}<td>{s.compared}</td><td>{sampleLabel(s.compared)}</td></tr>)}</tbody></table>{!items.length&&<p>対象データがありません。</p>}</div>;
}
export default function UmpireAnalysis({data}:{data:Dataset}) {
  const analysis=useMemo(()=>buildUmpireAnalysis(data),[data]);
  const names=[...new Set(analysis.assignments.values())];
  const [umpire,setUmpire]=useState(names[0]??''),[matchup,setMatchup]=useState(''),[side,setSide]=useState(''),[count,setCount]=useState(''),[pitchType,setPitchType]=useState(''),[perspective,setPerspective]=useState<Perspective>('umpire');
  const known=useMemo(()=>analysis.takes.filter(p=>p.umpire),[analysis]);
  const cards=[...new Set(known.map(card))].sort((a,b)=>a.localeCompare(b,'ja'));
  const filtered=useMemo(()=>known.filter(p=>(!matchup||card(p)===matchup)&&(!side||p.batterSide===side)&&(!pitchType||p.pitchType===pitchType)&&(!count||(count==='normal'?p.strikes!==2&&p.balls!==3:count==='two'?p.strikes===2:count==='three'?p.balls===3:`${p.balls}-${p.strikes}`===count))&&(perspective!=='batter'||['右','左'].includes(p.batterSide))),[known,matchup,side,pitchType,count,perspective]);
  const rows=useMemo(()=>filtered.filter(p=>p.umpire===umpire),[filtered,umpire]),s=summarize(rows);
  const reference=useMemo(()=>analysis.takes.filter(p=>p.umpire!==umpire&&(!side||p.batterSide===side)&&(!pitchType||p.pitchType===pitchType)&&(!count||(count==='normal'?p.strikes!==2&&p.balls!==3:count==='two'?p.strikes===2:count==='three'?p.balls===3:`${p.balls}-${p.strikes}`===count))&&(perspective!=='batter'||['右','左'].includes(p.batterSide))),[analysis,umpire,side,pitchType,count,perspective]);
  const widths=useMemo(()=>edgeWidths(rows,reference,perspective),[rows,reference,perspective]);
  const group=(key:(p:Take)=>string)=>[...new Set(rows.map(key))].filter(Boolean).sort((a,b)=>a.localeCompare(b,'ja')).map(label=>({label,stats:summarize(rows.filter(p=>key(p)===label))}));
  const catcherIds=[...new Set(rows.map(p=>p.catcherId))].filter(Boolean);
  const regionItems=REGIONS.map(label=>({label:displayRegion(label,perspective),stats:summarize(rows.filter(p=>region(p,perspective)===label))}));
  const best=regionItems.filter(v=>v.stats.compared>=30&&v.stats.delta!==null).sort((a,b)=>Math.abs(b.stats.delta!)-Math.abs(a.stats.delta!))[0];
  return <section className="ump-page">
    <header className="ump-heading"><div><p>{data.metadata.season}</p><h1>審判分析</h1></div><span>球審登録 {analysis.assignments.size}試合 / 全{data.games.length}試合</span></header>
    {!names.length?<div className="ump-panel"><h2>このシーズンの球審情報は未登録です</h2><p>球審メモのある2026年秋季を選択してください。未登録試合の球審は推測しません。</p></div>:<>
    <div className="ump-filters">
      <label>球審<select value={umpire} onChange={e=>setUmpire(e.target.value)}>{names.map(n=><option key={n}>{n}</option>)}</select></label>
      <label>大学カード<select value={matchup} onChange={e=>setMatchup(e.target.value)}><option value="">全カード</option>{cards.map(c=><option key={c}>{c}</option>)}</select></label>
      <label>打者<select value={side} onChange={e=>setSide(e.target.value)}><option value="">左右すべて</option><option value="右">右打者</option><option value="左">左打者</option></select></label>
      <label>カウント<select value={count} onChange={e=>setCount(e.target.value)}><option value="">すべて</option><option value="normal">通常（2S・3B以外）</option><option value="two">2ストライク</option><option value="three">3ボール</option>{Array.from({length:12},(_,i)=>`${Math.floor(i/3)}-${i%3}`).map(c=><option key={c}>{c}</option>)}</select></label>
      <label>球種<select value={pitchType} onChange={e=>setPitchType(e.target.value)}><option value="">すべて</option>{[...new Set(known.map(p=>p.pitchType))].map(t=><option key={t}>{t}</option>)}</select></label>
      <label>左右の基準<select value={perspective} onChange={e=>setPerspective(e.target.value as Perspective)}><option value="umpire">球審基準（捕手から見た左右）</option><option value="batter">打者基準（内角・外角）</option></select></label>
    </div>
    <div className="ump-kpis">{[['担当試合',String(s.games)],['見逃し投球',String(s.n)],['Called Strike%',pct(s.rate)],['位置・状況をそろえた差',delta(s.delta)],['ゾーン内見逃しS%',`${pct(s.zoneRate)} / ${s.zoneN}球`],['ゾーン外見逃しS%',`${pct(s.outsideRate)} / ${s.outsideN}球`]].map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <p className="ump-context">{umpire}：比較可能 {s.compared} / {s.n}球・件数区分 {sampleLabel(s.compared)}。{s.games<2?'1試合以内の結果です。球審固有の傾向とは断定できません。':''}</p>
    <div className="ump-columns"><section className="ump-panel"><h2>{umpire}｜判定位置とリーグ平均との差</h2><UmpireMap rows={rows} perspective={perspective}/></section><section className="ump-panel"><h2>ゾーン端の差</h2><ResultsTable compact items={regionItems}/><h3>50%判定境界の広さ（参考）</h3><div className="ump-widths">{['高め','低め','左','右'].map(edge=><div key={edge}><span>{displayRegion(edge,perspective)}</span><b>{signed(widths.find(w=>w.edge===edge)?.cm??null,'cm')}</b></div>)}</div><p>＋は広め、−は狭め。各辺の中央付近を比較。判定境界を両側から確認できない場合は「—」。左右混合時は打者構成の影響が残ります。</p></section></div>
    <section className="ump-panel"><h2>球審一覧</h2><div className="ump-table-scroll"><table className="ump-table"><thead><tr><th>球審</th><th>試合</th><th>見逃し球</th><th>Called Strike%</th><th>期待差</th><th>内S%</th><th>外S%</th>{['高め','低め','左','右'].map(r=><th key={r}>{displayRegion(r,perspective)}差</th>)}<th>比較球数 / 区分</th></tr></thead><tbody>{names.map(name=>{const rs=filtered.filter(p=>p.umpire===name),v=summarize(rs);return <tr key={name} aria-selected={name===umpire}><th><button onClick={()=>setUmpire(name)}>{name}</button></th><td>{v.games}</td><td>{v.n}</td><td>{pct(v.rate)}</td><td>{delta(v.delta)}</td><td>{pct(v.zoneRate)}</td><td>{pct(v.outsideRate)}</td>{['高め','低め','左','右'].map(r=><td key={r}>{delta(summarize(rs.filter(p=>region(p,perspective)===r)).delta)}</td>)}<td>{v.compared} / {sampleLabel(v.compared)}</td></tr>;})}</tbody></table></div></section>
    <div className="ump-columns"><section className="ump-panel"><h2>カウント別</h2><ResultsTable items={group(p=>`${p.balls}-${p.strikes}`)}/><p>上部の2ストライク・3ボール条件は3-2をそれぞれ含みます。</p></section><section className="ump-panel"><h2>左右打者別</h2><ResultsTable items={group(p=>p.batterSide==='右'?'右打者':p.batterSide==='左'?'左打者':'左右不明')}/><h2>球種別</h2><ResultsTable items={group(p=>p.pitchType)}/></section></div>
    <section className="ump-panel"><h2>審判 × 捕手</h2><ResultsTable extra items={group(p=>p.catcherId?`${p.catcherTeam} ${p.catcherKanji||p.catcher}`:'捕手未登録')}/><h3>球審差を差し引いた参考フレーミング</h3><div className="ump-table-scroll"><table className="ump-table"><thead><tr><th>捕手</th><th>補正対象球</th><th>補正前 追加S</th><th>球審差補正後 追加S（参考）</th></tr></thead><tbody>{catcherIds.map(id=>{const cr=rows.filter(p=>p.catcherId===id),v=adjustedCatcher(cr,analysis.takes.filter(p=>p.umpire));return <tr key={id}><th>{cr[0].catcherTeam} {cr[0].catcherKanji||cr[0].catcher}</th><td>{v.n}</td><td>{signed(v.raw)}</td><td>{signed(v.extra)}</td></tr>;})}</tbody></table></div><p>同じ球審が担当した「別の捕手」の判定差を使った参考補正です。捕手・投手・打者・試合の効果を完全には分離できません。従来の境界球フレーミング指標とは対象球・モデルが異なります。</p></section>
    <section className="ump-panel"><h2>試合別</h2><ResultsTable extra items={group(p=>`${p.date} ${card(p)}`)}/></section>
    <section className="ump-panel"><h2>投球への参考</h2><p>{best?`${displayRegion(best.label,perspective)}：期待との差 ${delta(best.stats.delta)}（比較${best.stats.compared}球）。${s.games<2?'この試合での観測値です。次戦でも同じとは限りません。':'対戦前のコース確認に使えます。'}`:'各コースの比較球数が30球未満のため、投球コースの推奨は表示しません。'}</p></section>
    </>}
    <details className="ump-panel"><summary>集計条件・球審情報</summary><p>対象は「見逃しストライク」と「ボール」。空振り・ファウル・インプレー・死球・ワンバウンド・敬遠は対象外。位置欠測 {analysis.missingLocation}球。球審未登録 {analysis.unknownGames.length}試合。</p><p>期待率は同シーズンの他試合から、打者の左右、2ストライクか、3ボールかをそろえ、近い位置の判定を加重平均（横8.5cm・縦9.5cmのカーネル幅、3倍以内）。対象試合自身は学習に含みません。2試合以上・有効標本5球以上を必要とします。大学カードの絞込みでリーグの比較対象は狭めません。期待差は比較可能な球だけで計算するため、全見逃し球のCalled Strike%との差し算とは一致しない場合があります。</p><p>ゾーン枠は既存画面と同じ固定基準（横±25.4cm・高さ45〜105cm）です。打者個人の規則上の上下限ではありません。広さは50%判定となる境界の距離差であり、ptからcmに換算していません。上下左右の辺中央付近20球以上、ストライク・ボール各5球以上、比較側2試合以上を必要とします。</p><p>件数区分は比較球数で30未満＝参考、30〜79＝低、80〜149＝中、150以上＝高。統計的な精度の保証ではありません。球審・捕手・投手・打者・球種・試合を同時に分離したモデルではありません。</p><p>参考フレーミングは別捕手の比較可能20球以上を使用し、球審差をn/(n+50)で縮小して補正します。追加Sは得点への換算ではありません。</p><p>球審情報：ユーザー提供の2026年秋季リーグ・対戦カード別球審メモ（2026年9月17日）。未登録試合は自動割当しません。</p>{analysis.mismatches.length>0&&<p role="alert">試合情報の不一致：{analysis.mismatches.join('・')}。該当試合は球審別集計から除外しました。</p>}</details>
  </section>;
}
