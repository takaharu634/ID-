import type { Dataset, Row } from './dataset-types';
import { qabAppearances } from './qab.ts';
import { numberedAppearances, catcherDevelopment } from './development-metrics.ts';
import { umpireRankingRows } from './umpire-consistency.ts';

type Column = { key: string; label: string; format?: 'number' | 'rate' | 'decimal' | 'seconds'; player?: boolean };
type Spec = { label: string; metric: string; minKey: string; minimum: number; role: 'pitching' | 'batting' | 'catching' | 'umpiring'; format?: Column['format']; metricLabel?: string; low?: boolean; description: string; extra?: Column[] };
const c = (key: string, label: string, format?: Column['format']): Column => ({ key, label, format });
export const SELECTED_RANKINGS: Record<string, Spec> = {
  pitching_kbb: { label: 'K−BB％', metric: 'kMinusBbRate', minKey: 'pa', minimum: 20, role: 'pitching', format: 'rate', description: '奪三振率−四球率。死球はこの計算に含めません。' },
  pitching_csw: { label: 'CSW％', metric: 'cswRate', minKey: 'pitches', minimum: 100, role: 'pitching', format: 'rate', description: '見逃しストライクと空振りの合計÷投球数です。' },
  pitching_walk_hbp: { label: '四死球率', metric: 'walkHbpRate', minKey: 'pa', minimum: 20, role: 'pitching', format: 'rate', low: true, description: '（与四球＋与死球）÷完了した対戦打席。四球率のランキングをこの項目に統合しています。' },
  pitching_ops: { label: '被OPS', metric: 'opsAllowed', minKey: 'pa', minimum: 20, role: 'pitching', format: 'decimal', low: true, description: '収録打席から算出した被出塁率＋被長打率です。' },
  pitching_whip: { label: 'WHIP', metric: 'whip', minKey: 'pitches', minimum: 100, role: 'pitching', format: 'decimal', low: true, description: '（被安打＋与四球）÷投球回。死球は含めません。' },
  pitching_hardhit: { label: '被強打率', metric: 'hardHitRateAllowed', minKey: 'allowedBbe', minimum: 10, role: 'pitching', format: 'rate', low: true, description: '計測された非バントのフェア打球のうち、152.9km/h以上を許した割合です。' },
  pitching_strikes: { label: 'ストライク率', metric: 'selectedStrikeRate', minKey: 'decisionPitches', minimum: 100, role: 'pitching', format: 'rate', description: '見逃しストライク・空振り・ファウル・インプレー÷判定のある投球です。' },
  pitching_first_strikes: { label: '初球ストライク率', metric: 'selectedFirstStrikeRate', minKey: 'firstPitches', minimum: 20, role: 'pitching', format: 'rate', description: '打席の初球でストライク結果を得た割合です。インプレーも含みます。' },
  pitching_quick_two: { label: '3球以内の2ストライク到達率', metric: 'quickTwoStrikeRate', minKey: 'completePa', minimum: 20, role: 'pitching', format: 'rate', description: '初球から連続して収録された完了打席のうち、3球目までに2ストライクへ到達した割合。早いカウントのインプレーは到達に数えません。' },
  pitching_whiffs: { label: '空振り率', metric: 'selectedWhiffRate', minKey: 'swings', minimum: 20, role: 'pitching', format: 'rate', description: '空振り数÷スイング数です。' },
  pitching_zone_whiffs: { label: 'ゾーン内空振り率', metric: 'zoneWhiffRate', minKey: 'zoneSwings', minimum: 20, role: 'pitching', format: 'rate', description: '固定ゾーン内の空振り数÷ゾーン内スイング数です。' },
  pitching_chase: { label: 'チェイス率', metric: 'selectedChaseRate', minKey: 'outsidePitches', minimum: 20, role: 'pitching', format: 'rate', description: 'ゾーン外のスイング数÷位置が分かるゾーン外投球数です。' },
  pitching_high_fastball: { label: '高めストレート空振り率', metric: 'highFastballWhiffRate', minKey: 'highFastballSwings', minimum: 10, role: 'pitching', format: 'rate', description: '高さ0.85〜1.05m・横±0.254mのストレートに対する空振り数÷スイング数です。' },
  pitching_fastball_velocity: { label: '平均ストレート球速', metric: 'fastballAverage', minKey: 'fastballSamples', minimum: 25, role: 'pitching', description: '選択シーズンのストレートの平均球速です。' },
  pitching_fastball_extension: { label: 'ストレート平均エクステンション', metricLabel: '平均エクステンション m', metric: 'fastballExtension', minKey: 'fastballExtensionSamples', minimum: 25, role: 'pitching', format: 'decimal', description: '選択シーズンのストレートだけを対象に、エクステンションの計測値を投球ごとに平均します。単位はm、長い順に表示します。未計測・負の値・リリース信頼度Lowの投球は除外します。最低件数は有効な計測ストレート数です。' },
  pitching_velocity_retention: { label: '球速維持', metricLabel: '球速維持率', metric: 'velocityRetention', minKey: 'lateFastballSamples', minimum: 10, role: 'pitching', format: 'rate', description: '投手本人のシーズン平均ストレート球速を基準に、登板61球目以降の平均球速を比較します。登板球数は全球種を数えます。', extra: [c('fastballAverage', '基準平均 km/h'), c('lateFastballAverage', '61球目以降 km/h'), c('velocityDelta', '平均との差 km/h'), c('middleVelocityDelta', '31〜60球の差 km/h'), c('finalVelocityDelta', '91球目以降の差 km/h'), c('velocityStatus', '維持状況')] },
  pitching_pitch_count: { label: '投球数', metric: 'pitches', minKey: 'pitches', minimum: 1, role: 'pitching', description: '選択シーズンに収録された投球数です。' },
  batting_iso: { label: 'ISO', metric: 'iso', minKey: 'pa', minimum: 20, role: 'batting', format: 'decimal', description: '収録打席の長打率−打率。長打による上積みを比較します。' },
  batting_obp: { label: '出塁率', metric: 'onBasePercentage', minKey: 'pa', minimum: 20, role: 'batting', format: 'decimal', description: 'TrackMan収録打席による出塁率。既存OPSと同じ集計基準です。' },
  batting_babip: { label: 'BABIP', metric: 'babip', minKey: 'babipSamples', minimum: 10, role: 'batting', format: 'decimal', description: '本塁打を除く安打÷本塁打・犠打を除くインプレー打球。犠飛は分母に含めます。' },
  batting_pitch_count: { label: '投球数', metric: 'pitches', minKey: 'pitches', minimum: 1, role: 'batting', description: '打席で対戦した収録投球の合計です。', extra: [c('pitchesPerPa', '1打席当たり投球数')] },
  batting_fastball_response: { label: '145km/h以上の速球対応', metricLabel: '球質を考慮したEV差 km/h', metric: 'fastballEvDifference', minKey: 'matchedFastballBbe', minimum: 5, role: 'batting', description: '145km/h以上のストレートの打球速度を、球速・変化量・リリース・コースが近い球の他打者の打球速度と比較します。プラスほど比較対象より強い打球。', extra: [c('matchedFastballEv', '本人の平均EV km/h'), c('expectedFastballEv', '近い球の平均EV km/h'), c('fastballContactRate', '対速球コンタクト率', 'rate')] },
  catching_exchange: { label: '平均持ち替え時間', metric: 'avgExchange', minKey: 'exchangeSamples', minimum: 1, role: 'catching', format: 'seconds', low: true, description: '二塁送球の捕球からリリースまでの平均時間です。ポップタイムと分解時間が整合する同一送球を使います。' },
  umpiring_consistency: { label: '判定の一貫性', metric: 'consistencyRate', minKey: 'consistencySamples', minimum: 30, role: 'umpiring', format: 'rate', description: '同じ球審の別試合で、位置差5cm以内・打者左右とカウント区分が同じ投球の判定一致率です。', extra: [c('disagreementRate', '判定が分かれた割合', 'rate')] },
  umpiring_count: { label: 'カウント別のゾーン変化', metricLabel: '最大判定率差 pt', metric: 'countChange', minKey: 'countSamples', minimum: 15, role: 'umpiring', low: true, description: '近い位置・同じ打者左右で、通常カウントに対するストライク判定率の変化を比較。差はpt、プラスはストライク増です。', extra: [c('twoStrikeGap', '2ストライク差 pt'), c('threeBallGap', '3ボール差 pt'), c('fullCountGap', '3−2差 pt')] },
  umpiring_sides: { label: '右左での判定差', metricLabel: '左右差の絶対値 pt', metric: 'sideDifference', minKey: 'sideSamples', minimum: 15, role: 'umpiring', low: true, description: '捕手視点で近い位置・同じカウント区分の判定を左右打者で比較。右−左の差がプラスなら右打者でストライク増です。', extra: [c('rightLeftGap', '右−左 pt')] },
};

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const rate = (a: number, b: number) => b > 0 ? a / b : null;
const mean = (p: Row[], key: string) => { const v = p.map(x => x[key]).filter(finite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const swing = (p: Row) => ['空振り', 'ファウル', 'ファウルフライ', 'インプレー'].includes(p.result);
const strike = (p: Row) => swing(p) || p.result === '見逃しストライク';
const decision = (p: Row) => strike(p) || ['ボール', 'ワンバウンド', '死球', '敬遠'].includes(p.result);
const located = (p: Row) => finite(p.plateX) && finite(p.plateZ) && String(p.pitchLocationConfidence).toLowerCase() !== 'low';
const zone = (p: Row) => Math.abs(p.plateX) <= .254 && p.plateZ >= .45 && p.plateZ <= 1.05;
const fair = (p: Row) => p.result === 'インプレー' && p.hitType !== 'Bunt' && finite(p.exitVelocity) && p.exitVelocity > 0 && String(p.hitLaunchConfidence).toLowerCase() !== 'low';
const fastball = (p: Row) => p.pitchType === 'ストレート' && finite(p.velocity) && p.velocity > 0 && String(p.pitchReleaseConfidence).toLowerCase() !== 'low';
function grouped(rows: Row[], field: string) { const result = new Map<string, Row[]>(); for (const p of rows) { const id = p[field]; if (!id) continue; const a = result.get(id) ?? []; a.push(p); result.set(id, a); } return result; }

export function velocityBaseline(rows: Row[]): Row {
  const fb = rows.filter(fastball), average = mean(fb, 'velocity');
  const numbered = numberedAppearances(rows).flatMap(a => a.rows).filter(fastball);
  const late = numbered.filter(p => p.appearancePitch >= 61), middle = numbered.filter(p => p.appearancePitch >= 31 && p.appearancePitch <= 60), final = numbered.filter(p => p.appearancePitch >= 91);
  const lateAverage = mean(late, 'velocity'), delta = average !== null && lateAverage !== null ? lateAverage - average : null;
  return { fastballAverage: average, fastballSamples: fb.length, lateFastballSamples: late.length, lateFastballAverage: lateAverage,
    velocityDelta: delta, velocityRetention: average && lateAverage !== null ? lateAverage / average : null,
    middleVelocityDelta: average !== null && middle.length ? mean(middle, 'velocity')! - average : null,
    finalVelocityDelta: average !== null && final.length ? mean(final, 'velocity')! - average : null,
    velocityStatus: delta === null ? '—' : Math.abs(delta) < .05 ? '平均付近' : delta >= 0 ? '平均以上を維持' : '平均を下回る' };
}

// Matched-contact comparison, NOT a pure reaction-speed score. Exclude the
// target hitter from every reference pool; never train on the target outcome.
export function fastballResponseRows(pitches: Row[]) {
  const features: [string, number][] = [['velocity', 3], ['ivb', 8], ['hb', 10], ['releaseHeight', 15], ['extension', 25], ['plateX', .20], ['plateZ', .25]];
  const eligible = pitches.filter(p => fastball(p) && p.velocity >= 145 && fair(p) && located(p) && features.every(([key]) => finite(p[key])) && ['右', '左'].includes(p.batterSide) && ['右', '左'].includes(p.pitcherThrows) && String(p.pitchMovementConfidence).toLowerCase() !== 'low');
  const pairs: Row[] = [];
  for (const p of eligible) {
    const refs = eligible.flatMap(q => {
      if (q.batterId === p.batterId || q.batterSide !== p.batterSide || q.pitcherThrows !== p.pitcherThrows || q.year !== p.year || q.season !== p.season) return [];
      const distances = features.map(([key, scale]) => (p[key] - q[key]) / scale);
      if (distances.some(d => Math.abs(d) > 2)) return [];
      const d2 = distances.reduce((s, d) => s + d * d, 0);
      return d2 <= 7 ? [{ q, weight: Math.exp(-d2 / 2) }] : [];
    }).sort((a, b) => b.weight - a.weight).slice(0, 40);
    const weight = refs.reduce((s, r) => s + r.weight, 0), squares = refs.reduce((s, r) => s + r.weight ** 2, 0);
    if (refs.length < 5 || !squares || weight ** 2 / squares < 5 || new Set(refs.map(r => r.q.pitcherId)).size < 2) continue;
    pairs.push({ batterId: p.batterId, actual: p.exitVelocity, expected: refs.reduce((s, r) => s + r.weight * r.q.exitVelocity, 0) / weight });
  }
  return new Map([...grouped(pairs, 'batterId')].map(([id, rows]) => [id, { matchedFastballBbe: rows.length, matchedFastballEv: mean(rows, 'actual'), expectedFastballEv: mean(rows, 'expected'), fastballEvDifference: mean(rows, 'actual')! - mean(rows, 'expected')! }]));
}

const cache = new WeakMap<Dataset, Record<string, Row[]>>();
export function selectedRankingRows(data: Dataset) {
  const old = cache.get(data); if (old) return old;
  const pitcherPitches = grouped(data.pitches, 'pitcherId'), batterPitches = grouped(data.pitches, 'batterId');
  const pas = qabAppearances(data.pitches), pitcherPas = grouped(pas.map(pa => ({ ...pa, pitcherId: pa.terminal.pitcherId })), 'pitcherId'), batterPas = grouped(pas, 'batterId');
  const pitchers = data.pitchers.map(player => {
    const rows = pitcherPitches.get(player.id) ?? [], decisions = rows.filter(decision), swings = decisions.filter(swing), zoneSwings = swings.filter(p => located(p) && zone(p)), outside = decisions.filter(p => located(p) && !zone(p));
    const extensions = rows.filter(p => p.pitchType === 'ストレート' && finite(p.extension) && p.extension >= 0 && String(p.pitchReleaseConfidence).trim().toLowerCase() !== 'low');
    const extensionAverage = mean(extensions, 'extension');
    const first = rows.filter(p => p.balls === 0 && p.strikes === 0 && decision(p));
    const complete = (pitcherPas.get(player.id) ?? []).filter(pa => !pa.incompletePitchSequence && pa.pitches.every((p: Row) => p.pitcherId === player.id));
    const quick = complete.filter(pa => pa.pitches.slice(0, 3).some((p: Row) => p.strikes === 2 || p.strikes === 1 && ['空振り', '見逃しストライク', 'ファウル', 'ファウルフライ'].includes(p.result)));
    const high = rows.filter(p => fastball(p) && located(p) && Math.abs(p.plateX) <= .254 && p.plateZ >= .85 && p.plateZ <= 1.05 && swing(p));
    const bbe = rows.filter(fair), outcomes = pitcherPas.get(player.id) ?? [], hits = outcomes.filter(pa => ['単打', '二塁打', '三塁打', '本塁打'].includes(pa.result));
    const ab = outcomes.filter(pa => !['四球', '死球', '犠打', '犠飛', '犠打・犠飛'].includes(pa.result)).length;
    const tb = hits.reduce((s, pa) => s + ({ '単打': 1, '二塁打': 2, '三塁打': 3, '本塁打': 4 }[pa.result as string] ?? 0), 0);
    const obp = rate(hits.length + (player.walks ?? 0) + (player.hbp ?? 0), player.pa), slg = rate(tb, ab);
    return { ...player, kMinusBbRate: rate(player.strikeouts - player.walks, player.pa), walkHbpRate: rate(player.walks + player.hbp, player.pa), opsAllowed: obp !== null && slg !== null ? obp + slg : null,
      allowedBbe: bbe.length, hardHitRateAllowed: player.hardHitRateAllowed,
      decisionPitches: decisions.length, selectedStrikeRate: rate(decisions.filter(strike).length, decisions.length), firstPitches: first.length, selectedFirstStrikeRate: rate(first.filter(strike).length, first.length),
      completePa: complete.length, quickTwoStrikeRate: rate(quick.length, complete.length), swings: swings.length, selectedWhiffRate: rate(swings.filter(p => p.result === '空振り').length, swings.length),
      zoneSwings: zoneSwings.length, zoneWhiffRate: rate(zoneSwings.filter(p => p.result === '空振り').length, zoneSwings.length), outsidePitches: outside.length, selectedChaseRate: rate(outside.filter(swing).length, outside.length),
      highFastballSwings: high.length, highFastballWhiffRate: rate(high.filter(p => p.result === '空振り').length, high.length),
      fastballExtension: extensionAverage === null ? null : extensionAverage / 100, fastballExtensionSamples: extensions.length, ...velocityBaseline(rows) };
  });
  const batters = data.batters.map(player => {
    const rows = batterPitches.get(player.id) ?? [], appearances = batterPas.get(player.id) ?? [];
    const record = player.trackmanRecord ?? player;
    const iso = record.ab > 0 ? ((record.doubles ?? 0) + 2 * (record.triples ?? 0) + 3 * (record.homeRuns ?? 0)) / record.ab : null;
    const bip = appearances.filter(pa => !['四球', '死球', '三振', '本塁打', '犠打'].includes(pa.result) && !(pa.result === '犠打・犠飛' && pa.terminal.hitType === 'Bunt'));
    const unknownSacrifice = bip.some(pa => pa.result === '犠打・犠飛' && !['FlyBall', 'LineDrive', 'Popup'].includes(pa.terminal.hitType));
    const fbSwings = rows.filter(p => fastball(p) && p.velocity >= 145 && swing(p) && p.hitType !== 'Bunt');
    return { ...player, pa: record.pa, iso,
      babipSamples: unknownSacrifice ? 0 : bip.length, babip: unknownSacrifice ? null : rate(bip.filter(pa => ['単打', '二塁打', '三塁打'].includes(pa.result)).length, bip.length),
      pitchesPerPa: rate(rows.length, record.pa), fastballContactRate: rate(fbSwings.filter(p => p.result !== '空振り').length, fbSwings.length) };
  });
  const catchers = data.catchers.map(player => ({ ...player, ...catcherDevelopment(data.pitches.filter(p => p.catcherId === player.id)) }));
  const result: Record<string, Row[]> = { pitching: pitchers, batting: batters, catching: catchers };
  cache.set(data, result); return result;
}

const responseCache = new WeakMap<Dataset, Row[]>();
export function selectedBoardConfig(data: Dataset, board: string) {
  const spec = SELECTED_RANKINGS[board]; if (!spec) return null;
  let rows: Row[];
  if (spec.role === 'umpiring') rows = umpireRankingRows(data);
  else if (board === 'batting_fastball_response') {
    let cached = responseCache.get(data);
    if (!cached) { const response = fastballResponseRows(data.pitches); cached = selectedRankingRows(data).batting.map(p => ({ ...p, matchedFastballBbe: 0, ...response.get(p.id) })); responseCache.set(data, cached); }
    rows = cached;
  } else rows = selectedRankingRows(data)[spec.role];
  if (board === 'pitching_fastball_extension') rows = rows.filter(p => finite(p.fastballExtension));
  const base: Column[] = [{ key: 'name', label: spec.role === 'pitching' ? '投手' : spec.role === 'batting' ? '打者' : spec.role === 'catching' ? '捕手' : '球審', player: spec.role !== 'umpiring' }];
  if (spec.role !== 'umpiring') base.push(c('team', '大学'));
  return { rows: spec.role === 'umpiring' ? rows.filter(p => finite(p[spec.metric])) : rows, columns: [...base, c(spec.metric, spec.metricLabel ?? spec.label, spec.format), ...(spec.extra ?? [])], minKey: spec.minKey, minDefault: spec.minimum, playerKey: 'id', defaultSort: spec.metric, defaultDirection: spec.low ? 'asc' as const : 'desc' as const };
}

export const SELECTED_MIN_LABELS: Record<string, string> = { allowedBbe: '被打球', decisionPitches: '投球', firstPitches: '初球', completePa: '完了打席', swings: 'スイング', zoneSwings: 'ゾーン内スイング', outsidePitches: 'ゾーン外投球', highFastballSwings: '高め直球スイング', fastballSamples: 'ストレート', fastballExtensionSamples: 'エクステンション計測ストレート', lateFastballSamples: '61球目以降ストレート', babipSamples: 'インプレー打球', matchedFastballBbe: '比較可能打球', consistencySamples: '比較可能判定', countSamples: '比較可能判定', sideSamples: '比較可能判定' };
