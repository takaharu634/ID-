import type { Dataset, Row } from './dataset-types';

type Supplement = { version: number; season: string; columns: string[]; rows: unknown[][] };
const cache = new Map<string, Promise<Supplement | null>>();
const allowed = new Set(['effectiveVelocity', 'popTime', 'exchangeTime', 'timeToBase', 'throwSpeed', 'basePositionX', 'basePositionZ', 'throwCatchConfidence', 'throwReleaseConfidence', 'throwLocationConfidence', 'pitchReleaseConfidence', 'pitchLocationConfidence', 'pitchMovementConfidence', 'hitLaunchConfidence']);

/** Old saved snapshots omitted optional columns. Add only missing fields by exact UID.
 * Newly imported fields (including explicit nulls) always win. Core data is never changed.
 */
export function mergeDevelopmentSupplement(dataset: Dataset, supplemental: Supplement): Dataset {
  if (supplemental.version !== 1 || supplemental.columns[0] !== 'id' || supplemental.columns.slice(1).some(k => !allowed.has(k))) return dataset;
  const lookup = new Map(supplemental.rows.map(values => [values[0], values]));
  return { ...dataset, pitches: dataset.pitches.map(p => {
    const values = lookup.get(p.id); if (!values || values.length !== supplemental.columns.length) return p;
    const extra: Row = {};
    supplemental.columns.slice(1).forEach((key, j) => { if (!Object.hasOwn(p, key)) extra[key] = values[j + 1]; });
    return Object.keys(extra).length ? { ...p, ...extra } : p;
  }) };
}

export async function enrichDevelopmentDataset(dataset: Dataset, season: string): Promise<Dataset> {
  if (!dataset.pitches.some(p => !Object.hasOwn(p, 'effectiveVelocity'))) return dataset;
  if (!/^\d{4}-(spring|fall)$/.test(season)) return dataset;
  let pending = cache.get(season);
  if (!pending) {
    pending = fetch(`/data/development-${season}.json`, { cache: 'no-cache', signal: AbortSignal.timeout(10000) })
      .then(async r => r.ok ? await r.json() as Supplement : null).catch(() => null);
    cache.set(season, pending);
  }
  const supplement = await pending;
  if (!supplement) { cache.delete(season); return dataset; }
  if (supplement.season !== season || !Array.isArray(supplement.rows) || !Array.isArray(supplement.columns)) return dataset;
  return mergeDevelopmentSupplement(dataset, supplement);
}
