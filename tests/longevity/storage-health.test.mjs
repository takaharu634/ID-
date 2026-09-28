import test from 'node:test';
import assert from 'node:assert/strict';
import { storagePage, capacityProjection, releaseCheck, validSeason, storageHealthResponse } from '../../server/storage-health.mjs';

const allow = () => null;
const request = suffix => new Request('https://example.test/api/storage-health' + suffix);

test('inventory pages are categorized, not mislabelled as total bucket size', async () => {
  let options;
  const result = await storagePage({ list: async x => { options = x; return { objects: [
    { key: 'datasets/v2/2026-fall/head.json', size: 10 },
    { key: 'datasets/v2/2026-fall/versions/abc/raw.csv', size: 100 },
    { key: 'datasets/v2/staged/abc.json', size: 20 },
  ], truncated: true, cursor: 'next' }; } });
  assert.equal(options.prefix, 'datasets/'); assert.equal(result.scope, 'page');
  assert.equal(result.pageBytes, 130); assert.equal(result.groups.snapshots.bytes, 100);
  assert.equal(result.nextCursor, 'next'); assert.equal(result.includesDatabase, false);
  assert.equal(result.atomicSnapshot, false);
});

test('short intermediate page still exposes next cursor', async () => {
  const result = await storagePage({ list: async () => ({ objects: [], truncated: true, cursor: 'resume' }) });
  assert.equal(result.nextCursor, 'resume'); assert.equal(result.isLastPage, false);
});

test('invalid pages, non-advancing cursors and metadata fail closed', async () => {
  for (const page of [ { objects: [], truncated: true }, { objects: [], truncated: true, cursor: 'old' },
    { objects: [], truncated: undefined }, { objects: [{ key: 'secrets/1', size: 1 }], truncated: false },
    { objects: [{ key: 'datasets/1', size: -1 }], truncated: false } ]) {
    await assert.rejects(storagePage({ list: async () => page }, { cursor: 'old' }));
  }
});

test('limits validated before storage access', async () => {
  const bucket = { list: () => { throw new Error('must not be called'); } };
  for (const limit of [0, 1001, -1, 1.5, NaN]) await assert.rejects(storagePage(bucket, { limit }), /limit/);
});

test('unauthorized storage access is blocked before binding reads', async () => {
  const denied = () => Response.json({ error: 'login' }, { status: 401 });
  const result = await storageHealthResponse(request(''), { BUCKET: { list: () => assert.fail('read not allowed') } }, denied);
  assert.equal(result.status, 401);
});

test('unavailable storage returns 503, invalid parameters 400, success no-store', async () => {
  const env = { BUCKET: { list: async () => ({ objects: [], truncated: false }) } };
  assert.equal((await storageHealthResponse(request(''), {}, allow)).status, 503);
  for (const suffix of ['?limit=0','?limit=1001','?limit=abc','?cursor=']) assert.equal((await storageHealthResponse(request(suffix), env, allow)).status, 400);
  const result = await storageHealthResponse(request(''), env, allow);
  assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'no-store');
});

test('storage failure does not leak internal error or keys', async () => {
  const response = await storageHealthResponse(request(''), { BUCKET: { list: () => { throw new Error('secret'); } } }, allow);
  assert.equal(response.status, 503); assert.equal((await response.text()).includes('secret'), false);
});

test('capacity estimates expose supplied assumptions and unknown budget', () => {
  const result = capacityProjection({ observedBytes: 100, observedSeasons: 1, years: 10 });
  assert.equal(result.estimatedBytes, 7200); assert.equal(result.withinBudget, null);
  assert.equal(result.isMeasuredCapacity, false);
  assert.equal(capacityProjection({ observedBytes: 100, observedSeasons: 1, years: 10, budgetBytes: 1000 }).withinBudget, false);
  assert.throws(() => capacityProjection({ observedBytes: 1, observedSeasons: 0, years: 10 }));
});

test('generic season identifiers do not restrict future years', () => {
  for (const s of ['2027-spring','2040-fall','9999-fall']) assert.equal(validSeason(s), true);
  for (const s of ['../2027-spring','2027-winter','2027-Spring','0200-fall']) assert.equal(validSeason(s), false);
});

test('release checker refuses unknown production source and missing evidence', () => {
  const result = releaseCheck({}); assert.equal(result.ready, false);
  assert.ok(result.reasons.includes('PUBLISHED_SOURCE_UNKNOWN'));
  assert.ok(result.reasons.includes('RESTORE_NOT_VERIFIED'));
});

test('release checker requires source/build/test agreement and no schema downgrade', () => {
  const source = 'a'.repeat(40), base = 'b'.repeat(40);
  const ok = { sourceCommit: source, builtCommit: source, testedCommit: source, basedOnPublishedCommit: base,
    observedPublishedCommit: base, testsPassed: true, restoreDrillPassed: true, schemaVersion: 2, deployedSchemaVersion: 2 };
  assert.equal(releaseCheck(ok).ready, true);
  assert.equal(releaseCheck({ ...ok, builtCommit: base }).ready, false);
  assert.equal(releaseCheck({ ...ok, schemaVersion: 1 }).ready, false);
});
