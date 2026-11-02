/** Retired derived performance metrics. Keep original CSVs/snapshots intact; remove these
 * derived fields at read time so old uploads and saved views cannot revive them.
 * Catcher call probabilities, inferred runners and spin estimates are unrelated.
 */
export const RETIRED_PERFORMANCE_KEYS = new Set([
  'pitchingPlus', 'stuffPlus', 'locationPlus',
  'xba', 'xslg', 'xwoba', 'xwobaAllowed', 'xera', 'zoneXslg', 'xslgAb',
  'expectedHit', 'expectedTb', 'expectedWoba', 'expectedBatting', 'actualExpectedGap',
]);

export function withoutEstimatedPerformance<T>(input: T): T {
  const seen = new WeakMap<object, unknown>();
  const visit = (value: unknown): unknown => {
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return seen.get(value);
    if (Array.isArray(value)) {
      const result: unknown[] = [];
      seen.set(value, result);
      let changed = false;
      for (const item of value) { const next = visit(item); result.push(next); changed ||= next !== item; }
      const output = changed ? result : value;
      seen.set(value, output);
      return output;
    }
    const row = value as Record<string, unknown>, result: Record<string, unknown> = {};
    seen.set(value, result);
    let changed = false;
    for (const [key, item] of Object.entries(row)) {
      if (RETIRED_PERFORMANCE_KEYS.has(key)) { changed = true; continue; }
      const next = visit(item); result[key] = next; changed ||= next !== item;
    }
    const output = changed ? result : value;
    seen.set(value, output);
    return output;
  };
  return visit(input) as T;
}

export function activeRankingBoard(board: string) {
  if (board === 'batting_expected') return 'batting_percentile';
  if (board === 'pitching_expected' || board === 'pitching_percentile') return 'pitching_strikeouts';
  return board;
}
