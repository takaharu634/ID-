import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeByPitchType } from '../lib/pitch-summary.ts';
import { maxValue, minValue } from '../lib/extrema.mjs';

test('160,000 pitches aggregate without exceeding the JavaScript argument limit', () => {
  const pitches = Array.from({ length: 160000 }, (_, i) => ({ pitchType: 'ストレート', velocity: i === 159999 ? 155 : 145, result: 'ボール' }));
  const [summary] = summarizeByPitchType(pitches, 'pitcher');
  assert.equal(summary.pitches, 160000);
  assert.equal(summary.maxVelocity, 155);
  assert.equal(summary.avgVelocity, 145 + 10 / 160000);
  assert.equal(minValue(pitches.map(p => p.velocity)), 145);
  assert.equal(maxValue([], 0), 0);
  assert.equal(minValue([]), Infinity);
});
