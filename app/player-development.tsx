'use client';
import { useMemo, useState } from 'react';
import type { Dataset, Row } from '../lib/dataset-types';
import { batterDevelopment, catcherDevelopment, developmentRankings, pitcherDevelopmentReport } from '../lib/development-metrics';
import './player-development.css';
import { selectedBoardConfig } from '../lib/selected-rankings';

type Column = { key: string; label: string; format?: 'number' | 'rate' | 'decimal' | 'seconds'; player?: boolean };
const c = (key: string, label: string, format?: Column['format']): Column => ({ key, label, format });
const fmt = (value: unknown, format?: Column['format']) => typeof value === 'number' && Number.isFinite(value)
  ? format === 'rate' ? `${(value * 100).toFixed(1)}%` : value.toFixed(format === 'seconds' ? 2 : format === 'decimal' ? 3 : Number.isInteger(value) ? 0 : 1) : value == null ? '—' : String(value);
const signed = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toFixed(1)}` : '—';

function Table({ rows, columns }: { rows: Row[]; columns: Column[] }) {
  return <div className="table-scroll"><table className="data-table development-table"><thead><tr>{columns.map(c => <th key={c.key}>{c.label}</th>)}</tr></thead><tbody>{rows.map((row, i) => <tr key={i}>{columns.map(c => <td key={c.key}>{c.key.endsWith('Delta') ? signed(row[c.key]) : fmt(row[c.key], c.format)}</td>)}</tr>)}</tbody></table>{!rows.length && <p className="development-empty">条件に合う計測がありません。</p>}</div>;
}
function Value({ label, value, unit, sample, format }: { label: string; value: unknown; unit?: string; sample?: string; format?: Column['format'] }) {
  return <div className="development-value"><span>{label}</span><strong>{fmt(value, format)}{unit && <small>{unit}</small>}</strong>{sample && <small>{sample}</small>}</div>;
}
export function DevelopmentDefinition({ role, includeDamage = true }: { role: 'pitching' | 'batting' | 'catching'; includeDamage?: boolean }) {
  return <details className="chart-definition development-definition"><summary>追加指標の計算方法</summary>{role === 'pitching' ? <>
    <p>球種別のばらつきは標本SD（n−1）。「±」はSDで、全投球の範囲ではありません。回転軸は0°と360°が連続する循環SDです。各項目は実測値のみを使い、2球未満は「—」。小さいほど良い投球とは限りません。</p>
    <p>登板差は同シーズン・同球種の過去登板平均との差。対象登板は3球、過去は10球以上の計測が必要です。球速区間は球種やコースを絞る前の、その投手の登板球数。維持率は61球目以降の同球種平均÷本人のシーズン同球種平均。後半3球以上が必要です。ランキングではストレートを対象に、後半の投球をまとめて平均します。</p>
    <p>VAA差は同シーズンのストレート（100球・3投手以上）を高さで線形補正した残差。プラスほど同じ高さの平均よりフラットです。球速・左右・投手体格の補正は含みません。Effective Velo差はTrackManのEffectiveVelo−実球速です。</p>
    <p>PutAway%＝2ストライク時に三振を取った球÷2ストライク時の全球。Heartは固定ゾーンの境界より8.5cm内側、Edgeは境界内外8.5cm、Chaseは境界外8.5〜17cm、Wasteは17cm超です。</p>
  </> : role === 'batting' ? <>
    <p>EVはインプレー・非バントの正の計測値のみ。打球タイプはTrackManのタグを使い、不明な場合のみ角度で補います（10°未満ゴロ、25°未満ライナー、50°未満フライ、以上ポップフライ）。HardHitは152.9km/h以上。Barrelは既存の速度・角度基準です。</p>
    <p>Pull Air%は引っ張り方向のライナー・フライ÷方向と角度がある全非バント打球。右打者は−15°より左、左打者は+15°より右。角度SDは小さいほど良いとは限りません。2ストライクContact%＝追い込まれた後の接触数÷スイング数。</p>
    {includeDamage && <p>ゾーン内Damageは横±0.254m・高さ0.45〜1.05m、Heartはその境界より8.5cm内側。Swingは判定可能球、Contactはスイング、EV/HardHitはEV実測打球、BarrelはEV・角度両実測打球を分母にします。xSLGはその領域で打数が終わった有効打球の期待塁打＋三振0を、期待値計測済みの打球打数＋三振で割ります。未計測打球・犠打飛を含めません。</p>}
    <p>Good Decision%＝（Heartのスイング＋Chase/Wasteの見送り）÷同3領域の判定可能球。Edge、死球、敬遠、不明、判別できるバントは除外。既存の固定ゾーンを使った東都独自の簡易指標で、カウントや狙い球の正解を判定するものではありません。</p>
  </> : <p>二塁方向（BasePositionX 35〜43m、|Z|≦5m）、Pop Time 1.60〜2.50秒、捕球・リリース・到達位置の信頼度がLowではない記録を使います。Pop分解はExchangeとTimeToBaseの合計がPopと一致する同一送球のみ。平均Pop＝平均Exchange＋平均飛行時間です。送球速度は速度がある記録で別に集計。盗塁企図だけとは限りません。未収録は「—」です。</p>}</details>;
}

export function PitcherDevelopment({ pitches, allPitcherPitches, leaguePitches, mode = 'overview' }: { pitches: Row[]; allPitcherPitches: Row[]; leaguePitches: Row[]; mode?: 'overview' | 'workload' }) {
  const report = useMemo(() => pitcherDevelopmentReport(pitches, allPitcherPitches, leaguePitches), [pitches, allPitcherPitches, leaguePitches]);
  const [game, setGame] = useState('');
  const games = [...new Map(report.workload.map(p => [p.gameId, p.date])).entries()].reverse();
  const selectedGame = games.some(([id]) => id === game) ? game : games[0]?.[0] ?? '';
  return <section className="profile-body development-panel" aria-label={mode === 'workload' ? '登板内の球速維持' : '投手の再現性と投球特性'}>
    {mode === 'overview' ? <>
      <h2>球質再現性</h2>
      <Table rows={report.pitchTypes} columns={[c('pitchType', '球種'), c('pitches', '球数'), c('velocitySd', '球速 ±km/h'), c('velocitySdN', '球速計測'), c('ivbSd', 'IVB ±cm'), c('hbSd', 'HB ±cm'), c('axisSd', '回転軸 ±°'), c('vaaSd', 'VAA ±°')]} />
      <h2>リリース再現性</h2>
      <Table rows={report.pitchTypes} columns={[c('pitchType', '球種'), c('heightSd', '高さ ±cm'), c('heightSdN', '高さ計測'), c('sideSd', '横 ±cm'), c('sideSdN', '横計測'), c('extensionSd', 'Extension ±cm'), c('extensionSdN', 'Ext計測')]} />
      <h2>VAA差・Effective Velo差・PutAway%</h2>
      <Table rows={report.pitchTypes} columns={[c('pitchType', '球種'), c('actualVaa', 'VAA °'), c('expectedVaa', '同じ高さの平均 °'), c('vaaDelta', 'VAA差 °'), c('vaaSamples', 'VAA計測'), c('effectiveDelta', 'Effective Velo差 km/h'), c('putAwayRate', 'PutAway%', 'rate'), c('twoStrikePitches', '2ストライク球')]} />
      <h2>Heart / Edge / Chase / Waste</h2>
      <Table rows={report.pitchTypes} columns={[c('pitchType', '球種'), c('heartShare', 'Heart%', 'rate'), c('edgeShare', 'Edge%', 'rate'), c('chaseShare', 'Chase%', 'rate'), c('wasteShare', 'Waste%', 'rate'), c('locatedPitches', '位置計測')]} />
    </> : <>
      <h2>登板内の球速維持</h2>
      <div className="toolbar"><label>登板<select aria-label="球速維持の登板" disabled={!games.length} value={selectedGame} onChange={e => setGame(e.target.value)}>{!games.length && <option value="">対象の登板なし</option>}{games.map(([id, date]) => <option key={id} value={id}>{date}</option>)}</select></label></div>
      <div className="development-values">{report.maintenance.filter(p => p.gameId === selectedGame).map(p => <Value key={p.pitchType} label={`${p.pitchType} 球速維持率`} value={p.velocityRetention} format="rate" sample={`基準平均 ${p.baselineVelocity.toFixed(1)} → 後半 ${p.late.toFixed(1)} km/h`} />)}</div>
      {!report.maintenance.some(p => p.gameId === selectedGame) && <p className="development-empty">維持率は本人のシーズン同球種平均を基準に、61球目以降に同じ球種の球速計測が3球以上ある登板で表示します。</p>}
      <Table rows={report.workload.filter(p => p.gameId === selectedGame)} columns={[c('pitchType', '球種'), c('segment', '登板球数'), c('pitches', '球数'), c('velocity', '平均球速 km/h'), c('baselineVelocity', '基準平均 km/h'), c('velocityDelta', '平均との差 km/h'), c('ivb', 'IVB cm'), c('extension', 'Extension cm'), c('releaseHeight', '高さ cm')]} />
      <h2>登板別リリースと過去平均との差</h2>
      <Table rows={report.releases.filter(p => p.gameId === selectedGame)} columns={[c('pitchType', '球種'), c('heightMean', '高さ cm'), c('heightSd', '高さ ±cm'), c('heightDelta', '高さ差 cm'), c('sideMean', '横 cm'), c('sideSd', '横 ±cm'), c('sideDelta', '横差 cm'), c('extensionMean', 'Ext cm'), c('extensionSd', 'Ext ±cm'), c('extensionDelta', 'Ext差 cm'), c('baselinePitches', '過去球数')]} />
    </>}
    <DevelopmentDefinition role="pitching" />
  </section>;
}

export function BatterDevelopment({ pitches }: { pitches: Row[] }) {
  const report = useMemo(() => batterDevelopment(pitches), [pitches]);
  const s = report.summary;
  return <section className="profile-body development-panel" aria-label="打球タイプと打撃判断">
    <div className="development-values"><Value label="Pull Air%" value={s.pullAirRate} format="rate" sample={`${s.pullAirSamples}打球`} /><Value label="打球角度SD" value={s.angleSd} unit="°" sample={`${s.angleSamples}打球`} /><Value label="2ストライクContact%" value={s.twoStrikeContactRate} format="rate" sample={`${s.twoStrikeSwings}スイング`} /><Value label="Good Decision%" value={s.goodDecisionRate} format="rate" sample={`${s.goodDecisions} / ${s.decisionSamples}球`} /></div>
    <details className="chart-definition"><summary>領域別スイング率</summary><Table rows={report.zones.map(z => ({ ...z, zone: ({ heart: 'Heart', edge: 'Edge', chase: 'Chase', waste: 'Waste' } as Row)[z.zone] }))} columns={[c('zone', '領域'), c('pitches', '球数'), c('swingRate', 'Swing%', 'rate')]} /></details>
    <DevelopmentDefinition role="batting" includeDamage={false} />
  </section>;
}

export function CatcherDevelopment({ pitches }: { pitches: Row[] }) {
  const s = useMemo(() => catcherDevelopment(pitches), [pitches]);
  return <section className="profile-body development-panel" aria-label="二塁送球の分解"><h2>二塁送球の分解</h2>
    <div className="development-values"><Value label="平均Pop Time" value={s.pairedPopTime} format="seconds" unit="秒" sample={`分解できた${s.exchangeSamples}送球`} /><Value label="平均Exchange" value={s.avgExchange} format="seconds" unit="秒" /><Value label="平均飛行時間" value={s.avgFlight} format="seconds" unit="秒" /><Value label="平均二塁送球速度" value={s.avgThrowSpeed} unit="km/h" sample={`${s.throwSamples}送球`} /><Value label="最高二塁送球速度" value={s.maxThrowSpeed} unit="km/h" /></div>
    <Table rows={s.fastestPairedPop === null ? [] : [{ label: '最速Popの同一送球', pop: s.fastestPairedPop, exchange: s.fastestExchange, flight: s.fastestFlight }]} columns={[c('label', '送球'), c('pop', 'Pop 秒', 'seconds'), c('exchange', 'Exchange 秒', 'seconds'), c('flight', '飛行時間 秒', 'seconds')]} />
    <DevelopmentDefinition role="catching" />
  </section>;
}

export const developmentOptions = (board: string): [string, string][] => board.startsWith('pitching_') ? [['shape', '球質再現性'], ['release', 'リリース再現性'], ['retention', '球速維持率'], ['angle', 'VAA差・Effective Velo差'], ['finish', 'PutAway%・コース配分']]
  : board.startsWith('batting_') ? [['contact', '打球タイプ・角度'], ['damage', 'ゾーン内Damage'], ['decision', 'スイング判断・2ストライク']]
  : board.startsWith('catching_') ? [['throw', '二塁送球の分解']] : [];

export function developmentBoardConfig(data: Dataset, board: string, group: string) {
  if (group === 'retention') return selectedBoardConfig(data, 'pitching_velocity_retention')!;
  const role = board.startsWith('pitching_') ? 'pitching' : board.startsWith('batting_') ? 'batting' : 'catching';
  const source = developmentRankings(data.pitches)[role];
  const base: Column[] = role === 'pitching' ? [{ key: 'pitcher', label: '投手', player: true }, c('team', '大学'), c('pitchType', '球種')] : [{ key: 'name', label: role === 'batting' ? '打者' : '捕手', player: true }, c('team', '大学')];
  const configs: Record<string, { columns: Column[]; minKey: string; minDefault: number; defaultSort: string; defaultDirection: 'asc' | 'desc' }> = {
    shape: { columns: [c('pitches', '球数'), c('velocitySd', '球速SD'), c('velocitySdN', '球速計測'), c('ivbSd', 'IVB SD'), c('hbSd', 'HB SD'), c('axisSd', '回転軸SD'), c('vaaSd', 'VAA SD')], minKey: 'pitches', minDefault: 25, defaultSort: 'velocitySd', defaultDirection: 'asc' },
    release: { columns: [c('pitches', '球数'), c('heightSd', '高さSD cm'), c('sideSd', '横SD cm'), c('extensionSd', 'Ext SD cm')], minKey: 'pitches', minDefault: 25, defaultSort: 'extensionSd', defaultDirection: 'asc' },
    retention: { columns: [c('retentionGames', '対象登板'), c('velocityRetention', '球速維持率', 'rate')], minKey: 'retentionGames', minDefault: 1, defaultSort: 'velocityRetention', defaultDirection: 'desc' },
    angle: { columns: [c('pitches', '球数'), c('vaaDelta', 'VAA差 °'), c('vaaSamples', 'VAA計測'), c('effectiveDelta', 'Effective Velo差 km/h'), c('effectiveSamples', '球速計測')], minKey: 'pitches', minDefault: 25, defaultSort: 'vaaDelta', defaultDirection: 'desc' },
    finish: { columns: [c('twoStrikePitches', '2ストライク球'), c('putAwayKs', '三振'), c('putAwayRate', 'PutAway%', 'rate'), c('heartShare', 'Heart%', 'rate'), c('edgeShare', 'Edge%', 'rate'), c('chaseShare', 'Chase%', 'rate'), c('wasteShare', 'Waste%', 'rate')], minKey: 'twoStrikePitches', minDefault: 20, defaultSort: 'putAwayRate', defaultDirection: 'desc' },
    contact: { columns: [c('groundEv', 'ゴロEV'), c('groundN', 'ゴロ数'), c('lineEv', 'ライナーEV'), c('lineN', 'ライナー数'), c('flyEv', 'フライEV'), c('flyN', 'フライ数'), c('angleSd', '角度SD °'), c('pullAirRate', 'Pull Air%', 'rate')], minKey: 'bbe', minDefault: 10, defaultSort: 'lineEv', defaultDirection: 'desc' },
    damage: { columns: [c('zoneBbe', 'ゾーン内打球'), c('zoneSwingRate', 'ゾーンSwing%', 'rate'), c('zoneContactRate', 'ゾーンContact%', 'rate'), c('zoneAvgEv', 'ゾーンEV'), c('zoneHardHitRate', 'ゾーンHardHit%', 'rate'), c('zoneBarrelRate', 'ゾーンBarrel%', 'rate'), c('heartAvgEv', 'Heart EV'), c('heartBbe', 'Heart打球')], minKey: 'zoneBbe', minDefault: 10, defaultSort: 'zoneAvgEv', defaultDirection: 'desc' },
    decision: { columns: [c('decisionSamples', '判定対象球'), c('goodDecisionRate', 'Good Decision%', 'rate'), c('twoStrikeContactRate', '2ストライクContact%', 'rate'), c('twoStrikeSwings', '2ストライクSwing')], minKey: 'decisionSamples', minDefault: 30, defaultSort: 'goodDecisionRate', defaultDirection: 'desc' },
    throw: { columns: [c('exchangeSamples', '分解送球数'), c('pairedPopTime', '平均Pop 秒', 'seconds'), c('avgExchange', '平均Exchange 秒', 'seconds'), c('avgFlight', '平均飛行 秒', 'seconds'), c('avgThrowSpeed', '平均送球 km/h'), c('maxThrowSpeed', '最高送球 km/h'), c('throwSamples', '速度計測')], minKey: 'exchangeSamples', minDefault: 1, defaultSort: 'avgExchange', defaultDirection: 'asc' },
  };
  const config = configs[group] ?? configs[developmentOptions(board)[0][0]];
  return { ...config, rows: source, columns: [...base, ...config.columns], playerKey: role === 'pitching' ? 'pitcherId' : 'id' };
}

export const DEVELOPMENT_MIN_LABELS: Record<string, string> = { retentionGames: '登板数', twoStrikePitches: '2ストライク球', bbe: 'EV計測打球', zoneBbe: 'ゾーン内打球', decisionSamples: '判定対象球', exchangeSamples: '分解送球数' };
