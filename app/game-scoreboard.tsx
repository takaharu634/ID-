import type { Row } from '../lib/dataset-types';
import { gameScoreboard } from '../lib/game-scoreboard';
export default function GameScoreboard({game,pitches}:{game:Row;pitches:Row[]}) {
  const board=gameScoreboard(game,pitches);
  return <section className="game-scoreboard" aria-label={`${game.date} ${game.awayTeam} 対 ${game.homeTeam} スコアボード`}>
    <header><h2>{game.awayTeam} × {game.homeTeam}</h2><span>{game.date} · 収録記録</span></header>
    <div className="table-scroll"><table><thead><tr><th>大学</th>{board.innings.map(n=><th key={n}>{n}</th>)}<th className="score-total">計</th><th>安打</th><th>失策</th><th>四死球</th></tr></thead><tbody>{board.teams.map(t=><tr key={t.team}><th>{t.team}</th>{t.innings.map((n,i)=><td key={i}>{n??'—'}</td>)}<td className="score-total">{t.runs??'—'}</td><td>{t.hits}</td><td>{t.errors??'—'}</td><td>{t.freePasses}</td></tr>)}</tbody></table></div>
    <div className="score-breakdown">{board.teams.map(t=><div key={t.team}><strong>{t.team}</strong><span>四球 {t.walks}</span><span>死球 {t.hbp}</span><span>失策出塁 {t.reachedOnError}</span></div>)}</div>
    <details><summary>記録の範囲</summary><p>TrackMan収録分の集計です。失策総数は未収録。失策出塁は打者側の件数です。投球のない回や得点不明の回は「—」と表示します。</p></details>
  </section>;
}
