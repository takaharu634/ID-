import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyFramingAdjustment, fitFramingModel, framingUmpires, FRAMING_MODEL_VERSION } from '../lib/framing-adjustment.mjs';
import { buildDatasetFromRows } from '../lib/csv-analytics.js';
import type { Row } from '../lib/dataset-types.ts';

function fixture(strength = 0, edgeSpecific = false) {
  let seed = 91827;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const games: Row[] = [], pitches: Row[] = [], assignments = new Map<string, string>();
  for (let g = 0; g < 12; g++) {
    const id = `game-${g}`, target = edgeSpecific ? (g % 2 ? 'B' : 'A') : (g < 6 ? 'A' : 'B');
    games.push({ id }); assignments.set(id, edgeSpecific ? (g % 4 < 2 ? 'high-wide' : 'low-wide') : g < 6 ? 'wide' : 'narrow');
    for (const catcherId of [target, 'bridge']) for (let i = 0; i < 240; i++) {
      const high = edgeSpecific && catcherId !== 'bridge' ? (g % 4 === 0 || g % 4 === 3) : random() < .5;
      const x = (random() - .5) * .15, z = (high ? 1.05 : .45) + (random() - .5) * .10;
      const margin = Math.min(x + .254, .254 - x, z - .45, 1.05 - z);
      const umpire = edgeSpecific ? (g % 4 < 2 ? 1 : -1) * (high ? 1.2 : -1.2) : (g < 6 ? 1.2 : -1.2);
      const logit = margin * 24 + umpire + (g % 2 ? .3 : -.3) + (catcherId === 'A' ? strength : 0);
      const actual = random() < 1 / (1 + Math.exp(-logit));
      pitches.push({ id: `${id}-${catcherId}-${i}`, gameId: id, catcherId, pitcherId: 'shared', batterSide: i % 2 ? '右' : '左',
        balls: i % 4, strikes: i % 3, plateX: x, plateZ: z, pitchType: 'ストレート', pitcherThrows: '右', velocity: 140,
        result: actual ? '見逃しストライク' : 'ボール' });
    }
  }
  return { data: { games, pitches }, assignments };
}
function gap(predictions: Row[], key: string) {
  const mean = (id: string) => {
    const ps = predictions.filter(p => p.pitch.catcherId === id && p.shadow);
    return ps.reduce((s, p) => s + p.actual - p[key], 0) / ps.length;
  };
  return mean('A') - mean('B');
}

test('neutral catchers with unequal wide/narrow umpire assignments lose their artificial advantage', () => {
  const { data, assignments } = fixture(), result = fitFramingModel(data, assignments);
  assert.ok(result.diagnostics.converged, JSON.stringify(result.diagnostics));
  const raw = Math.abs(gap(result.predictions, 'leagueExpected')), adjusted = Math.abs(gap(result.predictions, 'expected'));
  assert.ok(raw > .3, `raw gap ${raw}`);
  assert.ok(adjusted < raw * .3 && adjusted < .08, `adjusted gap ${adjusted}, raw ${raw}`);
});
test('opposite high/low umpire biases are corrected when the overall called-strike rates are similar', () => {
  const { data, assignments } = fixture(0, true), result = fitFramingModel(data, assignments);
  const raw = Math.abs(gap(result.predictions, 'leagueExpected')), adjusted = Math.abs(gap(result.predictions, 'expected'));
  assert.ok(raw > .3);
  assert.ok(adjusted < raw * .4 && adjusted < .1, `adjusted ${adjusted}, raw ${raw}`);
});
test('joint catcher estimation preserves an actual catcher skill difference', () => {
  const neutral = fixture(), skilled = fixture(.9);
  const baseline = gap(fitFramingModel(neutral.data, neutral.assignments).predictions, 'expected');
  const improved = gap(fitFramingModel(skilled.data, skilled.assignments).predictions, 'expected');
  assert.ok(improved > .10 && improved > baseline + .08, `skill gap ${improved}, neutral ${baseline}`);
});
test('unknown umpires still receive game corrections and never share an invented unknown-umpire group', () => {
  const { data } = fixture(), result = fitFramingModel(data, new Map());
  assert.ok(result.predictions.every(p => p.umpire === ''));
  const raw = Math.abs(gap(result.predictions, 'leagueExpected')), adjusted = Math.abs(gap(result.predictions, 'expected'));
  assert.ok(adjusted < raw * .5, `game-only gap ${adjusted}, raw ${raw}`);
});
test('real season recalculation is immutable, idempotent, reconciles areas and updates embedded player records', () => {
  const data = JSON.parse(readFileSync(new URL('../public/data/season-2026-fall.json', import.meta.url), 'utf8'));
  delete data.metadata.framing;
  const original = JSON.stringify(data), adjusted = applyFramingAdjustment(data);
  assert.equal(JSON.stringify(data), original);
  assert.equal(applyFramingAdjustment(adjusted), adjusted);
  assert.equal(applyFramingAdjustment(data), adjusted);
  assert.equal(adjusted.metadata.framing.version, FRAMING_MODEL_VERSION);
  assert.ok(adjusted.metadata.framing.converged);
  assert.equal(adjusted.metadata.framing.registeredUmpireGames, 29);
  assert.equal(adjusted.metadata.framing.totalGames, 37);
  for (const key of ['pitches', 'games', 'batters', 'pitchers', 'pitchTypes', 'league', 'teams']) assert.deepEqual(adjusted[key], data[key]);
  for (const catcher of adjusted.catchers) {
    assert.equal(catcher.umpireAdjustedPitches + catcher.gameOnlyAdjustedPitches, catcher.shadowPitches);
    assert.equal(Object.values(catcher.framingAreas).reduce((s: number, a: unknown) => s + (a as Row).pitches, 0), catcher.shadowPitches);
    assert.deepEqual(adjusted.players.find((p: Row) => p.id === catcher.id).catching, catcher);
    assert.equal(catcher.avgPopTime, data.catchers.find((c: Row) => c.id === catcher.id).avgPopTime);
  }
});
test('invalid calls, missing location/side/count, and duplicate IDs cannot enter evaluation', () => {
  const { data, assignments } = fixture();
  const original = fitFramingModel(data, assignments);
  const p = data.pitches[0];
  const bad: Row[] = ['空振り', 'ファウル', 'インプレー', '死球', 'ワンバウンド', '敬遠'].map((result, i) => ({ ...p, id: `bad-${i}`, result }));
  bad.push({ ...p, id: 'missing', plateX: null }, { ...p, id: 'side', batterSide: '' }, { ...p, id: 'count', balls: 4 });
  const changed = fitFramingModel({ ...data, pitches: [...data.pitches, ...bad, p] }, assignments);
  assert.deepEqual(changed, original);
});
test('memo validation rejects mismatched game metadata and does not assign umpire rotation', () => {
  const id = '723a31a5-4d73-4b62-8aa1-66f696860a74';
  const game = { id, date: '2026/9/8', homeTeam: '中央大学', awayTeam: '青山学院大学' };
  assert.equal(framingUmpires([game]).get(id), '川合');
  assert.equal(framingUmpires([{ ...game, date: '2026-09-09' }]).size, 0);
  assert.equal(framingUmpires([{ ...game, id: 'unregistered' }]).size, 0);
});
test('CSV imports use the new model, and zero opportunities remain unavailable instead of a zero score', () => {
  const data = buildDatasetFromRows([{ PitchUID: 'swing', GameUID: 'game', Date: '2026-09-08', Catcher: 'Test, Catcher', CatcherId: 'c',
    CatcherTeam: 'CHU_UNI', PitcherTeam: 'CHU_UNI', Pitcher: 'Test, Pitcher', PitcherId: 'p', BatterTeam: 'AOY_UNI',
    Batter: 'Test, Batter', BatterId: 'b', BatterSide: 'Right', PitchCall: 'StrikeSwinging', PlateLocSide: '.254', PlateLocHeight: '.7' }]);
  assert.equal((data.metadata as Row).framing.version, FRAMING_MODEL_VERSION);
  assert.equal(data.catchers[0].extraStrikes, null);
  assert.equal(data.catchers[0].framingPer1000, null);
});
