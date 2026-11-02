import repairs from './generated/outcome-repairs.json' with { type: 'json' };
import { portableSha256 } from './sha256-portable.mjs';

// These fields cover identities, PA boundaries and inputs to the repaired metrics.
// Dates are included so this gate also rejects another season with recycled IDs.
export const outcomeFingerprintFields = ['id','gameId','date','pitcherId','batterId','pitcherTeam','batterTeam','inning','half','paOfInning','pitchOfPA','pitchNo','balls','strikes','result','korbb','playResult','outsOnPlay','runsScored','expectedHit','expectedTb','expectedWoba','exitVelocity','launchAngle','hitType'];
export function outcomeFingerprint(pitches) {
  return portableSha256(new TextEncoder().encode(JSON.stringify(pitches.map(p => outcomeFingerprintFields.map(key => p[key])))));
}
// Guard the denominators and official/statistical inputs as well as changed outputs.
const aggregateFields = ['id','pa','ab','hits','walks','hbp','strikeouts','innings','inningsValue','outs','runs','homeRuns','singles','doubles','triples','sacrifices','woba','xwoba','xwobaAllowed','era','battingAverage','onBasePercentage','sluggingPercentage','ops','officialRecord','walksHbp'];
export function outcomeAggregateFingerprint(input) {
  const values = row => aggregateFields.map(key => row?.[key]);
  const rows = collection => (input[collection] ?? []).slice().sort((a,b) => String(a.id).localeCompare(String(b.id))).map(row => collection === 'players' ? [row.id, values(row.batting), values(row.pitching)] : values(row));
  return portableSha256(new TextEncoder().encode(JSON.stringify([values(input.league), rows('batters'), rows('pitchers'), rows('players')])));
}
const valueAt = (root, path) => path.reduce((value, key) => value?.[key], root);
function replaceAt(root, path, value) {
  if (!path.length) return value;
  const [key, ...tail] = path;
  const copy = Array.isArray(root) ? root.slice() : { ...root };
  copy[key] = replaceAt(root[key], tail, value);
  return copy;
}

/** Exact raw-derived repair of a known legacy snapshot, including restored copies.
 * Stored originals, measured pitches, official overrides and enriched fields stay intact.
 * Unknown/edited inputs are never repaired by adding deltas to rounded metrics.
 */
export function repairLegacyOutcomes(input) {
  if (!input || input.metadata?.resultAggregationVersion >= 1 || !Array.isArray(input.pitches)) return input;
  const repair = repairs.find(item => item.season === input.metadata?.season && item.pitchCount === input.pitches.length);
  if (!repair) return input;
  const changes = repair.changes.map(change => {
    if (!change.collection) return { ...change, resolved: change.path };
    const rows = input[change.collection];
    if (!Array.isArray(rows)) return null;
    const index = rows.findIndex(row => row.id === change.id);
    return index < 0 ? null : { ...change, resolved: [change.collection, index, ...change.field] };
  });
  if (changes.some(change => !change || valueAt(input, change.resolved) !== change.before)) return input;
  if (outcomeAggregateFingerprint(input) !== repair.aggregateFingerprint) return input;
  if (outcomeFingerprint(input.pitches) !== repair.fingerprint) return input;
  let output = input;
  for (const change of changes) output = replaceAt(output, change.resolved, change.after);
  return { ...output, metadata: { ...output.metadata, resultAggregationVersion: 1, resultAggregationRepair: `raw-verified-${repair.key}-outcomes-v1` } };
}
