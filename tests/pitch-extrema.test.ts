import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { summarizePitchExtrema, withPitchTypeExtrema, pitchExtremaSortValue } from '../lib/pitch-extrema.ts';
import { summarizeByPitchType } from '../lib/pitch-summary.ts';

test('movement retains the greatest signed displacement; VAA maximum is the flatter numerical value', () => {
  assert.deepEqual(summarizePitchExtrema([
    { ivb: 12, hb: -48, vaa: -6 },
    { ivb: -36, hb: 20, vaa: -4 },
    { ivb: -8, hb: -12, vaa: -8 },
  ]), { maxIvb: -36, maxHb: -48, maxVaa: -4 });
  assert.ok(pitchExtremaSortValue('maxHb', -48) > pitchExtremaSortValue('maxHb', 20));
  assert.ok(pitchExtremaSortValue('maxVaa', -4) > pitchExtremaSortValue('maxVaa', -6));
});

test('missing measurements remain null, finite numeric strings work, and measured zero survives', () => {
  const missing = [null, undefined, '', ' ', false, NaN, Infinity, -Infinity, 'invalid']
    .map(value => ({ ivb: value, hb: value, vaa: value }));
  assert.deepEqual(summarizePitchExtrema(missing), { maxIvb: null, maxHb: null, maxVaa: null });
  assert.deepEqual(summarizePitchExtrema([...missing, { ivb: '0', hb: 0, vaa: '-4.2' }]),
    { maxIvb: 0, maxHb: 0, maxVaa: -4.2 });
  assert.deepEqual(summarizePitchExtrema([]), { maxIvb: null, maxHb: null, maxVaa: null });
});

test('opposite signed ties are deterministic regardless of pitch order', () => {
  const pitches = [{ ivb: -30, hb: 40 }, { ivb: 30, hb: -40 }];
  assert.deepEqual(summarizePitchExtrema(pitches), summarizePitchExtrema([...pitches].reverse()));
});

test('pitcher and pitch type groups stay isolated and legacy averages are untouched', () => {
  const rows = [
    { pitcherId: 'p1', pitchType: 'ストレート', avgIvb: 33.3 },
    { pitcherId: 'p1', pitchType: 'カーブ', avgIvb: -11.1 },
    { pitcherId: 'p2', pitchType: 'ストレート', avgIvb: 22.2 },
    { pitcherId: 'p3', pitchType: 'ストレート', avgIvb: null },
  ];
  const original = structuredClone(rows);
  const pitches = [
    { pitcherId: 'p1', pitchType: 'ストレート', ivb: 40, hb: -30, vaa: -5 },
    { pitcherId: 'p1', pitchType: 'ストレート', ivb: 30, hb: -45, vaa: -4 },
    { pitcherId: 'p1', pitchType: 'カーブ', ivb: -25, hb: 15, vaa: -8 },
    { pitcherId: 'p2', pitchType: 'ストレート', ivb: 50, hb: 40, vaa: -3 },
  ];
  const result = withPitchTypeExtrema(rows, pitches);
  assert.deepEqual(result.map(row => row.maxIvb), [40, -25, 50, null]);
  assert.deepEqual(result.map(row => row.maxVaa), [-4, -8, -3, null]);
  assert.deepEqual(rows, original);
  assert.deepEqual(result.map(row => row.avgIvb), original.map(row => row.avgIvb));
  const filtered = summarizeByPitchType(pitches.filter(row => row.pitcherId === 'p1' && row.vaa === -5), 'pitcher');
  assert.deepEqual([filtered[0].maxIvb, filtered[0].maxHb, filtered[0].maxVaa], [40, -30, -5]);
  assert.equal(withPitchTypeExtrema(rows, pitches.filter(row => row.pitcherId === 'p2'))[0].maxIvb, null);
});

test('all bundled seasons produce maxima from each pitcher/type group including left-handed pitchers', async () => {
  for (const season of ['2025-fall', '2026-spring', '2026-fall']) {
    const data = JSON.parse(await readFile(new URL(`../public/data/season-${season}.json`, import.meta.url), 'utf8'));
    const rows = withPitchTypeExtrema(data.pitchTypes, data.pitches);
    let negativeHorizontal = 0;
    for (const row of rows) {
      const pitches = data.pitches.filter((pitch: Record<string, unknown>) => pitch.pitcherId === row.pitcherId && pitch.pitchType === row.pitchType);
      for (const [field, key] of [['ivb', 'maxIvb'], ['hb', 'maxHb'], ['vaa', 'maxVaa']] as const) {
        const values: number[] = pitches.map((pitch: Record<string, unknown>) => pitch[field]).filter((value: unknown) => typeof value === 'number' && Number.isFinite(value));
        const expected = values.length ? key === 'maxVaa' ? Math.max(...values) : [...values].sort((a, b) => Math.abs(b) - Math.abs(a) || b - a)[0] : null;
        assert.equal(row[key], expected, `${season} ${row.pitcherId} ${row.pitchType} ${key}`);
      }
      if (row.maxHb !== null && row.maxHb < 0) negativeHorizontal++;
    }
    assert.ok(negativeHorizontal > 0);
  }
});
