import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Dataset, SeasonKey } from '../lib/dataset-types.ts';
import { comparisonSlots, updateComparisonSlot, buildComparisonEntries } from '../lib/player-comparison.ts';
import { restoreViewState } from '../lib/view-state.ts';

const available: SeasonKey[] = ['2026-fall', '2026-spring', '2025-fall'];
const dataset = (season: string, speed: number): Dataset => ({
  metadata: { season }, league: {}, teams: [], games: [], players: [], batters: [], catchers: [], pitches: [], highlights: {},
  pitchers: [{ id: 'shared-id', name: '投手', team: '大学' }],
  pitchTypes: [{ pitcherId: 'shared-id', pitchType: 'ストレート', avgVelocity: speed }],
});

test('legacy saved IDs default to the current season; invalid and excess seasons are bounded', () => {
  const result = comparisonSlots(['a', 'b'], [], available, '2026-fall');
  assert.deepEqual(result, [{ season: '2026-fall', playerId: 'a' }, { season: '2026-fall', playerId: 'b' }, { season: '2026-fall', playerId: '' }]);
  assert.deepEqual(comparisonSlots(['a', 'b', 'c', 'd'], ['2025-fall', 'unknown'], available, '2026-fall').map(slot => slot.season), ['2025-fall', '2026-fall', '2026-fall']);
});

test('the same pitcher in different seasons retains independent arsenal values and keys', () => {
  const slots = comparisonSlots(['shared-id', 'shared-id'], ['2026-fall', '2025-fall'], available, '2026-fall');
  const entries = buildComparisonEntries(slots, { '2026-fall': dataset('2026年秋季', 150), '2025-fall': dataset('2025年秋季', 140) });
  assert.equal(entries.length, 2);
  assert.notEqual(entries[0].key, entries[1].key);
  assert.deepEqual(entries.map(entry => entry.pitchTypes[0].avgVelocity), [150, 140]);
  assert.equal(buildComparisonEntries([slots[0], slots[0]], { '2026-fall': dataset('2026年秋季', 150) }).length, 1);
});

test('selecting a duplicate clears only the identical season/pitcher pair', () => {
  const slots = comparisonSlots(['shared-id', 'shared-id', 'other'], ['2026-fall', '2025-fall', '2026-fall'], available, '2026-fall');
  const result = updateComparisonSlot(slots, 2, { season: '2026-fall', playerId: 'shared-id' });
  assert.deepEqual(result.map(slot => slot.playerId), ['', 'shared-id', 'shared-id']);
  assert.equal(slots[0].playerId, 'shared-id', 'input state is not mutated');
});

test('missing, wrong-season and non-pitcher data cannot leak into a comparison', () => {
  const slots = comparisonSlots(['shared-id', 'shared-id', 'batter'], ['2026-fall', '2025-fall', '2026-fall'], available, '2026-fall');
  const fall = dataset('2026年秋季', 150); fall.players.push({ id: 'batter', roles: ['野手'] });
  assert.equal(buildComparisonEntries(slots, { '2026-fall': fall }).length, 1);
  assert.equal(buildComparisonEntries(slots, { '2026-fall': dataset('2025年秋季', 140) }).length, 0);
});

test('three per-slot seasons, IDs and pitch filters survive URL restoration', () => {
  const scope = 'compare|2026年秋季|';
  const defaults = { mode: 'players', ids: ['a'], seasons: ['2026-fall'], pitchType: '' };
  const saved = { mode: 'players', ids: ['a', 'b', 'a'], seasons: available, pitchType: 'スライダー' };
  const params = new URLSearchParams({ '条件先': scope, '条件': JSON.stringify(saved) });
  assert.deepEqual(restoreViewState(scope, defaults, params.toString(), null), saved);
  assert.deepEqual(restoreViewState(scope, defaults, '', JSON.stringify(saved)), saved);
  const legacy = restoreViewState(scope, defaults, '', JSON.stringify({ ids: ['a', 'b'] }));
  assert.deepEqual(comparisonSlots(legacy.ids, legacy.seasons, available, '2026-fall').map(slot => slot.season), ['2026-fall', '2026-fall', '2026-fall']);
});

test('actual 2026 autumn Higashionna and 2025 autumn Nakanishi use their own season summaries', () => {
  const fall = JSON.parse(readFileSync('public/data/season-2026-fall.json', 'utf8')) as Dataset;
  const old = JSON.parse(readFileSync('public/data/season-2025-fall.json', 'utf8')) as Dataset;
  const higashionna = fall.pitchers.find(player => /東恩納/.test(player.kanji ?? ''))!;
  const nakanishi = old.pitchers.find(player => /Nakanishi, Masaki/.test(player.name ?? ''))!;
  assert.ok(higashionna); assert.ok(nakanishi);
  const slots = comparisonSlots([higashionna.id, nakanishi.id], ['2026-fall', '2025-fall'], available, '2026-fall');
  const entries = buildComparisonEntries(slots, { '2026-fall': fall, '2025-fall': old });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].player, higashionna); assert.equal(entries[1].player, nakanishi);
  assert.deepEqual(entries[0].pitchTypes, fall.pitchTypes.filter(row => row.pitcherId === higashionna.id));
  assert.deepEqual(entries[1].pitchTypes, old.pitchTypes.filter(row => row.pitcherId === nakanishi.id));
});
