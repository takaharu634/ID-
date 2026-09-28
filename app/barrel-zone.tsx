"use client";

import { PlayerOptions, comparePlayerNames } from './player-options';
import { useEffect, useMemo, useState } from "react";
import { catcherGridOrder } from '../lib/catcher-view';
import { BarrelMetric as Metric, canonicalPlayerKey, summarizeBarrelZones } from "./barrel-zone-engine";

import type { Row, Dataset, SeasonKey } from "../lib/dataset-types";
import { loadStaticDataset } from "../lib/dataset-loader";
type SeasonFilter = "compare" | "compare-previous" | "combined" | SeasonKey;
type Role = "batting" | "pitching";

import { useSeasonCatalog } from "../lib/season-catalog";

function heatColor(rate: number | null, metric: Metric) {
  if (rate === null) return "#f4f5f5";
  const max = metric === "swings" ? 0.15 : 0.35;
  const t = Math.min(1, rate / max);
  if (t < 0.5) {
    const p = t * 2;
    return `rgb(${Math.round(210 + 45 * p)},${Math.round(229 + 26 * p)},${Math.round(240 + 15 * p)})`;
  }
  const p = (t - 0.5) * 2;
  return `rgb(255,${Math.round(255 - 113 * p)},${Math.round(255 - 117 * p)})`;
}

function Heatmap({ pitches, metric, minimum, title }: { pitches: Row[]; metric: Metric; minimum: number; title: string }) {
  const cells = useMemo(() => summarizeBarrelZones(pitches, metric), [pitches, metric]);
  const used = cells.reduce((sum, cell) => sum + cell.denominator, 0);
  const barrels = cells.reduce((sum, cell) => sum + cell.numerator, 0);
  return <article className="barrel-heatmap-card">
    <header><div><h3>{title}</h3><p>{metric === "swings" ? "Barrel相当 / Swings" : "Barrel相当 / BIP"}</p></div><strong>{used ? `${(barrels / used * 100).toFixed(1)}%` : "—"}<small>{barrels} / {used}</small></strong></header>
    <div className="barrel-zone-axis"><span>高め</span><div className="barrel-zone-grid" aria-label={`${title}のゾーン別Barrel相当率`}>
      {catcherGridOrder(cells, 5).map((cell) => {
        const lowSample = cell.denominator > 0 && cell.denominator < minimum;
        return <div key={`${cell.row}-${cell.col}`} className={`barrel-zone-cell ${cell.row >= 1 && cell.row <= 3 && cell.col >= 1 && cell.col <= 3 ? "strike-cell" : "ball-cell"} ${lowSample ? "low-sample" : ""}`} style={{ background: heatColor(cell.rate, metric) }} title={`Barrel相当 ${cell.numerator} / ${cell.denominator}`}>
          <b>{cell.rate === null ? "—" : `${(cell.rate * 100).toFixed(cell.rate > 0 ? 1 : 0)}%`}</b><small>{cell.denominator ? `${cell.numerator}/${cell.denominator}` : "n=0"}</small>
        </div>;
      })}
    </div><span>低め</span></div>
    <div className="barrel-zone-x"><span>捕手から見て左</span><strong>捕手側から見た図</strong><span>捕手から見て右</span></div>
  </article>;
}

export default function BarrelZoneView({ initialSeason = "2026-fall", initialData }: { initialSeason?: SeasonKey; initialData?: Dataset }) {
  const catalog = useSeasonCatalog();
  const SEASONS = useMemo(()=>Object.values(catalog.seasons),[catalog.seasons]);
  const [combinedKeys,setCombinedKeys]=useState<string[]>([]);
  const [datasets, setDatasets] = useState<Record<string, Dataset>>(initialData ? { [initialSeason]: initialData } : {});
  const [error, setError] = useState("");
  const [role, setRole] = useState<Role>("batting");
  const [team, setTeam] = useState("青山学院大学");
  const [playerKey, setPlayerKey] = useState("");
  const [season, setSeason] = useState<SeasonFilter>(initialSeason);
  const [metric, setMetric] = useState<Metric>("swings");
  const [pitchType, setPitchType] = useState("");
  const [batterSide, setBatterSide] = useState("");
  const [pitcherThrows, setPitcherThrows] = useState("");
  const [minimum, setMinimum] = useState(5);

  const seasonKeys = useMemo(() => season === "compare" ? SEASONS.slice(0,2).map(s=>s.key) : season === "compare-previous" ? SEASONS.slice(1,3).map(s=>s.key) : season === "combined" ? (combinedKeys.length?combinedKeys:SEASONS.slice(0,3).map(s=>s.key)) : [season], [season,SEASONS,combinedKeys]);
  useEffect(() => {
    let active = true;
    setError('');
    Promise.all(SEASONS.filter(s=>seasonKeys.includes(s.key)).map(async item => [item.key, await loadStaticDataset<Dataset>(item.path)] as const))
      .then(entries => { if (active) setDatasets(Object.fromEntries(entries)); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "データを読み込めませんでした。"); });
    return () => { active = false; };
  }, [seasonKeys, SEASONS, catalog.revision]);

  const allPitches = useMemo<Row[]>(() => SEASONS.flatMap((item) => (datasets[item.key]?.pitches ?? []).map((pitch): Row => ({ ...pitch, seasonKey: item.key }))), [datasets]);

  const periodPitches = useMemo(() => allPitches.filter(pitch => seasonKeys.includes(pitch.seasonKey)), [allPitches, seasonKeys]);
  const teams = [...new Set(allPitches.map(pitch => role === "batting" ? pitch.batterTeam : pitch.pitcherTeam))].filter(Boolean).sort();
  const candidates = useMemo(() => {
    const byPlayer = new Map<string, Row>();
    for (const pitch of periodPitches) {
      const id = role === "batting" ? pitch.batterId : pitch.pitcherId;
      const rowTeam = role === "batting" ? pitch.batterTeam : pitch.pitcherTeam;
      const kanji = role === "batting" ? pitch.batterKanji : pitch.pitcherKanji;
      const key = canonicalPlayerKey(rowTeam, kanji);
      if (!id || rowTeam !== team || !key) continue;
      const previous = byPlayer.get(key);
      byPlayer.set(key, { key, ids: [...new Set([...(previous?.ids ?? []), id])], name: role === "batting" ? pitch.batter : pitch.pitcher, kanji, team: rowTeam });
    }
    return [...byPlayer.values()].sort(comparePlayerNames);
  }, [periodPitches, role, team]);

  const effectivePlayerKey = candidates.some((row) => row.key === playerKey) ? playerKey : candidates[0]?.key ?? "";

  const pitchTypes = useMemo(() => [...new Set(periodPitches.filter((pitch) => role === "batting" ? pitch.batterTeam === team : pitch.pitcherTeam === team).map((pitch) => pitch.pitchType).filter(Boolean))].sort(), [periodPitches, role, team]);
  const filtered = useMemo(() => periodPitches.filter((pitch) => {
    if ((role === "batting" ? pitch.batterTeam : pitch.pitcherTeam) !== team) return false;
    const pitchPlayerKey = canonicalPlayerKey(role === "batting" ? pitch.batterTeam : pitch.pitcherTeam, role === "batting" ? pitch.batterKanji : pitch.pitcherKanji);
    if (effectivePlayerKey && pitchPlayerKey !== effectivePlayerKey) return false;
    if (pitchType && pitch.pitchType !== pitchType) return false;
    if (batterSide && pitch.batterSide !== batterSide) return false;
    if (pitcherThrows && pitch.pitcherThrows !== pitcherThrows) return false;
    return true;
  }), [periodPitches, role, team, effectivePlayerKey, pitchType, batterSide, pitcherThrows]);
  const player = candidates.find((row) => row.key === effectivePlayerKey);
  const panels = season.startsWith("compare") ? SEASONS.filter(item => seasonKeys.includes(item.key)).reverse().map((item) => ({ title: item.label, pitches: filtered.filter((pitch) => pitch.seasonKey === item.key) })) : season === "combined" ? [{ title: seasonKeys.map(k=>catalog.seasons[k as SeasonKey]?.shortLabel).join("＋") + " 合算", pitches: filtered }] : batterSide ? [{ title: `${SEASONS.find((item) => item.key === season)?.label}・${batterSide}打者`, pitches: filtered }] : [
    { title: `${SEASONS.find((item) => item.key === season)?.label}・右打者`, pitches: filtered.filter((pitch) => pitch.batterSide === "右") },
    { title: `${SEASONS.find((item) => item.key === season)?.label}・左打者`, pitches: filtered.filter((pitch) => pitch.batterSide === "左") },
  ];

  return <section className="page-section barrel-zone-page">
    <div className="section-heading"><h1>ゾーン別 Barrel相当率</h1></div>
    <details className="barrel-definition chart-definition"><summary>指標の定義</summary><span>東都大学野球向けのBarrel相当条件（打球速度145km/h以上・打球角度10〜35度）を使用。MLB公式Barrelフラグではありません。</span></details>
    <div className="toolbar barrel-toolbar">
      <div className="segmented"><button className={role === "batting" ? "active" : ""} onClick={() => { setRole("batting"); setPlayerKey(""); }}>打者（生み出した）</button><button className={role === "pitching" ? "active" : ""} onClick={() => { setRole("pitching"); setPlayerKey(""); }}>投手（許した）</button></div>
      <label>大学<select value={team} onChange={(event) => { setTeam(event.target.value); setPlayerKey(""); }}>{teams.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>{role === "batting" ? "打者" : "投手"}<select value={effectivePlayerKey} onChange={(event) => setPlayerKey(event.target.value)}><PlayerOptions players={candidates} valueKey="key" /></select></label>
      <label>シーズン<select value={season} onChange={(event) => setSeason(event.target.value as SeasonFilter)}>{SEASONS.map(s=><option key={s.key} value={s.key}>{s.shortLabel}（左右比較）</option>)}<option value="compare">直近2シーズン比較</option><option value="compare-previous">前の2シーズン比較</option><option value="combined">選択シーズンの合算</option></select></label>
      <label>球種<select value={pitchType} onChange={(event) => setPitchType(event.target.value)}><option value="">すべて</option>{pitchTypes.map((value) => <option key={value}>{value}</option>)}</select></label>
      <label>打者左右<select value={batterSide} onChange={(event) => setBatterSide(event.target.value)}><option value="">左右すべて</option><option value="右">右打者</option><option value="左">左打者</option></select></label>
      <label>投手左右<select value={pitcherThrows} onChange={(event) => setPitcherThrows(event.target.value)}><option value="">左右すべて</option><option value="右">右投手</option><option value="左">左投手</option></select></label>
      <label>薄表示の基準<input type="number" min="1" max="50" value={minimum} onChange={(event) => setMinimum(Math.max(1, Number(event.target.value) || 1))} /></label>
    </div>
    {season==="combined" && <label>合算するシーズン<select multiple aria-label="合算するシーズン" value={seasonKeys} onChange={e=>setCombinedKeys([...e.target.selectedOptions].map(o=>o.value))}>{SEASONS.map(s=><option key={s.key} value={s.key}>{s.shortLabel}</option>)}</select></label>}
    <div className="segmented barrel-metric"><button className={metric === "swings" ? "active" : ""} onClick={() => setMetric("swings")}>Barrel相当 / Swings</button><button className={metric === "bip" ? "active" : ""} onClick={() => setMetric("bip")}>Barrel相当 / BIP</button></div>
    {error && !seasonKeys.every(key => datasets[key]) ? <div className="empty-state"><h2>{error}</h2></div> : !seasonKeys.every(key => datasets[key]) ? <div className="loading-panel">シーズンデータを集計しています…</div> : <>
      <div className="barrel-summary"><div><small>{role === "batting" ? "打者" : "投手"}</small><strong>{player?.kanji || player?.name || "—"}</strong><span>{team}</span></div><div><small>対象球</small><strong>{filtered.length.toLocaleString("ja-JP")}</strong><span>コース記録をフィルター後に集計</span></div></div>
      <div className="barrel-heatmap-grid">{panels.map((panel) => <Heatmap key={panel.title} title={panel.title} pitches={panel.pitches} metric={metric} minimum={minimum} />)}</div>
      <div className="barrel-legend"><span>低い</span><i /><i /><i /><i /><i /><span>高い</span></div>
    </>}
  </section>;
}
