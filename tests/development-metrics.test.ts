import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleSd, circularSd, buildVaaModels, pitchDevelopment, pitcherDevelopmentReport, batterDevelopment, damageSummary, catcherDevelopment, developmentZone } from '../lib/development-metrics.ts';
import { developmentMeasurements } from '../lib/development-measurements.mjs';
import { buildDatasetFromCsv } from '../lib/csv-analytics.js';
import { mergeDevelopmentSupplement } from '../lib/development-enrichment.ts';
import type { Row } from '../lib/dataset-types.ts';
const near = (a: number, b: number, tolerance = 1e-6) => assert.ok(Math.abs(a - b) < tolerance, `${a} vs ${b}`);

test('missing values stay missing; sample and circular SD are different calculations', () => {
  near(sampleSd([{ x: 1 }, { x: 3 }, { x: null }, { x: '' }], 'x')!, Math.sqrt(2));
  assert.equal(sampleSd([{ x: 3 }, { x: null }], 'x'), null);
  near(circularSd([{ spinAxis: 359 }, { spinAxis: 1 }])!, 1, .001);
  assert.equal(circularSd([{ spinAxis: 0 }, { spinAxis: 180 }]), null);
});
test('VAA height correction refits per season and needs sufficient pitchers', () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({ pitcherId: `p${i % 3}`, pitchType: 'ストレート', year: 2026, season: '春', plateX: 0, plateZ: .4 + (i % 12) * .05, vaa: -8 + 4 * (.4 + (i % 12) * .05) }));
  const models = buildVaaModels(rows);
  const result = pitchDevelopment([{ ...rows[0], vaa: rows[0].vaa + .7 }], models);
  near(result.vaaDelta, .7);
  assert.equal(pitchDevelopment([{ ...rows[0], season: '秋' }], models).vaaDelta, null);
  assert.equal(pitchDevelopment([{ ...rows[0], plateZ: 2 }], models).vaaDelta, null);
  assert.equal(buildVaaModels(rows.map(p => ({ ...p, pitcherId: 'same' }))).size, 0);
});
const appearance = (gameId: string, date: string, velocity: number, releaseHeight: number): Row[] => Array.from({ length: 90 }, (_, i) => ({ id: `${gameId}-${i}`, pitcherId: 'p', gameId, date, year: 2026, season: '春', time: '12:00:00', pitchNo: 100 + i * 2, pitchType: i % 2 ? 'スライダー' : 'ストレート', velocity: i < 15 ? velocity : velocity - 3, releaseHeight, releaseSide: 40, extension: 180 }));
test('workload keeps whole-appearance numbering after pitch-type filters', () => {
  const rows = appearance('a', '2026-04-01', 150, 170);
  const report = pitcherDevelopmentReport(rows.filter(p => p.pitchType === 'ストレート'), rows, []);
  assert.equal(report.workload[0].pitches, 8);
  assert.equal(report.workload.at(-1)?.pitches, 15);
  near(report.maintenance[0].velocityRetention, .98);
});
test('release baseline excludes current/future appearances but includes previous unselected games', () => {
  const first = appearance('a', '2026-04-01', 150, 170), second = appearance('b', '2026-04-08', 149, 173), future = appearance('c', '2026-04-15', 155, 190);
  const report = pitcherDevelopmentReport(second, [...future, ...first, ...second], []);
  near(report.releases[0].heightDelta, 3);
  assert.equal(report.releases[0].baselinePitches, 45);
  assert.equal(pitcherDevelopmentReport(first, first, []).releases[0].heightDelta, null);
});
test('PutAway denominator and numerator both require two strikes; EffectiveVelo uses raw measurement', () => {
  const r = pitchDevelopment([{ strikes: 2, korbb: 'Strikeout', velocity: 145, effectiveVelocity: 143 }, { strikes: 2 }, { strikes: 1, korbb: 'Strikeout' }], new Map());
  near(r.putAwayRate, .5); near(r.effectiveDelta, -2);
});
test('Good Decision excludes Edge/HBP/intentional/unknown instead of judging all takes as bad', () => {
  const rows = [{ plateX: 0, plateZ: .75, result: 'インプレー' }, { plateX: .5, plateZ: .75, result: 'ボール' }, { plateX: 0, plateZ: .75, result: '見逃しストライク' }, { plateX: .24, plateZ: .75, result: '見逃しストライク' }, { plateX: 0, plateZ: .75, result: '死球' }, { plateX: .5, plateZ: .75, result: '敬遠' }];
  assert.equal(developmentZone(rows[3]), 'edge');
  const r = batterDevelopment(rows).summary;
  assert.equal(r.decisionSamples, 3); near(r.goodDecisionRate!, 2 / 3);
});
test('Damage excludes foul and bunt EV and uses separate measurement denominators', () => {
  const rows = [{ result: 'インプレー', exitVelocity: 160, launchAngle: 28, expectedTb: 2, playResult: '二塁打' }, { result: 'ファウル', exitVelocity: 200, launchAngle: 30 }, { result: 'インプレー', exitVelocity: 140, launchAngle: null, expectedTb: null }, { result: '空振り', korbb: 'Strikeout' }, { result: 'インプレー', hitType: 'Bunt', exitVelocity: 30, launchAngle: 0 }];
  const r = damageSummary(rows);
  near(r.avgEv, 150); assert.equal(r.bbe, 2); assert.equal(r.angleBbe, 1);
  near(r.hardHitRate, .5); near(r.barrelRate, 1); near(r.xslg, 1); assert.equal(r.xslgAb, 2);
});
test('Pull Air mirrors handedness and keeps ground balls in denominator', () => {
  const rows = [{ result: 'インプレー', batterSide: '右', sprayAngle: -25, launchAngle: 30, hitType: 'FlyBall' }, { result: 'インプレー', batterSide: '左', sprayAngle: 25, launchAngle: 20, hitType: 'LineDrive' }, { result: 'インプレー', batterSide: '右', sprayAngle: -25, launchAngle: 0, hitType: 'GroundBall' }, { result: 'インプレー', batterSide: '右', sprayAngle: null, launchAngle: 30, hitType: 'FlyBall' }];
  near(batterDevelopment(rows).summary.pullAirRate!, 2 / 3);
});
test('catcher decomposition uses same throws and rejects wrong base, low confidence and bad sums', () => {
  const valid = { basePositionX: 38.79, basePositionZ: 0, popTime: 2, exchangeTime: .7, timeToBase: 1.3, throwSpeed: 130 };
  const r = catcherDevelopment([valid, { ...valid, basePositionX: 22 }, { ...valid, basePositionZ: 17 }, { ...valid, throwLocationConfidence: 'Low' }, { ...valid, exchangeTime: .8 }, { ...valid, popTime: 1.8, exchangeTime: .6, timeToBase: 1.2, throwSpeed: null }]);
  assert.equal(r.exchangeSamples, 2); near(r.pairedPopTime, r.avgExchange + r.avgFlight); near(r.fastestExchange, .6); assert.equal(r.throwSamples, 2);
});
test('CSV ingestion preserves optional measurements without converting empty cells to zero', () => {
  const raw = { EffectiveVelo: '142.25', ExchangeTime: '.65', TimeToBase: '1.3', PopTime: '1.95', ThrowSpeed: '130.5', BasePositionX: '38.79', BasePositionZ: '0', PitchReleaseConfidence: 'Medium' };
  assert.equal(developmentMeasurements({}).effectiveVelocity, null);
  const header = ['Pitcher', 'Batter', 'PitchCall', 'RelSpeed', 'Date', 'GameUID', 'PitchUID', ...Object.keys(raw)];
  const csv = `${header.join(',')}\np,b,BallCalled,145,2026-04-01,g,uid,${Object.values(raw).join(',')}`;
  const data = buildDatasetFromCsv(csv);
  assert.equal(data.pitches[0].effectiveVelocity, 142.25);
  assert.equal(data.pitches[0].exchangeTime, .65);
  assert.equal(data.pitches[0].basePositionZ, 0);
});

test('measurement-specific Low confidence does not contaminate other pitch fields', () => {
  const r = pitchDevelopment([{ velocity: 140, spinAxis: 0, vaa: -4, ivb: 50, pitchMovementConfidence: 'Low', pitchLocationConfidence: 'Low' }, { velocity: 142, spinAxis: 90, vaa: -5, ivb: 40 }], new Map());
  assert.equal(r.axisSd, null); assert.equal(r.vaaSd, null); assert.equal(r.ivbSd, null);
  near(r.velocitySd, Math.sqrt(2));
});
test('large VAA cohorts do not use unbounded function arguments', () => {
  const rows = Array.from({ length: 150000 }, (_, i) => ({ pitcherId: `p${i % 3}`, pitchType: 'ストレート', year: 2028, season: '春', plateX: 0, plateZ: .4 + (i % 12) * .05, vaa: -8 + 4 * (.4 + (i % 12) * .05) }));
  assert.equal(buildVaaModels(rows).get('2028|春')?.n, 150000);
});
test('legacy supplement only fills absent fields on exact UIDs', () => {
  const dataset = { pitches: [{ id: 'a', velocity: 150, exchangeTime: null }, { id: 'b', velocity: 140 }, { id: 'c', velocity: 130 }] } as any;
  const enriched = mergeDevelopmentSupplement(dataset, { version: 1, season: '2026-spring', columns: ['id', 'exchangeTime', 'effectiveVelocity'], rows: [['a', .7, 148], ['b', .8, 138]] });
  assert.equal(enriched.pitches[0].exchangeTime, null);
  assert.equal(enriched.pitches[1].exchangeTime, .8);
  assert.equal(enriched.pitches[0].velocity, 150);
  assert.equal(enriched.pitches[2], dataset.pitches[2]);
  assert.equal(Object.hasOwn(dataset.pitches[1], 'exchangeTime'), false);
});
