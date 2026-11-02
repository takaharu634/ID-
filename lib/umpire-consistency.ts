import type { Dataset, Row } from './dataset-types';
import { buildUmpireAnalysis, type Take } from './umpire-analytics.ts';

const state = (p: Take) => `${p.strikes === 2 ? 2 : 0}:${p.balls === 3 ? 3 : 0}`;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const valid = (p: Take) => ['右', '左'].includes(p.batterSide) && Number.isInteger(p.balls) && p.balls >= 0 && p.balls <= 3 && Number.isInteger(p.strikes) && p.strikes >= 0 && p.strikes <= 2 && String(p.pitchLocationConfidence).toLowerCase() !== 'low';

// Compare the umpire with their OWN calls, in catcher coordinates. This does
// not score agreement with a league or geometric strike zone.
export function ownCallConsistency(rows: Take[]) {
  const eligible = rows.filter(valid), anchors = new Set<Take>();
  let weight = 0, agreement = 0, pairs = 0;
  for (let i = 0; i < eligible.length; i++) for (let j = i + 1; j < eligible.length; j++) {
    const a = eligible[i], b = eligible[j];
    if (a.gameId === b.gameId || a.batterSide !== b.batterSide || state(a) !== state(b)) continue;
    const d2 = (a.plateX - b.plateX) ** 2 + (a.plateZ - b.plateZ) ** 2;
    if (d2 > .05 ** 2) continue;
    const w = Math.exp(-d2 / (2 * .03 ** 2));
    weight += w; agreement += w * Number(a.actual === b.actual); pairs++;
    anchors.add(a); anchors.add(b);
  }
  const supported = anchors.size >= 30 && pairs >= 20 && weight >= 10;
  return { consistencySamples: anchors.size, consistencyPairs: pairs, consistencyRate: supported ? agreement / weight : null, disagreementRate: supported ? 1 - agreement / weight : null };
}

// Symmetric matched-position difference: both groups get exactly the same
// pair weights. Raw called-strike percentages would confound pitch locations.
export function matchedCallGap(a: Take[], b: Take[], sameSide: boolean) {
  let weight = 0, difference = 0, squares = 0;
  const left = new Set<Take>(), right = new Set<Take>();
  for (const p of a.filter(valid)) for (const q of b.filter(valid)) {
    if (sameSide ? p.batterSide !== q.batterSide : state(p) !== state(q)) continue;
    const d2 = (p.plateX - q.plateX) ** 2 + (p.plateZ - q.plateZ) ** 2;
    if (d2 > .05 ** 2) continue;
    const w = Math.exp(-d2 / (2 * .03 ** 2));
    weight += w; squares += w * w; difference += w * (p.actual - q.actual);
    left.add(p); right.add(q);
  }
  const samples = Math.min(left.size, right.size), effective = squares ? weight * weight / squares : 0;
  return { samples, gap: samples >= 15 && effective >= 20 ? difference / weight : null };
}

const cache = new WeakMap<Dataset, Row[]>();
export function umpireRankingRows(data: Dataset): Row[] {
  const old = cache.get(data); if (old) return old;
  const analysis = buildUmpireAnalysis(data);
  const result = [...new Set(analysis.assignments.values())].map(name => {
    const rows = analysis.takes.filter(p => p.umpire === name && valid(p));
    const normal = rows.filter(p => p.strikes !== 2 && p.balls !== 3);
    const two = matchedCallGap(rows.filter(p => p.strikes === 2 && p.balls !== 3), normal, true);
    const three = matchedCallGap(rows.filter(p => p.balls === 3 && p.strikes !== 2), normal, true);
    const full = matchedCallGap(rows.filter(p => p.balls === 3 && p.strikes === 2), normal, true);
    const side = matchedCallGap(rows.filter(p => p.batterSide === '右'), rows.filter(p => p.batterSide === '左'), false);
    const gaps = [two.gap, three.gap, full.gap].filter(finite);
    return { id: name, name, team: '', ...ownCallConsistency(rows),
      twoStrikeGap: two.gap === null ? null : two.gap * 100,
      threeBallGap: three.gap === null ? null : three.gap * 100,
      fullCountGap: full.gap === null ? null : full.gap * 100,
      countChange: gaps.length ? Math.max(...gaps.map(Math.abs)) * 100 : null,
      countSamples: Math.max(two.gap === null ? 0 : two.samples, three.gap === null ? 0 : three.samples, full.gap === null ? 0 : full.samples),
      rightLeftGap: side.gap === null ? null : side.gap * 100,
      sideDifference: side.gap === null ? null : Math.abs(side.gap) * 100,
      sideSamples: side.gap === null ? 0 : side.samples };
  });
  cache.set(data, result); return result;
}
