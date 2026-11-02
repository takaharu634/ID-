import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { gameDateKey, matchesDateRange, normalizeGameDates } from '../lib/game-dates.ts';
import { reportPeriod } from '../lib/batter-side-report.ts';

test('calendar validation rejects missing/impossible dates even with an end date alone', () => {
  for (const date of ['', null, '2026-02-30', 'not-a-date']) {
    assert.equal(gameDateKey(date), '');
    assert.equal(matchesDateRange(date, '', '2026-10-01'), false);
  }
  assert.equal(gameDateKey('2026/5/22'), '2026-05-22');
  assert.equal(matchesDateRange('2026/5/22', '2026-05-22', '2026-05-22'), true);
  assert.equal(matchesDateRange('', '', ''), true);
});

test('only an unambiguous game date fills a missing date, immutably and idempotently', () => {
  const source = { games:[{id:'g',date:'2026/5/22'},{id:'conflict',date:'2026-05-22'}], pitches:[{gameId:'g',date:''},{gameId:'conflict',date:'2026-05-23'},{gameId:'conflict',date:''},{gameId:'unknown',date:''}] };
  const before=structuredClone(source), fixed=normalizeGameDates(source);
  assert.deepEqual(fixed.pitches.map(p=>p.date),['2026-05-22','2026-05-23','','']);
  assert.deepEqual(source,before);assert.strictEqual(normalizeGameDates(fixed),fixed);
});

test('real historical date ranges, pitch IDs and printed periods reconcile', () => {
  for (const [season,beforeSeason] of [['2026-spring','2026-04-01'],['2025-fall','2025-09-01']]) {
    const raw=JSON.parse(readFileSync(`public/data/season-${season}.json`,'utf8'));
    const fixed=normalizeGameDates(raw);
    assert.equal(fixed.pitches.filter((p:{date:string})=>matchesDateRange(p.date,'',beforeSeason)).length,0);
    assert.deepEqual(fixed.pitches.map((p:{id:string})=>p.id),raw.pitches.map((p:{id:string})=>p.id));
    assert.ok(fixed.pitches.every((p:{date:string})=>/^\d{4}-\d{2}-\d{2}$/.test(p.date)));
    if(season==='2025-fall') assert.equal(reportPeriod(fixed.pitches.filter((p:{batterId:string})=>p.batterId==='id:1000274786|中央大学')),'2025-09-24〜2025-10-24');
  }
});
