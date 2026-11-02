import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { RETIRED_PERFORMANCE_KEYS, withoutEstimatedPerformance, activeRankingBoard } from '../lib/retired-performance.ts';
import { METRIC_INFO, METRIC_KEY_BY_LABEL, getMetricInfo } from '../lib/metric-definitions.ts';

function assertNoEstimates(value: unknown) {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    assert.ok(!RETIRED_PERFORMANCE_KEYS.has(key), key);
    assertNoEstimates(item);
  }
}

test('read-time removal covers all legacy seasons without changing measured or actual records', () => {
  for (const season of ['2025-fall', '2026-spring', '2026-fall']) {
    const source = JSON.parse(readFileSync(`public/data/season-${season}.json`, 'utf8'));
    const before = JSON.stringify(source), value = withoutEstimatedPerformance(source);
    assertNoEstimates(value);
    assert.equal(JSON.stringify(source), before, 'source snapshot must remain recoverable');
    assert.equal(value.pitches.length, source.pitches.length);
    for (let i = 0; i < value.pitches.length; i++) {
      for (const [key, field] of Object.entries(source.pitches[i])) {
        if (!RETIRED_PERFORMANCE_KEYS.has(key)) assert.deepEqual(value.pitches[i][key], field, `${season}: pitch ${i} ${key}`);
      }
    }
    for (const role of ['pitchers', 'batters', 'catchers']) {
      for (let i = 0; i < value[role].length; i++) {
        for (const field of ['wrcPlus', 'battingAverage', 'ops', 'woba', 'era', 'strikeouts', 'homeRuns', 'framingRuns', 'expectedStrikeRate']) {
          assert.deepEqual(value[role][i][field], source[role][i][field], `${role}: ${field}`);
        }
      }
    }
    assert.strictEqual(withoutEstimatedPerformance(value), value, 'normalization is idempotent');
  }
});

test('unrelated expectations and inferred physics remain available', () => {
  const value = withoutEstimatedPerformance({ xwoba: .3, expectedStrikeRate: .5, gyroAngle: 30, inferredRunners: 2, frame: { expectedStrikes: 10, xera: 3 } });
  assert.deepEqual(value, { expectedStrikeRate: .5, gyroAngle: 30, inferredRunners: 2, frame: { expectedStrikes: 10 } });
});

test('retired metrics have no definitions or label aliases and old links use active rankings', () => {
  for (const key of RETIRED_PERFORMANCE_KEYS) {
    assert.equal(METRIC_INFO[key], undefined, key);
    assert.ok(!Object.values(METRIC_KEY_BY_LABEL).includes(key), key);
    assert.equal(getMetricInfo(key), null, key);
  }
  assert.equal(activeRankingBoard('batting_expected'), 'batting_percentile');
  assert.equal(activeRankingBoard('pitching_expected'), 'pitching_strikeouts');
  assert.equal(activeRankingBoard('pitching_percentile'), 'pitching_strikeouts');
  assert.equal(activeRankingBoard('batting_average'), 'batting_average');
});
