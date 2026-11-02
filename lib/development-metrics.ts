import type { Row } from './dataset-types';
import { measuredNumber, meanOf } from './numeric-summary.ts';

export const DEVELOPMENT_VERSION = 'tohto-development-2026-09-v1';
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const ratio = (a: number, b: number) => b ? a / b : null;
const low = (value: unknown) => String(value).toLowerCase() === 'low';
export const isDevelopmentSwing = (p: Row) => ['空振り', 'インプレー', 'ファウル', 'ファウルフライ'].includes(p.result);
const isDecision = (p: Row) => isDevelopmentSwing(p) || ['ボール', 'ワンバウンド', '見逃しストライク'].includes(p.result);
const isFair = (p: Row) => p.result === 'インプレー' && p.hitType !== 'Bunt' && !low(p.hitLaunchConfidence);
const shapeValid = (p: Row) => !low(p.pitchReleaseConfidence) && !(finite(p.releaseHeight) && p.releaseHeight < 0);
const located = (p: Row) => finite(p.plateX) && finite(p.plateZ) && !low(p.pitchLocationConfidence);
export const developmentInZone = (p: Row) => located(p) && Math.abs(p.plateX) <= .254 && p.plateZ >= .45 && p.plateZ <= 1.05;

/** Same fixed-zone geometry as the existing course panel; not MLB's batter-specific zone. */
export function developmentZone(p: Row): 'heart' | 'edge' | 'chase' | 'waste' | null {
  if (!located(p)) return null;
  const x = p.plateX, z = p.plateZ;
  const dx = Math.max(-.254 - x, x - .254, 0), dz = Math.max(.45 - z, z - 1.05, 0);
  if (developmentInZone(p)) return Math.min(x + .254, .254 - x, z - .45, 1.05 - z) <= .085 ? 'edge' : 'heart';
  const distance = Math.hypot(dx, dz);
  return distance <= .085 ? 'edge' : distance <= .17 ? 'chase' : 'waste';
}

/** Sample SD, with missing values kept out of the denominator. */
export function sampleSd(rows: Row[], key: string): number | null {
  const values = rows.map(p => measuredNumber(p[key])).filter((n): n is number => n !== null);
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1));
}

export function circularSd(rows: Row[]): number | null {
  const angles = rows.map(p => p.spinAxis).filter(finite);
  if (angles.length < 2) return null;
  const c = angles.reduce((s, a) => s + Math.cos(a * Math.PI / 180), 0) / angles.length;
  const s = angles.reduce((v, a) => v + Math.sin(a * Math.PI / 180), 0) / angles.length;
  const r = Math.min(1, Math.hypot(c, s));
  return r < 1e-10 ? null : Math.sqrt(-2 * Math.log(r)) * 180 / Math.PI;
}

function groupBy(rows: Row[], key: (p: Row) => string): Map<string, Row[]> {
  const map = new Map<string, Row[]>();
  for (const row of rows) { const k = key(row); const group = map.get(k); if (group) group.push(row); else map.set(k, [row]); }
  return map;
}
const seasonOf = (p: Row) => `${p.year ?? String(p.date).slice(0, 4)}|${p.season ?? (Number(String(p.date).slice(5, 7)) >= 7 ? '秋' : '春')}`;
const isFastball = (p: Row) => p.pitchType === 'ストレート';
type VaaModel = { n: number; intercept: number; slope: number; min: number; max: number };
export type VaaModels = Map<string, VaaModel>;
const vaaCache = new WeakMap<Row[], VaaModels>();

/** Refit per season on normalized straight fastballs. Never pool seasons or extrapolate. */
export function buildVaaModels(rows: Row[]): VaaModels {
  const cached = vaaCache.get(rows); if (cached) return cached;
  const result: VaaModels = new Map();
  for (const [season, group] of groupBy(rows.filter(p => isFastball(p) && shapeValid(p) && located(p) && finite(p.vaa)), seasonOf)) {
    if (group.length < 100 || new Set(group.map(p => p.pitcherId)).size < 3) continue;
    const x = meanOf(group, 'plateZ')!, y = meanOf(group, 'vaa')!;
    const ss = group.reduce((s, p) => s + (p.plateZ - x) ** 2, 0);
    if (ss / group.length < .0025) continue;
    const slope = group.reduce((s, p) => s + (p.plateZ - x) * (p.vaa - y), 0) / ss;
    let min = Infinity, max = -Infinity;
    for (const p of group) { min = Math.min(min, p.plateZ); max = Math.max(max, p.plateZ); }
    result.set(season, { n: group.length, intercept: y - slope * x, slope, min, max });
  }
  vaaCache.set(rows, result); return result;
}

function vaaComparison(rows: Row[], models: VaaModels) {
  const pairs = rows.flatMap(p => {
    const model = models.get(seasonOf(p));
    if (!model || !isFastball(p) || !located(p) || !shapeValid(p) || !finite(p.vaa) || p.plateZ < model.min || p.plateZ > model.max) return [];
    const expected = model.intercept + model.slope * p.plateZ;
    return [{ actual: p.vaa, expected, delta: p.vaa - expected }];
  });
  return { vaaSamples: pairs.length, actualVaa: meanOf(pairs, 'actual'), expectedVaa: meanOf(pairs, 'expected'), vaaDelta: meanOf(pairs, 'delta') };
}

export function pitchDevelopment(rows: Row[], models: VaaModels): Row {
  const measured = rows.filter(shapeValid), zones = rows.map(developmentZone).filter(Boolean);
  const two = rows.filter(p => p.strikes === 2), strikeouts = two.filter(p => p.korbb === 'Strikeout');
  const ev = measured.filter(p => finite(p.effectiveVelocity) && p.effectiveVelocity > 0 && finite(p.velocity) && p.velocity > 0).map(p => ({ delta: p.effectiveVelocity - p.velocity }));
  const output: Row = { pitches: rows.length, twoStrikePitches: two.length, putAwayKs: strikeouts.length, putAwayRate: ratio(strikeouts.length, two.length),
    locatedPitches: zones.length, heartShare: ratio(zones.filter(z => z === 'heart').length, zones.length), edgeShare: ratio(zones.filter(z => z === 'edge').length, zones.length), chaseShare: ratio(zones.filter(z => z === 'chase').length, zones.length), wasteShare: ratio(zones.filter(z => z === 'waste').length, zones.length),
    axisSd: circularSd(measured.filter(p => !low(p.pitchMovementConfidence))), axisSamples: measured.filter(p => !low(p.pitchMovementConfidence) && finite(p.spinAxis)).length,
    effectiveDelta: meanOf(ev, 'delta'), effectiveSamples: ev.length, ...vaaComparison(measured, models) };
  for (const [field, metric] of [['velocity', 'velocitySd'], ['ivb', 'ivbSd'], ['hb', 'hbSd'], ['vaa', 'vaaSd'], ['releaseHeight', 'heightSd'], ['releaseSide', 'sideSd'], ['extension', 'extensionSd']]) {
    const valid = ['ivb', 'hb'].includes(field) ? measured.filter(p => !low(p.pitchMovementConfidence)) : field === 'vaa' ? measured.filter(p => !low(p.pitchLocationConfidence)) : measured;
    output[metric] = sampleSd(valid, field); output[`${metric}N`] = valid.filter(p => finite(p[field])).length;
  }
  return output;
}

/** Pitch numbers are counted among ALL pitches in the appearance, before filtering. */
export function numberedAppearances(allPitcherRows: Row[]) {
  return [...groupBy(allPitcherRows, p => `${p.pitcherId}|${p.gameId}`).values()].map(rows => {
    const ordered = [...rows].sort((a, b) => (a.pitchNo ?? Infinity) - (b.pitchNo ?? Infinity) || String(a.time ?? '').localeCompare(String(b.time ?? '')));
    const first = ordered[0];
    return { id: String(first.gameId), date: String(first.date), start: `${first.date}T${first.time || '00:00:00'}`, rows: ordered.map((p, i): Row => ({ ...p, appearancePitch: i + 1 })) };
  }).sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
}

export function pitcherDevelopmentReport(selected: Row[], allPitcherRows: Row[], leagueRows: Row[]) {
  const models = buildVaaModels(leagueRows);
  const pitchTypes = [...groupBy(selected, p => p.pitchType || '不明')].map(([pitchType, rows]): Row => ({ pitchType, ...pitchDevelopment(rows, models) })).sort((a, b) => b.pitches - a.pitches);
  const selectedIds = new Set(selected.map(p => p.id));
  const appearances = numberedAppearances(allPitcherRows);
  const releases: Row[] = [], workload: Row[] = [], maintenance: Row[] = [];
  const priorByType = new Map<string, Row[]>();
  for (const appearance of appearances) {
    const relevant = appearance.rows.filter(p => selectedIds.has(p.id));
    for (const [pitchType, rows] of groupBy(relevant, p => p.pitchType || '不明')) {
      const prior = (priorByType.get(`${seasonOf(rows[0])}|${pitchType}`) ?? []).filter(p => `${p.date}T${p.time || '00:00:00'}` < appearance.start && String(p.gameId) !== appearance.id);
      const current = rows.filter(shapeValid), baseline = prior.filter(shapeValid);
      const seasonVelocity = meanOf(allPitcherRows.filter(p => seasonOf(p) === seasonOf(rows[0]) && p.pitchType === pitchType && shapeValid(p) && finite(p.velocity) && p.velocity > 0), 'velocity');
      const release: Row = { gameId: appearance.id, date: appearance.date, pitchType, pitches: rows.length, baselinePitches: baseline.length };
      for (const [field, short] of [['releaseHeight', 'height'], ['releaseSide', 'side'], ['extension', 'extension']]) {
        const n = current.filter(p => finite(p[field])).length, b = baseline.filter(p => finite(p[field])).length;
        const avg = meanOf(current, field), old = meanOf(baseline, field);
        release[`${short}Mean`] = avg; release[`${short}Sd`] = sampleSd(current, field);
        release[`${short}Delta`] = n >= 3 && b >= 10 && avg !== null && old !== null ? avg - old : null;
      }
      releases.push(release);
      for (let i = 0; i < 5; i++) {
        const block = current.filter(p => Math.min(4, Math.floor((p.appearancePitch - 1) / 15)) === i);
        if (block.length) workload.push({ gameId: appearance.id, date: appearance.date, pitchType, bucket: i, segment: i === 4 ? '61球〜' : `${i * 15 + 1}〜${i * 15 + 15}球`, pitches: block.length,
          velocity: meanOf(block, 'velocity'), baselineVelocity: seasonVelocity, velocityDelta: seasonVelocity === null || meanOf(block, 'velocity') === null ? null : meanOf(block, 'velocity')! - seasonVelocity, ivb: meanOf(block.filter(p => !low(p.pitchMovementConfidence)), 'ivb'), extension: meanOf(block, 'extension'), releaseHeight: meanOf(block, 'releaseHeight') });
      }
      const first = current.filter(p => p.appearancePitch <= 15 && finite(p.velocity) && p.velocity > 0);
      const late = current.filter(p => p.appearancePitch >= 61 && finite(p.velocity) && p.velocity > 0);
      if (seasonVelocity !== null && seasonVelocity > 0 && late.length >= 3) maintenance.push({ gameId: appearance.id, date: appearance.date, pitchType,
        firstN: first.length, lateN: late.length, early: meanOf(first, 'velocity'), late: meanOf(late, 'velocity'), baselineVelocity: seasonVelocity, velocityDelta: meanOf(late, 'velocity')! - seasonVelocity, velocityRetention: meanOf(late, 'velocity')! / seasonVelocity });
    }
    for (const [type, rows] of groupBy(appearance.rows, p => `${seasonOf(p)}|${p.pitchType || '不明'}`)) priorByType.set(type, [...(priorByType.get(type) ?? []), ...rows]);
  }
  return { pitchTypes, releases, workload, maintenance };
}

export function contactType(p: Row): string | null {
  const tags: Record<string, string> = { GroundBall: 'ゴロ', LineDrive: 'ライナー', FlyBall: 'フライ', Popup: 'ポップフライ' };
  if (tags[p.hitType]) return tags[p.hitType];
  if (!finite(p.launchAngle)) return null;
  return p.launchAngle < 10 ? 'ゴロ' : p.launchAngle < 25 ? 'ライナー' : p.launchAngle < 50 ? 'フライ' : 'ポップフライ';
}
function barrel(p: Row) {
  const mph = p.exitVelocity / 1.609344, over = mph - 98;
  return mph >= 98 && p.launchAngle >= Math.max(8, 26 - over) && p.launchAngle <= Math.min(50, 30 + over * 1.5);
}
export function damageSummary(rows: Row[]): Row {
  const eligible = rows.filter(p => isDecision(p) && p.hitType !== 'Bunt');
  const swings = eligible.filter(isDevelopmentSwing), contacts = swings.filter(p => p.result !== '空振り');
  const batted = rows.filter(p => isFair(p) && finite(p.exitVelocity) && p.exitVelocity > 0);
  const angles = batted.filter(p => finite(p.launchAngle));
  return { pitches: eligible.length, swings: swings.length, contacts: contacts.length, bbe: batted.length, angleBbe: angles.length,
    swingRate: ratio(swings.length, eligible.length), contactRate: ratio(contacts.length, swings.length), avgEv: meanOf(batted, 'exitVelocity'),
    hardHitRate: ratio(batted.filter(p => p.exitVelocity >= 152.9).length, batted.length), barrelRate: ratio(angles.filter(barrel).length, angles.length) };
}

export function batterDevelopment(rows: Row[]) {
  const fair = rows.filter(isFair), ev = fair.filter(p => finite(p.exitVelocity) && p.exitVelocity > 0);
  const types = ['ゴロ', 'ライナー', 'フライ', 'ポップフライ'].map(type => {
    const group = ev.filter(p => contactType(p) === type);
    return { type, bbe: group.length, avgEv: meanOf(group, 'exitVelocity'), hardHitRate: ratio(group.filter(p => p.exitVelocity >= 152.9).length, group.length) };
  });
  const directionRows = fair.filter(p => finite(p.launchAngle) && finite(p.sprayAngle) && ['右', '左'].includes(p.batterSide));
  const pull = directionRows.filter(p => ['ライナー', 'フライ'].includes(contactType(p) ?? '') && (p.batterSide === '右' ? p.sprayAngle < -15 : p.sprayAngle > 15));
  const decisions = rows.filter(p => isDecision(p) && p.hitType !== 'Bunt' && developmentZone(p) && developmentZone(p) !== 'edge');
  const good = decisions.filter(p => developmentZone(p) === 'heart' ? isDevelopmentSwing(p) : !isDevelopmentSwing(p));
  const two = rows.filter(p => p.strikes === 2 && p.hitType !== 'Bunt' && isDevelopmentSwing(p));
  const zone = damageSummary(rows.filter(developmentInZone)), heart = damageSummary(rows.filter(p => developmentZone(p) === 'heart'));
  const zones = ['heart', 'edge', 'chase', 'waste'].map(zone => {
    const group = rows.filter(p => p.hitType !== 'Bunt' && isDecision(p) && developmentZone(p) === zone);
    return { zone, pitches: group.length, swingRate: ratio(group.filter(isDevelopmentSwing).length, group.length) };
  });
  return { types, zone, heart, zones, summary: { bbe: ev.length, groundEv: types[0].avgEv, groundN: types[0].bbe, lineEv: types[1].avgEv, lineN: types[1].bbe, flyEv: types[2].avgEv, flyN: types[2].bbe,
    angleSd: sampleSd(fair, 'launchAngle'), angleSamples: fair.filter(p => finite(p.launchAngle)).length,
    pullAirRate: ratio(pull.length, directionRows.length), pullAirSamples: directionRows.length, goodDecisionRate: ratio(good.length, decisions.length), goodDecisions: good.length, decisionSamples: decisions.length,
    twoStrikeContactRate: ratio(two.filter(p => p.result !== '空振り').length, two.length), twoStrikeSwings: two.length,
    zoneAvgEv: zone.avgEv, zoneHardHitRate: zone.hardHitRate, zoneBarrelRate: zone.barrelRate, zoneBbe: zone.bbe, zoneSwingRate: zone.swingRate, zoneContactRate: zone.contactRate,
    heartAvgEv: heart.avgEv, heartHardHitRate: heart.hardHitRate, heartBbe: heart.bbe } };
}

export function catcherDevelopment(rows: Row[]): Row {
  const second = rows.filter(p => finite(p.basePositionX) && p.basePositionX >= 35 && p.basePositionX <= 43 && finite(p.basePositionZ) && Math.abs(p.basePositionZ) <= 5
    && ![p.throwCatchConfidence, p.throwReleaseConfidence, p.throwLocationConfidence].some(low)
    && finite(p.popTime) && p.popTime >= 1.6 && p.popTime <= 2.5);
  const paired = second.filter(p => finite(p.exchangeTime) && p.exchangeTime > 0 && finite(p.timeToBase) && p.timeToBase > 0 && Math.abs(p.popTime - p.exchangeTime - p.timeToBase) <= .03);
  const speeds = second.filter(p => finite(p.throwSpeed) && p.throwSpeed > 0);
  const fastest = paired.reduce<Row | null>((best, p) => !best || p.popTime < best.popTime ? p : best, null);
  return { secondThrows: second.length, exchangeSamples: paired.length, throwSamples: speeds.length,
    pairedPopTime: meanOf(paired, 'popTime'), avgExchange: meanOf(paired, 'exchangeTime'), avgFlight: meanOf(paired, 'timeToBase'),
    avgThrowSpeed: meanOf(speeds, 'throwSpeed'), maxThrowSpeed: speeds.length ? speeds.reduce((max, p) => Math.max(max, p.throwSpeed), -Infinity) : null,
    fastestPairedPop: fastest?.popTime ?? null, fastestExchange: fastest?.exchangeTime ?? null, fastestFlight: fastest?.timeToBase ?? null,
    throws: second.map(p => ({ date: p.date, popTime: p.popTime, exchangeTime: paired.includes(p) ? p.exchangeTime : null, timeToBase: paired.includes(p) ? p.timeToBase : null, throwSpeed: finite(p.throwSpeed) && p.throwSpeed > 0 ? p.throwSpeed : null })) };
}

const rankCache = new WeakMap<Row[], { pitching: Row[]; batting: Row[]; catching: Row[] }>();
export function developmentRankings(pitches: Row[]): { pitching: Row[]; batting: Row[]; catching: Row[] } {
  const cached = rankCache.get(pitches); if (cached) return cached;
  const models = buildVaaModels(pitches), pitching: Row[] = [];
  for (const [pitcherId, playerRows] of groupBy(pitches, p => p.pitcherId)) {
    const report = pitcherDevelopmentReport(playerRows, playerRows, pitches);
    for (const row of report.pitchTypes) {
      const p = playerRows[0], maintenance = report.maintenance.filter(m => m.pitchType === row.pitchType);
      pitching.push({ ...row, pitcherId, pitcher: p.pitcher, pitcherKanji: p.pitcherKanji, team: p.pitcherTeam, velocityRetention: meanOf(maintenance, 'velocityRetention'), retentionGames: maintenance.length, ...vaaComparison(playerRows.filter(p => p.pitchType === row.pitchType), models) });
    }
  }
  const batting = [...groupBy(pitches, p => p.batterId)].map(([id, rows]) => ({ id, name: rows[0].batter, kanji: rows[0].batterKanji, team: rows[0].batterTeam, ...batterDevelopment(rows).summary }));
  const catching = [...groupBy(pitches.filter(p => p.catcherId), p => p.catcherId)].map(([id, rows]) => ({ id, name: rows[0].catcher, kanji: rows[0].catcherKanji, team: rows[0].catcherTeam, ...catcherDevelopment(rows) }));
  const result = { pitching, batting, catching }; rankCache.set(pitches, result); return result;
}
