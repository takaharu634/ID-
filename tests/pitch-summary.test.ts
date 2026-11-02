import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeByPitchType } from '../lib/pitch-summary.ts';

test('pitch-type EV excludes fouls and bunts while hit rate keeps unmeasured fair-ball outcomes', () => {
  const rows = [
    { result: 'インプレー', playResult: '単打', exitVelocity: 160, launchAngle: 10 },
    { result: 'インプレー', playResult: 'アウト', exitVelocity: 140, launchAngle: 10 },
    { result: 'インプレー', playResult: 'アウト', exitVelocity: null, launchAngle: 10 },
    { result: 'ファウル', exitVelocity: 200, launchAngle: 10 },
    { result: '空振り' },
  ].map(row => ({ ...row, pitchType: 'ストレート' }));
  for (const role of ['batter', 'pitcher'] as const) {
    const [value] = summarizeByPitchType(rows, role);
    assert.equal(value.pitches, 5);
    assert.equal(value.avgExitVelocity, 150);
    assert.equal(value.hardHitRate, .5);
    assert.equal(value.battingAverage, 1 / 3);
    assert.equal(value.whiffRate, .2);
    const [bunt] = summarizeByPitchType([...rows, { pitchType: 'ストレート', result: 'インプレー', playResult: '犠打', hitType: 'Bunt', exitVelocity: 60, launchAngle: 0 }], role);
    assert.equal(bunt.avgExitVelocity, 150);
    assert.equal(bunt.hardHitRate, .5);
    assert.equal(bunt.battingAverage, .25);
  }
});

test('missing fair-ball measurements and unknown outcomes remain missing', () => {
  const [value] = summarizeByPitchType([
    { pitchType: 'カーブ', result: 'ファウル', exitVelocity: 150, launchAngle: 0 },
    { pitchType: 'カーブ', result: 'インプレー', playResult: '不明', exitVelocity: null },
  ], 'batter');
  assert.equal(value.avgExitVelocity, null);
  assert.equal(value.hardHitRate, null);
  assert.equal(value.battingAverage, null);
});
