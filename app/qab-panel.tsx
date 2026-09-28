import { useState } from 'react';
import { QAB_REASONS, summarizeQab, type QabAppearance } from '../lib/qab';

const pct = (value: number | null) => value === null ? '—' : `${(value * 100).toFixed(1)}%`;
const num = (value: number | null) => value === null ? '—' : value.toFixed(1);

export function QabDefinition() {
  return <details className="qab-definition"><summary>QABの判定基準</summary>
    <p>安打・四球・死球・記録された進塁打・犠打／犠飛・8球以上・A打球・B打球のいずれかで成立。1打席につき最大1QAB。QAB率＝QAB数÷結果を確認できた収録打席数。</p>
    <p>A打球：打球方向のフェンス距離−3m以上。神宮は両翼97.5m、左右中間112.3m、中堅120mを使い、その間を方向別に補間します。公称寸法に基づく近似です。球場・落下方向・飛距離が不明ならA判定は行いません。</p>
    <p>B打球：150km/h以上で、角度−10〜10°・飛距離0〜50mのゴロ、または角度10°超〜30°・飛距離40m以上のライナー。バントは除外し、Aに該当する打球はAのみを数えます。ID東都の自動判定基準で、目視のA/B判定とは異なります。</p>
    <p>安打になったかどうかでA/B判定は変えません。計測欠損は推定しません。進塁打は明示記録のみを採用し、TrackManに未記録の進塁打は含みません。欠損・未記録がある場合はQABを過少計上する可能性があります。公式成績の打席数とは分母が異なる場合があります。</p>
  </details>;
}

export function QabSummary({ rows, title = 'QAB' }: { rows: QabAppearance[]; title?: string }) {
  const s = summarizeQab(rows);
  return <article className="qab-summary"><header><h3>{title}</h3><strong>{pct(s.qabRate)}</strong><span>{s.qab} QAB / {s.pa} 収録打席</span></header>
    <div className="qab-reasons">{QAB_REASONS.map(reason => <span key={reason}><small>{reason}</small><b>{s.reasonCounts[reason]}</b></span>)}</div>
    {!!s.measurementMissing && <small className="qab-missing">A/B判定の計測不足 {s.measurementMissing}打席</small>}
    {!!s.incompletePitchSequence && <small className="qab-missing">投球記録の途中欠損 {s.incompletePitchSequence}打席</small>}
  </article>;
}

export default function QabPanel({ rows, filtered = false }: { rows: QabAppearance[]; filtered?: boolean }) {
  const [shown, setShown] = useState(30);
  return <section className="qab-panel" aria-label="選手のQAB"><QabSummary rows={rows}/>
    {filtered && <p className="qab-filter-note">絞り込み条件に一致する投球を含む打席を表示。球数はその打席の全投球で判定します。</p>}
    <QabDefinition/>
    <details className="qab-appearances"><summary>打席別の判定を見る</summary>
      <div className="table-scroll"><table className="data-table"><thead><tr><th>日付</th><th>回</th><th>相手</th><th>結果</th><th>球数</th><th>QAB</th><th>成立理由</th><th>打球速度 km/h</th><th>角度 °</th><th>飛距離 m</th><th>A基準 m</th></tr></thead>
        <tbody>{rows.slice(0, shown).map(row => <tr key={row.id}><td>{row.date}</td><td>{row.terminal.inning}{row.terminal.half}</td><td>{row.terminal.pitcherTeam}</td><td>{row.result}</td><td>{row.pitchCount}</td><td>{row.isQab ? '○' : '—'}</td><td>{row.reasons.join('・') || '記録上の成立条件なし'}</td><td>{num(row.quality.ev)}</td><td>{num(row.quality.angle)}</td><td>{num(row.quality.distance)}</td><td>{num(row.quality.aThreshold)}</td></tr>)}</tbody></table></div>
      {!rows.length && <p>対象の収録打席がありません。</p>}
      {shown < rows.length && <button className="secondary-button" onClick={() => setShown(shown + 30)}>さらに30打席を表示</button>}
    </details>
  </section>;
}
