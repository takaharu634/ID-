"use client";

import { useMemo } from "react";
import type { Row } from "../lib/dataset-types";
import { buildPitcherGameLog, fastestPitchContext } from "../lib/pitcher-game-log";

const number = (value: number | null, digits = 1) => value === null ? "—" : value.toFixed(digits);

export default function PitcherGameLog({ pitches, allPitches, games, pitcher }: { pitches: Row[]; allPitches: Row[]; games: Row[]; pitcher?: Row }) {
  const appearances = useMemo(() => buildPitcherGameLog(pitches, games, pitcher?.id ?? "", allPitches), [pitches, allPitches, games, pitcher?.id]);
  if (!pitcher) return <section className="pitcher-game-log pitcher-game-empty"><h2>投手の試合別</h2><p>上の「投手」を選択してください。</p></section>;
  return <section className="pitcher-game-log" aria-label="投手の試合別集計">
    <header className="pitcher-game-heading"><div><h2>{pitcher.kanji || pitcher.name} <span>試合別</span></h2><p>{pitcher.team}</p></div><p>{appearances.length}試合 · 検索条件内</p></header>
    {!appearances.length && <p className="pitcher-game-empty">検索条件に一致する投球がありません。</p>}
    {appearances.map((game, index) => <details className="pitcher-game-card" key={game.gameId} open={index === 0}>
      <summary>
        <span className="pitcher-game-match"><strong>{game.date || "日付不明"}</strong><span>対 {game.opponent}</span></span>
        <span className="pitcher-game-count"><strong>{game.pitches}</strong> 球</span>
        <span className="pitcher-game-max">最高 <strong>{number(game.maxVelocity)}</strong> km/h</span>
        <span className="pitcher-game-toggle" aria-hidden="true">＋</span>
      </summary>
      <div className="pitcher-game-detail">
        <div className="table-scroll" role="region" aria-label={`${game.date} 球種別集計`} tabIndex={0}><table className="data-table pitcher-game-table">
          <caption>{game.date} 対{game.opponent} 球種別</caption>
          <thead><tr>
            <th scope="col">球種</th><th scope="col">球数</th>
            <th scope="col">平均球速<small>km/h</small></th><th scope="col">最高球速<small>km/h</small></th>
            <th scope="col">平均回転数<small>rpm</small></th><th scope="col">最高回転数<small>rpm</small></th>
            <th scope="col">平均縦変化<small>cm</small></th><th scope="col">最大縦変化<small>cm</small></th>
            <th scope="col">平均横変化<small>cm</small></th><th scope="col">最大横変化<small>cm</small></th>
            <th scope="col">平均リリース高<small>cm</small></th><th scope="col">平均エクステンション<small>cm</small></th><th scope="col">平均リリースサイド<small>cm</small></th>
          </tr></thead>
          <tbody>{game.arsenal.map((row) => <tr key={row.pitchType}>
            <th scope="row">{row.pitchType}</th><td>{row.pitches}</td><td>{number(row.avgVelocity)}</td><td>{number(row.maxVelocity)}</td>
            <td>{number(row.avgSpin, 0)}</td><td>{number(row.maxSpin, 0)}</td>
            <td>{number(row.avgIvb)}</td><td>{number(row.maxIvb)}</td><td>{number(row.avgHb)}</td><td>{number(row.maxHb)}</td>
            <td>{number(row.avgReleaseHeight)}</td><td>{number(row.avgExtension)}</td><td>{number(row.avgReleaseSide)}</td>
          </tr>)}</tbody>
        </table></div>
        <div className="pitcher-game-fastest"><h3>最高球速の投球{game.fastest.length > 1 && <span>同速 {game.fastest.length}球</span>}</h3>
          {game.fastest.length ? <ul>{game.fastest.map((pitch, i) => <li key={`${pitch.id}-${i}`}>{fastestPitchContext(pitch)}</li>)}</ul> : <p>球速の計測データがありません。</p>}
        </div>
      </div>
    </details>)}
  </section>;
}
