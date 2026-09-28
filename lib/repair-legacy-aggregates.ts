import { measuredNumber } from './numeric-summary.ts';

// Only the documented pre-v1 aggregation defects are repaired. Official records,
// pitch-quality scores, measurement rows and immutable stored snapshots stay intact.
type Row = Record<string, unknown>;
type Counts = { outside: number; chases: number; zoneSwings: number; zoneContacts: number; extension: boolean; releaseHeight: boolean; releaseSide: boolean };
const empty = (): Counts => ({ outside: 0, chases: 0, zoneSwings: 0, zoneContacts: 0, extension: false, releaseHeight: false, releaseSide: false });
const row = (value: unknown): value is Row => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const ratio = (numerator: number, denominator: number) => denominator ? Math.round(numerator / denominator * 1000) / 1000 : null;
const key = (pitcherId: unknown, pitchType: unknown) => JSON.stringify([pitcherId, pitchType]);
function get(map: Map<unknown, Counts>, id: unknown) {
  let counts = map.get(id);
  if (!counts) { counts = empty(); map.set(id, counts); }
  return counts;
}
function patched(original: unknown, values: Row) {
  if (!row(original)) return original;
  const changes = Object.fromEntries(Object.entries(values).filter(([field, value]) => Object.hasOwn(original, field) && original[field] !== value));
  return Object.keys(changes).length ? { ...original, ...changes } : original;
}
function missingMeasurements(original: unknown, counts?: Counts) {
  if (!row(original) || !counts) return original;
  const fields: Row = {};
  for (const [field, measured] of [['avgExtension', counts.extension], ['avgReleaseHeight', counts.releaseHeight], ['avgReleaseSide', counts.releaseSide]] as const) {
    if (!measured && original[field] === 0) fields[field] = null;
  }
  return patched(original, fields);
}

/** Read-time repair for bundled and uploaded pre-v1 summaries, without raw reimport. */
export function repairLegacyAggregates<T>(input: T): T {
  if (!row(input) || !row(input.metadata) || Number(input.metadata.measurementAggregationVersion) >= 1
    || !Array.isArray(input.pitches) || !Array.isArray(input.batters) || !Array.isArray(input.pitchers)) return input;
  // An empty/incomplete container cannot substantiate a repair of its aggregates.
  if (!input.pitches.length || !input.pitches.every(row)) return input;
  const expectedPitches = measuredNumber(input.metadata.pitches);
  if (expectedPitches !== null && expectedPitches !== input.pitches.length) return input;
  const zone = row(input.league) && row(input.league.zone) ? input.league.zone : {};
  const left = measuredNumber(zone.left) ?? -.254, right = measuredNumber(zone.right) ?? .254;
  const bottom = measuredNumber(zone.bottom) ?? .45, top = measuredNumber(zone.top) ?? 1.05;
  const batting = new Map<unknown, Counts>(), pitching = new Map<unknown, Counts>(), types = new Map<unknown, Counts>();
  for (const pitch of input.pitches as Row[]) {
    const batter = get(batting, pitch.batterId), pitcher = get(pitching, pitch.pitcherId), type = get(types, key(pitch.pitcherId, pitch.pitchType));
    const x = measuredNumber(pitch.plateX), z = measuredNumber(pitch.plateZ);
    const swing = ['空振り', 'ファウル', 'ファウルフライ', 'インプレー'].includes(String(pitch.result ?? ''));
    if (x !== null && z !== null) {
      if (x >= left && x <= right && z >= bottom && z <= top) {
        if (swing) { batter.zoneSwings++; if (pitch.result !== '空振り') batter.zoneContacts++; }
      } else {
        batter.outside++; pitcher.outside++;
        if (swing) { batter.chases++; pitcher.chases++; }
      }
    }
    for (const aggregate of [pitcher, type]) {
      aggregate.extension ||= measuredNumber(pitch.extension) !== null;
      aggregate.releaseHeight ||= measuredNumber(pitch.releaseHeight) !== null;
      aggregate.releaseSide ||= measuredNumber(pitch.releaseSide) !== null;
    }
  }
  // Preserve the existing PA >= 20 population and tie/rounding convention.
  const chasePool = input.batters.filter(value => row(value) && (measuredNumber(value.pa) ?? 0) >= 20)
    .map(value => {
      const counts = batting.get((value as Row).id);
      return counts ? ratio(counts.chases, counts.outside) : measuredNumber((value as Row).chaseRate);
    })
    .filter((value): value is number => value !== null).sort((a, b) => a - b);
  const chasePercentile = (value: number | null) => {
    if (value === null || !chasePool.length) return null;
    let lower = 0, upper = chasePool.length;
    while (lower < upper) {
      const middle = (lower + upper) >>> 1;
      if (chasePool[middle] <= value) lower = middle + 1; else upper = middle;
    }
    return Math.max(1, Math.min(99, 100 - Math.round(100 * (lower - .5) / chasePool.length)));
  };
  const fixBatting = (value: unknown) => {
    const counts = row(value) ? batting.get(value.id) : undefined;
    if (!counts || !row(value)) return value;
    const chaseRate = ratio(counts.chases, counts.outside);
    const result = patched(value, { zoneContactRate: ratio(counts.zoneContacts, counts.zoneSwings), chaseRate });
    return (measuredNumber(value.pa) ?? 0) >= 20 && row(value.percentiles)
      ? patched(result, { percentiles: patched(value.percentiles, { chaseRate: chasePercentile(chaseRate) }) }) : result;
  };
  const fixPitching = (value: unknown) => {
    const counts = row(value) ? pitching.get(value.id) : undefined;
    return counts ? missingMeasurements(patched(value, { chaseRate: ratio(counts.chases, counts.outside) }), counts) : value;
  };
  const fixType = (value: unknown) => row(value) ? missingMeasurements(value, types.get(key(value.pitcherId, value.pitchType))) : value;
  const output: Row = {
    ...input,
    metadata: {
      ...input.metadata,
      measurementAggregationVersion: 1,
      // Legacy pitch coordinates retain three decimals. Boundary decisions use
      // these published coordinates; this is not a raw-CSV-precision rebuild.
      measurementAggregationRepair: 'published-pitches-v1',
    },
    batters: input.batters.map(fixBatting),
    pitchers: input.pitchers.map(fixPitching),
  };
  if (Array.isArray(input.pitchTypes)) output.pitchTypes = input.pitchTypes.map(fixType);
  if (Array.isArray(input.players)) output.players = input.players.map(player => {
    if (!row(player)) return player;
    return patched(player, { batting: fixBatting(player.batting), pitching: fixPitching(player.pitching) });
  });
  if (row(input.highlights)) {
    output.highlights = patched(input.highlights, {
      battingProduction: fixBatting(input.highlights.battingProduction),
      exitVelocity: fixBatting(input.highlights.exitVelocity),
      expectedBatting: fixBatting(input.highlights.expectedBatting),
      pitchingPlus: fixPitching(input.highlights.pitchingPlus),
      command: fixPitching(input.highlights.command),
      stuffPitch: fixType(input.highlights.stuffPitch),
    });
  }
  return output as T;
}
