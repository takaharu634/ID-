import type { Row } from './dataset-types';
import legacyStadiums from './qab-legacy-stadiums.json' with { type: 'json' };

export const QAB_VERSION = 'tohto-qab-2026-09-25-v1';
export const QAB_REASONS = ['安打', '四球', '死球', '進塁打', '犠打・犠飛', '8球以上', 'A打球', 'B打球'] as const;
export type QabReason = typeof QAB_REASONS[number];
export const QAB_RULES = { fenceMargin: 3, bExitVelocity: 150, groundMinAngle: -10, groundMaxAngle: 10, groundMaxDistance: 50, lineMaxAngle: 30, lineMinDistance: 40 } as const;

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const hits = new Set(['単打', '二塁打', '三塁打', '本塁打']);
const validPlays = new Set([...hits, 'アウト', '失策', '野選', '進塁打', '犠打', '犠飛', '犠打・犠飛']);

/** Public dimensions, not a surveyed fence polygon. Interpolate radial distances
 * at CF / gaps / foul poles. No default stadium for unrecognized new games.
 * Sources and approximation limits: docs/QAB.md.
 */
export function fenceDistance(stadium: unknown, bearing: unknown): number | null {
  if (!['JinguStadium', '明治神宮野球場', '神宮球場'].includes(String(stadium)) || !finite(bearing) || Math.abs(bearing) > 45) return null;
  const a = Math.abs(bearing);
  return a <= 22.5 ? 120 + (112.3 - 120) * a / 22.5 : 112.3 + (97.5 - 112.3) * (a - 22.5) / 22.5;
}

export type ContactQuality = {
  grade: 'A' | 'B' | null; aEligible: boolean; bEligible: boolean;
  ev: number | null; angle: number | null; distance: number | null; bearing: number | null;
  stadium: string; fence: number | null; aThreshold: number | null;
};

export function contactQuality(p: Row): ContactQuality {
  // New imports preserve raw precision; legacy rows retain their recorded precision.
  const measured = p.qabMeasurements;
  const ev = measured ? measured.ev : p.exitVelocity;
  const angle = measured ? measured.angle : p.launchAngle;
  const distance = measured ? measured.distance : p.distance;
  const bearing = measured ? measured.bearing : p.sprayAngle;
  const stadium = String(p.stadium ?? (legacyStadiums as Record<string, string>)[p.gameId] ?? '');
  const fence = fenceDistance(stadium, bearing);
  const aThreshold = fence === null ? null : fence - QAB_RULES.fenceMargin;
  const fair = p.result === 'インプレー' && p.hitType !== 'Bunt' && (!finite(bearing) || Math.abs(bearing) <= 45);
  const validDistance = finite(distance) && distance >= 0 && distance <= 200;
  const aEligible = fair && validDistance && aThreshold !== null;
  const bEligible = fair && p.hitType !== 'Bunt' && validDistance && finite(ev) && ev > 0 && ev <= 220 && finite(angle) && angle >= -90 && angle <= 90;
  let grade: ContactQuality['grade'] = null;
  if (aEligible && distance >= aThreshold!) grade = 'A';
  else if (bEligible && ev >= QAB_RULES.bExitVelocity) {
    const ground = angle >= QAB_RULES.groundMinAngle && angle <= QAB_RULES.groundMaxAngle && distance <= QAB_RULES.groundMaxDistance;
    const line = angle > QAB_RULES.groundMaxAngle && angle <= QAB_RULES.lineMaxAngle && distance >= QAB_RULES.lineMinDistance;
    if (ground || line) grade = 'B';
  }
  return { grade, aEligible, bEligible, ev: finite(ev) ? ev : null, angle: finite(angle) ? angle : null, distance: validDistance ? distance : null, bearing: finite(bearing) ? bearing : null, stadium, fence, aThreshold };
}

function terminalResult(p: Row): string | null {
  if (hits.has(p.playResult)) return p.playResult;
  if (['Walk', 'Waik'].includes(p.korbb) || (p.balls === 3 && ['ボール', 'ワンバウンド', '敬遠'].includes(p.result))) return '四球';
  if (p.result === '死球') return '死球';
  if (p.korbb === 'Strikeout' || (p.strikes === 2 && ['空振り', '見逃しストライク'].includes(p.result))) return '三振';
  if (validPlays.has(p.playResult)) return p.playResult;
  if (p.result === 'ファウルフライ' && p.outsOnPlay > 0) return 'アウト';
  return null;
}

export type QabAppearance = {
  id: string; gameId: string; batterId: string; team: string; date: string;
  terminal: Row; pitches: Row[]; result: string; pitchCount: number; reasons: QabReason[];
  quality: ContactQuality; isQab: boolean; measurementMissing: boolean; incompletePitchSequence: boolean;
};

/** Build complete PAs before filtering; counts never use a pitch-filtered subset. */
export function buildQabAppearances(source: Row[]): QabAppearance[] {
  const seen = new Set<string>();
  const pitches = source.filter(p => {
    if (!p.gameId || !p.batterId || !finite(p.inning) || !['表', '裏'].includes(p.half)) return false;
    if (!p.id) return true;
    const key = `${p.gameId}|${p.id}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice().sort((a, b) => String(a.gameId).localeCompare(String(b.gameId)) || a.inning - b.inning || (a.half === b.half ? 0 : a.half === '表' ? -1 : 1) || (a.pitchNo ?? 0) - (b.pitchNo ?? 0));
  const result: QabAppearance[] = [];
  let group: Row[] = [];
  let context = '';
  let lastPa: number | null = null;
  for (const p of pitches) {
    const nextContext = `${p.gameId}|${p.inning}|${p.half}|${p.batterTeam}`;
    const pa = finite(p.paOfInning) ? p.paOfInning : null;
    const previous = group.at(-1);
    // An unrecorded ending is not an out or a denominator entry.
    if (nextContext !== context || (pa !== null && lastPa !== null && pa !== lastPa) || (previous && previous.batterId !== p.batterId && !(pa !== null && pa === lastPa))) group = [];
    context = nextContext; lastPa = pa;
    group.push(p);
    const ending = terminalResult(p);
    if (!ending) continue;
    const quality = contactQuality(p);
    const reasons: QabReason[] = [];
    if (hits.has(ending)) reasons.push('安打');
    if (ending === '四球') reasons.push('四球');
    if (ending === '死球') reasons.push('死球');
    if (ending === '進塁打') reasons.push('進塁打');
    if (['犠打', '犠飛', '犠打・犠飛'].includes(ending)) reasons.push('犠打・犠飛');
    // Observed, deduplicated pitches only; do not invent missing pitches.
    if (group.length >= 8) reasons.push('8球以上');
    if (quality.grade) reasons.push(quality.grade === 'A' ? 'A打球' : 'B打球');
    const incompletePitchSequence = !(group[0].balls === 0 && group[0].strikes === 0) || group.some((r, i) => i > 0 && finite(r.pitchNo) && finite(group[i - 1].pitchNo) && r.pitchNo !== group[i - 1].pitchNo + 1);
    result.push({ id: `${context}|${p.id || p.pitchNo}`, gameId: p.gameId, batterId: p.batterId, team: p.batterTeam, date: p.date, terminal: p, pitches: group, result: ending, pitchCount: group.length, reasons, quality, isQab: reasons.length > 0, measurementMissing: p.result === 'インプレー' && p.hitType !== 'Bunt' && (!quality.aEligible || !quality.bEligible), incompletePitchSequence });
    group = [];
  }
  return result.sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.gameId.localeCompare(b.gameId) || (a.terminal.pitchNo ?? 0) - (b.terminal.pitchNo ?? 0));
}

const cached = new WeakMap<Row[], QabAppearance[]>();
export function qabAppearances(pitches: Row[]): QabAppearance[] {
  let rows = cached.get(pitches);
  if (!rows) { rows = buildQabAppearances(pitches); cached.set(pitches, rows); }
  return rows;
}

export function summarizeQab(rows: QabAppearance[]) {
  const qab = rows.filter(r => r.isQab).length;
  const reasonCounts = Object.fromEntries(QAB_REASONS.map(reason => [reason, rows.filter(r => r.reasons.includes(reason)).length])) as Record<QabReason, number>;
  return { pa: rows.length, qab, qabRate: rows.length ? qab / rows.length : null, aContact: reasonCounts['A打球'], bContact: reasonCounts['B打球'], reasonCounts, measurementMissing: rows.filter(r => r.measurementMissing).length, incompletePitchSequence: rows.filter(r => r.incompletePitchSequence).length };
}

export function qabRankingRows(batters: Row[], pitches: Row[]) {
  const groups = new Map<string, QabAppearance[]>();
  for (const row of qabAppearances(pitches)) { const list = groups.get(row.batterId) ?? []; list.push(row); groups.set(row.batterId, list); }
  return batters.map(b => ({ ...b, ...summarizeQab(groups.get(b.id) ?? []) }));
}
