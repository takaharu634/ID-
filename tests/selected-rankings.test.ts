import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fastballResponseRows, selectedRankingRows, selectedBoardConfig, SELECTED_RANKINGS, velocityBaseline } from '../lib/selected-rankings.ts';
import { ownCallConsistency, matchedCallGap } from '../lib/umpire-consistency.ts';
import { getMetricInfo } from '../lib/metric-definitions.ts';
import type { Dataset, Row } from '../lib/dataset-types.ts';
import type { Take } from '../lib/umpire-analytics.ts';
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const pitch = (n: number, overrides: Row = {}): Row => ({ id: `p${n}`, pitchNo: n, pitcherId: 'p', batterId: 'b', gameId: 'g', inning: 1, half: '表', batterTeam: 'A', pitcherTeam: 'B', date: '2026-09-01', year: 2026, season: '秋', pitchType: 'ストレート', velocity: 150, ivb: 40, hb: 20, releaseHeight: 170, extension: 190, plateX: 0, plateZ: .9, batterSide: '右', pitcherThrows: '右', balls: 0, strikes: 0, result: 'ボール', ...overrides });
function dataset(pitches: Row[]): Dataset {
  return { metadata: {}, league: {}, teams: [], games: [], players: [], pitchers: [{ id: 'p', pa: 10, strikeouts: 4, walks: 1, hbp: 2, pitches: pitches.length }], batters: [{ id: 'b', pa: 10, ab: 6, hits: 2, doubles: 1, triples: 0, homeRuns: 0, sluggingPercentage: .5, onBasePercentage: .4 }], catchers: [], pitchTypes: [], pitches, highlights: {} };
}
test('K−BB% retains its walk-only definition when displayed walks combine HBP', () => {
  const r = selectedRankingRows(dataset([])).pitching[0];
  near(r.kMinusBbRate, .3); near(r.walkHbpRate, .3);
});
test('quick two strikes counts actual strikes, excludes early contact and incomplete PAs', () => {
  const rows = [pitch(1, { paOfInning: 1, result: '見逃しストライク' }), pitch(2, { paOfInning: 1, strikes: 1, result: 'ファウル' }), pitch(3, { paOfInning: 1, strikes: 2, result: '空振り', korbb: 'Strikeout' }),
    pitch(4, { paOfInning: 2, result: '見逃しストライク' }), pitch(5, { paOfInning: 2, strikes: 1, result: 'インプレー', playResult: 'アウト' }),
    pitch(6, { paOfInning: 3, strikes: 2, result: '空振り', korbb: 'Strikeout' })];
  const r = selectedRankingRows(dataset(rows)).pitching[0];
  assert.equal(r.completePa, 2); near(r.quickTwoStrikeRate, .5);
  assert.equal(r.firstPitches, 2); near(r.selectedFirstStrikeRate, 1);
});
test('missing locations do not enter zone/chase denominators', () => {
  const r = selectedRankingRows(dataset([pitch(1, { result: '空振り', plateX: null }), pitch(2, { result: '空振り' }), pitch(3, { plateX: .5 })])).pitching[0];
  assert.equal(r.zoneSwings, 1); assert.equal(r.outsidePitches, 1); near(r.zoneWhiffRate, 1); near(r.selectedChaseRate, 0);
});
test('BABIP includes sacrifice flies and bunt singles, excludes sacrifice bunts and HR', () => {
  const rows = [pitch(1, { paOfInning: 1, result: 'インプレー', playResult: '単打', hitType: 'Bunt' }), pitch(2, { paOfInning: 2, result: 'インプレー', playResult: '犠打・犠飛', hitType: 'FlyBall' }), pitch(3, { paOfInning: 3, result: 'インプレー', playResult: '犠打・犠飛', hitType: 'Bunt' }), pitch(4, { paOfInning: 4, result: 'インプレー', playResult: '本塁打' })];
  const d = dataset(rows); d.batters[0].trackmanRecord = { pa: 5, ab: 3, hits: 2, doubles: 1, homeRuns: 0 };
  const r = selectedRankingRows(d).batting[0];
  assert.equal(r.babipSamples, 2); near(r.babip, .5); near(r.iso, 1 / 3); assert.equal(r.pa, 5);
});
test('velocity baseline uses all straight fastballs but appearance count includes other pitches', () => {
  const rows = Array.from({ length: 90 }, (_, i) => pitch(i + 1, { pitchType: i % 2 ? 'スライダー' : 'ストレート', velocity: i < 30 ? 150 : 147 }));
  const r = velocityBaseline(rows); near(r.fastballAverage, 148); near(r.lateFastballAverage, 147); near(r.velocityRetention, 147 / 148); near(r.velocityDelta, -1); assert.equal(r.lateFastballSamples, 15);
  assert.equal(velocityBaseline(rows.slice(0, 30)).velocityRetention, null);
});
test('fastball extension averages measured straight fastballs in metres independently of velocity', () => {
  const d = dataset([
    pitch(1, { extension: 180 }), pitch(2, { extension: 210, velocity: null }),
    pitch(3, { extension: 400, pitchType: 'カットボール' }), pitch(4, { extension: 300, pitchType: 'スライダー' }),
    pitch(5, { extension: null }), pitch(6, { extension: undefined }), pitch(7, { extension: NaN }),
    pitch(8, { extension: Infinity }), pitch(9, { extension: -10 }), pitch(10, { extension: 400, pitchReleaseConfidence: 'LOW' }),
  ]);
  const r = selectedRankingRows(d).pitching[0];
  near(r.fastballExtension, 1.95); assert.equal(r.fastballExtensionSamples, 2);
  const config = selectedBoardConfig(d, 'pitching_fastball_extension')!;
  assert.equal(config.minKey, 'fastballExtensionSamples'); assert.equal(config.minDefault, 25);
  assert.equal(config.defaultSort, 'fastballExtension'); assert.equal(config.defaultDirection, 'desc');
  assert.equal(config.columns.find(c => c.key === 'fastballExtension')?.format, 'decimal');
  assert.deepEqual(config.rows.filter(p => p[config.minKey] >= config.minDefault), []);
  assert.equal(config.rows.filter(p => p[config.minKey] >= 2).length, 1);
});
test('fastball extension preserves measured zero and excludes entirely unmeasured pitchers', () => {
  const zero = selectedRankingRows(dataset([pitch(1, { extension: 0 })])).pitching[0];
  assert.equal(zero.fastballExtension, 0); assert.equal(zero.fastballExtensionSamples, 1);
  const missing = dataset([pitch(1, { extension: null }), pitch(2, { pitchType: 'スライダー' })]);
  assert.equal(selectedRankingRows(missing).pitching[0].fastballExtension, null);
  assert.deepEqual(selectedBoardConfig(missing, 'pitching_fastball_extension')!.rows, []);
});
test('fastball comparison excludes the hitter from reference EV and needs independent support', () => {
  const refs = Array.from({ length: 12 }, (_, i) => pitch(i + 1, { batterId: `other${i}`, pitcherId: `pitcher${i % 2}`, result: 'インプレー', exitVelocity: 130 }));
  const own = Array.from({ length: 5 }, (_, i) => pitch(i + 50, { result: 'インプレー', exitVelocity: 160 }));
  const r = fastballResponseRows([...refs, ...own]).get('b')!;
  near(r.expectedFastballEv!, 130); near(r.fastballEvDifference!, 30); assert.equal(r.matchedFastballBbe, 5);
  assert.equal(fastballResponseRows(own).size, 0);
  assert.equal(fastballResponseRows([...refs, ...own.map(p => ({ ...p, velocity: 144.9 }))]).has('b'), false);
});
const calls = (gameId: string, flip = false): Take[] => Array.from({ length: 40 }, (_, i) => ({ ...pitch(i, { gameId, plateX: i % 2 ? .4 : .1, plateZ: .75 }), actual: Number(Boolean(i % 2) === flip), expected: null, umpire: 'A' })) as Take[];
test('umpire consistency measures own repeatability rather than a geometric zone', () => {
  near(ownCallConsistency([...calls('a'), ...calls('b')]).consistencyRate!, 1);
  near(ownCallConsistency([...calls('a'), ...calls('b', true)]).consistencyRate!, 0);
  assert.equal(ownCallConsistency(calls('a')).consistencyRate, null);
});
test('matched call gaps remove differences in pitch-location composition', () => {
  const a = calls('a'), b = [...calls('b').filter(p => p.plateX === .1), ...calls('c').filter(p => p.plateX === .1), ...calls('b').filter(p => p.plateX === .4)];
  near(matchedCallGap(a, b, true).gap!, 0);
  near(matchedCallGap(a, a.map(p => ({ ...p, actual: 1 - p.actual })), true).gap!, 0);
  assert.equal(matchedCallGap(a.slice(0, 3), b, true).gap, null);
});
test('all selected boards produce finite real-season values without mutating source records', () => {
  for (const season of ['2026-fall', '2026-spring']) {
    const d = JSON.parse(readFileSync(new URL(`../public/data/season-${season}.json`, import.meta.url), 'utf8')) as Dataset;
    const before = JSON.stringify(d);
    for (const board of Object.keys(SELECTED_RANKINGS)) {
      const config = selectedBoardConfig(d, board)!;
      const qualified = config.rows.filter(p => p[config.minKey] >= config.minDefault && p[config.defaultSort] !== null);
      if (!board.startsWith('umpiring_') || season === '2026-fall') assert.ok(qualified.length > 0, board);
      for (const row of qualified) assert.ok(Number.isFinite(row[config.defaultSort]), board);
      assert.ok(config.columns.every(c => !['pa', 'bbe'].includes(c.key)), 'sample fields stay out of ranking columns');
    }
    assert.equal(JSON.stringify(d), before);
  }
});


test('every added ranking value and supplementary column has a complete metric explanation', () => {
  for (const spec of Object.values(SELECTED_RANKINGS)) {
    for (const column of [{ key: spec.metric, label: spec.metricLabel ?? spec.label }, ...(spec.extra ?? [])]) {
      const info = getMetricInfo(column.key, column.label);
      assert.ok(info, column.label);
      for (const field of ['title', 'catchline', 'reading', 'meaning', 'calculation', 'comparison', 'caution'] as const) assert.ok(info[field].trim().length > 0, `${column.label}: ${field}`);
    }
    assert.ok(getMetricInfo(undefined, spec.label), spec.label);
  }
});
