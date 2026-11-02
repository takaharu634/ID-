import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPitcherGameLog, fastestPitchContext } from '../lib/pitcher-game-log.ts';
import type { Row } from '../lib/dataset-types.ts';
import { batterGamePaNumbers } from '../lib/batter-game-pa.ts';

const base = { pitcherId: 'p1', pitcherTeam: 'A', batterTeam: 'B', gameId: 'g1', date: '2026/9/8', pitchType: 'ストレート' };

test('separates same-day games and pitchers; averages exclude missing measurements but retain pitch counts', () => {
  const result = buildPitcherGameLog([
    { ...base, id: 'a', velocity: 150, ivb: 40, hb: -20 },
    { ...base, id: 'b', velocity: null, ivb: null, hb: null },
    { ...base, id: 'c', velocity: 140, ivb: 30, hb: 0 },
    { ...base, id: 'd', velocity: 120, ivb: 10, hb: -5, pitchType: 'フォーク' },
    { ...base, id: 'e', velocity: 160, pitcherId: 'p2' },
    { ...base, id: 'f', velocity: 148, gameId: 'g2' },
  ], [], 'p1');
  assert.equal(result.length, 2);
  const first = result.find(row => row.gameId === 'g1')!;
  assert.equal(first.pitches, 4);
  assert.equal(first.maxVelocity, 150);
  assert.equal(first.arsenal[0].pitches, 3);
  assert.equal(first.arsenal[0].avgVelocity, 145);
  assert.equal(first.arsenal[0].avgIvb, 35);
  assert.equal(first.arsenal[0].avgHb, -10);
  assert.equal(first.date, '2026-09-08');
});

test('retains every max-speed pitch and identifies its original PA rather than its position in filtered rows', () => {
  const pitches = [
    { ...base, id: 'max2', velocity: 150, pitchNo: 70, inning: 4, half: '表', batterKanji: '打者 甲', paOfInning: 3, pitchOfPA: 6, balls: 2, strikes: 2 },
    { ...base, id: 'max1', velocity: 150, pitchNo: 12 },
    { ...base, id: 'low', velocity: 149.9, pitchNo: 5 },
  ];
  const game = buildPitcherGameLog(pitches, [], 'p1')[0];
  assert.deepEqual(game.fastest.map(row => row.id), ['max1', 'max2']);
  assert.match(fastestPitchContext({ ...pitches[0], batterGamePa: 2 }), /4回表 · 打者 甲 · この試合の第2打席 · 打席6球目 · 2–2/);
  const filtered = buildPitcherGameLog([pitches[0]], [], 'p1')[0];
  assert.equal(filtered.fastest[0].pitchOfPA, 6);
});

test('batter game PA resets by game, survives pitching changes and filters, and counts batting around', () => {
  const p = (id: string, pitchNo: number, inning: number, paOfInning: number, extra: Row = {}) => ({ ...base, id, pitchNo, inning, paOfInning, batterId: 'b1', half: '表', velocity: 140, ...extra });
  const pitches = [
    p('a', 1, 1, 1), p('a', 1, 1, 1), // Duplicate pitch is still the same PA.
    p('b', 20, 1, 10), p('c', 21, 1, 10, { pitcherId: 'p2' }),
    p('d', 50, 3, 2, { pitcherId: 'p2', velocity: 150 }),
    p('e', 1, 1, 1, { gameId: 'g2' }),
  ].reverse();
  const index = batterGamePaNumbers(pitches);
  assert.deepEqual(['a', 'b', 'c', 'd', 'e'].map(id => index.get(id)), [1, 2, 2, 3, 1]);
  const filtered = buildPitcherGameLog(pitches.filter(p => p.id === 'd'), [], 'p2', pitches);
  assert.equal(filtered[0].fastest[0].batterGamePa, 3);
  assert.equal(batterGamePaNumbers([{ ...p('missing', 1, 1, 1), paOfInning: null }]).size, 0);
});

test('Sep 24 Higashionna maximum was Ishino second game PA, not sixth inning PA', () => {
  const data = JSON.parse(readFileSync('public/data/season-2026-fall.json', 'utf8'));
  const pitch = data.pitches.find((p: Row) => p.id === '4c74ac90-b7e3-11f1-83b1-2346cded5ecf');
  assert.equal(batterGamePaNumbers(data.pitches).get(pitch.id), 2);
  const game = buildPitcherGameLog([pitch], data.games, pitch.pitcherId, data.pitches)[0];
  assert.match(fastestPitchContext(game.fastest[0]), /3回裏 · 石野 蓮授 · この試合の第2打席 · 打席4球目/);
});

test('missing measurements and PA metadata are not invented; game metadata fills missing date/opponent', () => {
  const pitch = { ...base, id: 'missing', date: '', velocity: null, ivb: null, hb: null, inning: 2, half: '裏', batter: 'Batter', pitchNo: 40, balls: null, strikes: null };
  const game = buildPitcherGameLog([pitch], [{ id: 'g1', date: '2026/9/9', homeTeam: 'B', awayTeam: 'A' }], 'p1')[0];
  assert.equal(game.maxVelocity, null);
  assert.equal(game.arsenal[0].avgVelocity, null);
  assert.equal(game.arsenal[0].avgIvb, null);
  assert.deepEqual(game.fastest, []);
  assert.equal(game.date, '2026-09-09');
  assert.equal(game.opponent, 'B');
  assert.match(fastestPitchContext(pitch), /試合通算40球目/);
  assert.doesNotMatch(fastestPitchContext(pitch), /打席\d|0–0/);
  assert.deepEqual(buildPitcherGameLog([pitch], [], ''), []);
  assert.deepEqual(buildPitcherGameLog([], [], 'p1'), []);
});

test('game pitch-type measurements exclude missing values, retain signed movement and release side, and follow filters', () => {
  const pitches = [
    { ...base, id: 'a', spin: 2300, ivb: -40, hb: -30, releaseHeight: 170, extension: 180, releaseSide: -40 },
    { ...base, id: 'b', spin: 2500, ivb: 20, hb: 10, releaseHeight: 180, extension: 200, releaseSide: 0 },
    { ...base, id: 'missing', spin: null, ivb: null, hb: null, releaseHeight: null, extension: null, releaseSide: null },
    { ...base, id: 'other-type', pitchType: 'フォーク', spin: 900, releaseHeight: 165, extension: 190, releaseSide: -25 },
    { ...base, id: 'other-game', gameId: 'g2', spin: 3000, releaseHeight: 200, extension: 220, releaseSide: 70 },
    { ...base, id: 'other-pitcher', pitcherId: 'p2', spin: 3500 },
  ];
  const game = buildPitcherGameLog(pitches, [], 'p1').find(row => row.gameId === 'g1')!;
  const row = game.arsenal.find(row => row.pitchType === 'ストレート')!;
  assert.equal(row.pitches, 3);
  assert.equal(row.avgSpin, 2400); assert.equal(row.maxSpin, 2500);
  assert.equal(row.avgIvb, -10); assert.equal(row.maxIvb, -40);
  assert.equal(row.avgHb, -10); assert.equal(row.maxHb, -30);
  assert.equal(row.avgReleaseHeight, 175); assert.equal(row.avgExtension, 190); assert.equal(row.avgReleaseSide, -20);
  const filtered = buildPitcherGameLog([pitches[1]], [], 'p1', pitches)[0].arsenal[0];
  assert.equal(filtered.avgSpin, 2500); assert.equal(filtered.maxSpin, 2500);
  assert.equal(filtered.avgReleaseHeight, 180); assert.equal(filtered.avgExtension, 200); assert.equal(filtered.avgReleaseSide, 0);
  const empty = buildPitcherGameLog([pitches[2]], [], 'p1', pitches)[0].arsenal[0];
  for (const field of ['avgSpin', 'maxSpin', 'avgIvb', 'maxIvb', 'avgHb', 'maxHb', 'avgReleaseHeight', 'avgExtension', 'avgReleaseSide'] as const) assert.equal(empty[field], null, field);
});

test('all three bundled seasons retain every pitcher-game pitch and agree with independent measured averages and maxima', () => {
  for (const season of ['2026-fall', '2026-spring', '2025-fall']) {
    const data = JSON.parse(readFileSync(`public/data/season-${season}.json`, 'utf8'));
    const pitcherIds = new Set<string>(data.pitches.map((row: Row) => row.pitcherId));
    let counted = 0;
    for (const pitcherId of pitcherIds) for (const game of buildPitcherGameLog(data.pitches, data.games, pitcherId)) {
      const source = data.pitches.filter((row: Row) => row.pitcherId === pitcherId && row.gameId === game.gameId);
      counted += game.pitches;
      assert.equal(game.pitches, source.length);
      assert.equal(game.arsenal.reduce((sum, row) => sum + row.pitches, 0), source.length);
      const speeds = source.map((row: Row) => row.velocity).filter((value: unknown) => typeof value === 'number' && Number.isFinite(value));
      assert.equal(game.maxVelocity, speeds.length ? Math.max(...speeds) : null);
      for (const row of game.arsenal) {
        const measured = source.filter((pitch: Row) => pitch.pitchType === row.pitchType && typeof pitch.velocity === 'number' && Number.isFinite(pitch.velocity));
        const expected = measured.length ? measured.reduce((sum: number, pitch: Row) => sum + pitch.velocity, 0) / measured.length : null;
        assert.equal(row.avgVelocity, expected);
        const group = source.filter((pitch: Row) => pitch.pitchType === row.pitchType);
        for (const [field, key] of [['spin', 'avgSpin'], ['ivb', 'avgIvb'], ['hb', 'avgHb'], ['releaseHeight', 'avgReleaseHeight'], ['extension', 'avgExtension'], ['releaseSide', 'avgReleaseSide']] as const) {
          const values = group.map((pitch: Row) => pitch[field]).filter((value: unknown) => typeof value === 'number' && Number.isFinite(value));
          assert.equal(row[key], values.length ? values.reduce((sum: number, value: number) => sum + value, 0) / values.length : null, `${season}/${game.gameId}/${row.pitchType}/${key}`);
        }
        const spins = group.map((pitch: Row) => pitch.spin).filter((value: unknown) => typeof value === 'number' && Number.isFinite(value));
        assert.equal(row.maxSpin, spins.length ? Math.max(...spins) : null);
      }
    }
    assert.equal(counted, data.pitches.length);
  }
});
