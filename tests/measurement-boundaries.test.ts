import assert from 'node:assert/strict';
import test from 'node:test';
import { annotatePlateAppearances, calculateApproachMetrics, hasLocation, summarizePitchGroup } from '../lib/scouting-analytics.ts';
import { buildBatterProfile, filterBatterProfilePitches, movementDirection, movementMagnitude, sprayDirection } from '../lib/batter-profile.ts';
import { repairLegacyAggregates } from '../lib/repair-legacy-aggregates.ts';

const base = { gameId: 'g1', inning: 1, half: '表', batterId: 'b1', pitcherId: 'p1', batterSide: '右', pitcherThrows: '右', year: 2026, season: '春', pitchType: 'ストレート', result: 'ファウル', balls: 0, strikes: 0 };
test('unmeasured values do not lower means and genuine zero remains measured', () => {
  const summary = summarizePitchGroup([{ velocity: 140, ivb: null, hb: 0 }, { velocity: null, ivb: '', hb: null }, { velocity: ' ', ivb: false, hb: '' }]);
  assert.equal(summary.avgVelocity, 140); assert.equal(summary.avgIvb, null); assert.equal(summary.avgHb, 0);
  for (const value of [null, undefined, '', ' ', false]) assert.equal(hasLocation({ plateX: value, plateZ: .7 }), false);
  assert.equal(hasLocation({ plateX: 0, plateZ: .7 }), true);
});

test('missing counts cannot create a first pitch, first strike or before-two-strike sample', () => {
  for (const value of [null, undefined, '', ' ', false]) {
    const annotated = annotatePlateAppearances([{ ...base, balls: value, strikes: value, plateX: .5, plateZ: .7 }]);
    const metrics = calculateApproachMetrics(annotated);
    assert.equal(annotated[0]._paKey, null); assert.equal(metrics.firstPitchSwing.denominator, 0); assert.equal(metrics.firstStrikeSwing.denominator, 0); assert.equal(metrics.preTwoStrikeChase.denominator, 0);
  }
  const valid = annotatePlateAppearances([{ ...base, plateX: .5, plateZ: .7 }]);
  assert.equal(calculateApproachMetrics(valid).firstPitchSwing.denominator, 1);
  assert.equal(calculateApproachMetrics(valid).preTwoStrikeChase.denominator, 1);
});

test('missing movement, direction and velocity are omitted from measured filter bands', () => {
  const unknown = { ...base, hb: null, ivb: null, direction: null, sprayAngle: null, velocity: null };
  assert.equal(movementDirection(unknown), null); assert.equal(movementMagnitude(unknown), null); assert.equal(sprayDirection(unknown, '右'), null);
  for (const filter of [{ velocityMax: 135 }, { movementMin: 0 }, { movementBand: '10cm未満' }, { movementDirection: 'ほぼ真っすぐ' }, { verticalClass: '下位25%' }]) assert.deepEqual(filterBatterProfilePitches([unknown], filter), []);
  const measured = { ...base, hb: 0, ivb: 0, direction: 0, velocity: 0 };
  assert.equal(movementDirection(measured), 'ほぼ真っすぐ'); assert.equal(movementMagnitude(measured), '10cm未満'); assert.equal(sprayDirection(measured, '右'), 'センター');
  assert.equal(filterBatterProfilePitches([measured], { velocityMax: 135 }).length, 1);
  const population = [10, 20, 30, 40].map(ivb => ({ ...base, ivb }));
  assert.equal(filterBatterProfilePitches([...population, unknown], { verticalClass: '下位25%' }).length, 1);
  const profile = buildBatterProfile([unknown], [unknown]);
  assert.equal(profile.velocityBands.reduce((total, band) => total + band.pitches, 0), 0);
});

test('unmeasured batted-ball angle/direction does not become a grounder or center point', () => {
  const unknown = { ...base, result: 'インプレー', exitVelocity: 140, hitType: 'Undefined', launchAngle: null, distance: 100, direction: null, sprayAngle: null };
  const profile = buildBatterProfile([unknown], [unknown]);
  assert.equal(profile.spray[0].groundRate, 0); assert.equal(profile.spray[0].centerRate, null); assert.deepEqual(profile.spray[0].points, []);
  const centered = { ...unknown, launchAngle: 0, direction: 0 };
  const valid = buildBatterProfile([centered], [centered]);
  assert.equal(valid.spray[0].groundRate, 1); assert.equal(valid.spray[0].centerRate, 1); assert.equal(valid.spray[0].points[0].direction, 0);
});

function legacyDataset() {
  const batter = { id: 'b1', pa: 100, percentiles: { chaseRate: 11, whiffRate: 60 }, zoneContactRate: -1, chaseRate: .75, battingAverage: .321, ops: 1.02, official: { pa: 100 }, pitchingPlus: 105 };
  const pitcher = { id: 'p1', chaseRate: .75, avgExtension: 0, pitchingPlus: 99 };
  const type = { pitcherId: 'p1', pitchType: 'ストレート', avgExtension: 0, avgReleaseHeight: 0, avgReleaseSide: 0, stuffPlus: 107 };
  return { schemaVersion: 7, metadata: { season: '2026年春季', officialBatting: { matched: 6 } }, league: { zone: { left: -.254, right: .254, bottom: .45, top: 1.05 } }, batters: [batter], pitchers: [pitcher], pitchTypes: [type], players: [{ id: 'b1', batting: { ...batter } }, { id: 'p1', pitching: { ...pitcher } }], highlights: { battingProduction: { ...batter }, pitchingPlus: { ...pitcher }, stuffPitch: { ...type } }, pitches: [
    { ...base, plateX: 0, plateZ: .7, extension: null, releaseHeight: null, releaseSide: 0 },
    { ...base, plateX: .5, plateZ: .7, result: '空振り', extension: null, releaseHeight: null, releaseSide: null },
    { ...base, plateX: .5, plateZ: .7, result: '空振り', extension: null, releaseHeight: null, releaseSide: null },
    { ...base, plateX: .5, plateZ: .7, result: 'ボール', extension: null, releaseHeight: null, releaseSide: null },
    { ...base, plateX: null, plateZ: null, result: '空振り', extension: null, releaseHeight: null, releaseSide: null },
  ] };
}

test('legacy repair fixes only substantiated aggregate fields and is immutable and idempotent', () => {
  const source = legacyDataset(), original = structuredClone(source), repaired = repairLegacyAggregates(source);
  assert.deepEqual(source, original);
  assert.equal(repaired.batters[0].zoneContactRate, 1); assert.equal(repaired.batters[0].chaseRate, .667); assert.equal(repaired.pitchers[0].chaseRate, .667);
  assert.equal(repaired.pitchers[0].avgExtension, null); assert.equal(repaired.pitchTypes[0].avgReleaseHeight, null); assert.equal(repaired.pitchTypes[0].avgReleaseSide, 0);
  assert.equal(repaired.batters[0].percentiles.chaseRate, 50); assert.equal(repaired.batters[0].percentiles.whiffRate, 60);
  assert.equal(repaired.batters[0].battingAverage, .321); assert.equal(repaired.batters[0].ops, 1.02); assert.equal(repaired.pitchers[0].pitchingPlus, 99);
  assert.deepEqual(repaired.batters[0].official, original.batters[0].official);
  assert.equal(repaired.players[0].batting?.zoneContactRate, 1); assert.equal(repaired.highlights.battingProduction.zoneContactRate, 1);
  assert.strictEqual(repaired.pitches, source.pitches); assert.strictEqual(repaired.league, source.league);
  assert.strictEqual(repairLegacyAggregates(repaired), repaired);
});

test('fresh raw-precision summaries and incomplete/non-summary payloads are never rewritten', () => {
  const fresh = { ...legacyDataset(), metadata: { measurementAggregationVersion: 1 } };
  assert.strictEqual(repairLegacyAggregates(fresh), fresh);
  const incomplete = { ...legacyDataset(), pitches: [] }; assert.strictEqual(repairLegacyAggregates(incomplete), incomplete);
  const partial = { ...legacyDataset(), metadata: { pitches: 100 } }; assert.strictEqual(repairLegacyAggregates(partial), partial);
  const spin = [{ velocity: 140, pitchId: 'p' }]; assert.strictEqual(repairLegacyAggregates(spin), spin);
});

// The bundled seasons include official batting overrides and post-September-23
// development fields. Only these exact paths are allowed to change on reading.
function omitRepairFields(value: unknown, path = ''): unknown {
  if (Array.isArray(value)) return value.map((item, index) => omitRepairFields(item, `${path}[${index}]`));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([field]) => {
    if (path === 'metadata' && ['measurementAggregationVersion', 'measurementAggregationRepair'].includes(field)) return false;
    const batting = /^(?:batters\[\d+\]|players\[\d+\]\.batting|highlights\.(?:battingProduction|exitVelocity|expectedBatting))$/;
    if (batting.test(path) && ['zoneContactRate', 'chaseRate'].includes(field)) return false;
    if (path.endsWith('.percentiles') && batting.test(path.slice(0, -12)) && field === 'chaseRate') return false;
    if (/^(?:pitchers\[\d+\]|players\[\d+\]\.pitching|highlights\.(?:pitchingPlus|command))$/.test(path) && ['chaseRate', 'avgExtension'].includes(field)) return false;
    if (/^(?:pitchTypes\[\d+\]|highlights\.stuffPitch)$/.test(path) && ['avgExtension', 'avgReleaseHeight', 'avgReleaseSide'].includes(field)) return false;
    return true;
  }).map(([field, item]) => [field, omitRepairFields(item, path ? `${path}.${field}` : field)]));
}

for (const season of ['2025-fall', '2026-spring', '2026-fall']) {
  test(`${season}: legacy repair preserves every unrelated field and removes impossible rates`, async () => {
    const { readFile } = await import('node:fs/promises');
    const source = JSON.parse(await readFile(new URL(`../public/data/season-${season}.json`, import.meta.url), 'utf8'));
    const before = JSON.stringify(source), repaired = repairLegacyAggregates(source);
    assert.equal(JSON.stringify(source), before);
    assert.deepEqual(omitRepairFields(repaired), omitRepairFields(source));
    for (const batter of repaired.batters) for (const field of ['zoneContactRate', 'chaseRate']) assert.ok(batter[field] === null || batter[field] >= 0 && batter[field] <= 1);
    assert.strictEqual(repairLegacyAggregates(repaired), repaired);
  });
}
