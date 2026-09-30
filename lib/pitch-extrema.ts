import { measuredNumber } from './numeric-summary.ts';

type PitchRow = Record<string, unknown>;
export type PitchExtrema = { maxIvb: number | null; maxHb: number | null; maxVaa: number | null };
const emptyExtrema = (): PitchExtrema => ({ maxIvb: null, maxHb: null, maxVaa: null });

// Movement uses the greatest displacement, retaining its measured direction.
// VAA uses the numerical maximum: -4 degrees is greater (flatter) than -6.
function includePitch(extrema: PitchExtrema, pitch: PitchRow) {
  for (const [field, key] of [['ivb', 'maxIvb'], ['hb', 'maxHb'], ['vaa', 'maxVaa']] as const) {
    const value = measuredNumber(pitch[field]);
    if (value === null) continue;
    const current = extrema[key];
    if (current === null || (key === 'maxVaa'
      ? value > current
      : Math.abs(value) > Math.abs(current) || (Math.abs(value) === Math.abs(current) && value > current))) {
      extrema[key] = value;
    }
  }
}

export function summarizePitchExtrema(pitches: PitchRow[]): PitchExtrema {
  const extrema = emptyExtrema();
  for (const pitch of pitches) includePitch(extrema, pitch);
  return extrema;
}

const cache = new WeakMap<PitchRow[], Map<string, PitchExtrema>>();
const groupKey = (row: PitchRow) => JSON.stringify([row.pitcherId, row.pitchType]);

// Derive from the selected season's pitches, including legacy and new imports.
// Never rewrite stored data or its existing averages/scores.
export function withPitchTypeExtrema<T extends PitchRow>(rows: T[], pitches: PitchRow[]): (T & PitchExtrema)[] {
  let groups = cache.get(pitches);
  if (!groups) {
    groups = new Map();
    for (const pitch of pitches) {
      const key = groupKey(pitch);
      const extrema = groups.get(key) ?? emptyExtrema();
      includePitch(extrema, pitch);
      groups.set(key, extrema);
    }
    cache.set(pitches, groups);
  }
  return rows.map(row => ({ ...row, ...(groups.get(groupKey(row)) ?? emptyExtrema()) }));
}

export function pitchExtremaSortValue(key: string, value: number): number {
  return key === 'maxIvb' || key === 'maxHb' ? Math.abs(value) : value;
}
