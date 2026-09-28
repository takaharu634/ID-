import test from 'node:test';
import assert from 'node:assert/strict';
import { createImportJob, putImportChunk, updateImportJob, getImportJob, listImportJobs } from '../../server/import-jobs.mjs';
import { sha256 } from '../../server/object-store.mjs';
import { stageImport, readHead, commitStage } from '../../server/import-store.mjs';

class Bucket {
  items = new Map(); onPut = null; afterPut = null; onGet = null; onList = null; failDelete = false;
  async get(key) {
    if (this.onGet) await this.onGet(key);
    const saved = this.items.get(key); if (!saved) return null;
    const bytes = saved.bytes.slice();
    return { etag: saved.etag, size: bytes.length, arrayBuffer: async () => bytes.slice().buffer, text: async () => new TextDecoder().decode(bytes), json: async () => JSON.parse(new TextDecoder().decode(bytes)) };
  }
  async put(key, value, options = {}) {
    if (this.onPut) await this.onPut(key);
    const old = this.items.get(key);
    if (options.onlyIf?.etagMatches && options.onlyIf.etagMatches !== old?.etag) return null;
    if (options.onlyIf?.get?.('If-None-Match') === '*' && old) return null;
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
    const etag = await sha256(bytes); this.items.set(key, { bytes, etag }); if (this.afterPut) await this.afterPut(key); return { etag };
  }
  async delete(keys) { if (this.failDelete) throw new Error('injected delete failure'); for (const k of Array.isArray(keys) ? keys : [keys]) this.items.delete(k); }
  async list({ prefix = '', delimiter, limit = 1000 } = {}) {
    const keys = [...this.items.keys()].filter(k => k.startsWith(prefix)).sort();
    if (this.onList) await this.onList(prefix);
    if (delimiter) return { objects: [], delimitedPrefixes: [...new Set(keys.map(k => prefix + k.slice(prefix.length).split('/')[0] + '/'))], truncated: false };
    return { objects: keys.slice(0, limit).map(key => ({ key })), truncated: false };
  }
}
const owner = 'audit-owner';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function create(bucket, text = 'a') {
  const state = await createImportJob(bucket, owner, [{ name: 'game.csv', season: '2042-fall', size: Buffer.byteLength(text), sha256: await sha256(text) }]);
  return { ...state, bytes: new TextEncoder().encode(text), hash: await sha256(text) };
}
async function action(bucket, state, op, extra = {}) {
  const result = await updateImportJob(bucket, owner, { id: state.job.id, revision: state.job.revision, token: state.token, action: op, ...extra });
  state.job = result.job; if (result.token) state.token = result.token; return result;
}
const sources = bucket => [...bucket.items.keys()].filter(k => k.includes('/sources/'));

test('cancelled tombstone permits source cleanup retry after storage deletion failed', async () => {
  const bucket = new Bucket(), state = await create(bucket);
  state.job = await putImportChunk(bucket, owner, state.job.id, 0, 0, state.bytes, state.hash, state.job.revision, state.token);
  bucket.failDelete = true;
  await assert.rejects(() => action(bucket, state, 'cancel'), /injected delete failure/);
  assert.equal((await getImportJob(bucket, owner, state.job.id)).status, 'cancelled');
  bucket.failDelete = false;
  await action(bucket, state, 'cancel');
  assert.equal(sources(bucket).length, 0);
});

test('terminal cleanup failure remains discoverable for a later retry', async () => {
  const bucket = new Bucket(), state = await create(bucket);
  state.job = await putImportChunk(bucket, owner, state.job.id, 0, 0, state.bytes, state.hash, state.job.revision, state.token);
  bucket.failDelete = true;
  await assert.rejects(() => action(bucket, state, 'cancel'), /injected delete failure/);
  assert.ok(sources(bucket).length > 0);
  const visible = await listImportJobs(bucket, owner);
  assert.ok(visible.jobs.some(job => job.id === state.job.id), 'cleanup failure must remain reachable after reopening the admin page');
});

test('late PUT after cancellation removes the source it wrote', async () => {
  const bucket = new Bucket(), state = await create(bucket), entered = deferred(), resume = deferred();
  bucket.onPut = async key => { if (key.includes('/sources/')) { entered.resolve(); await resume.promise; } };
  const pending = putImportChunk(bucket, owner, state.job.id, 0, 0, state.bytes, state.hash, state.job.revision, state.token);
  const observed = pending.catch(e => e);
  await entered.promise; await action(bucket, state, 'cancel'); resume.resolve();
  assert.equal((await observed).status, 409);
  assert.equal(sources(bucket).length, 0);
});

test('old-owner late PUT removes its orphan when a new owner finished a different hash', async () => {
  const bucket = new Bucket(), state = await create(bucket, 'a'), entered = deferred(), resume = deferred();
  bucket.onPut = async key => { if (key.includes('/sources/') && key.endsWith(state.hash)) { entered.resolve(); await resume.promise; } };
  const pending = putImportChunk(bucket, owner, state.job.id, 0, 0, state.bytes, state.hash, state.job.revision, state.token);
  const observed = pending.catch(e => e);
  await entered.promise;
  await action(bucket, state, 'pause'); await action(bucket, state, 'claim');
  const b = new TextEncoder().encode('b');
  state.job = await putImportChunk(bucket, owner, state.job.id, 0, 0, b, await sha256(b), state.job.revision, state.token);
  resume.resolve(); assert.equal((await observed).status, 409);
  assert.equal(sources(bucket).length, 1, 'only the replacement source should survive');
});

test('publishing fence rejects cancellation while commitStage is in flight', async () => {
  const bucket = new Bucket(), state = await create(bucket);
  state.job = await putImportChunk(bucket, owner, state.job.id, 0, 0, state.bytes, state.hash, state.job.revision, state.token);
  await action(bucket, state, 'ready');
  const stage = await stageImport(bucket, '2042-fall', { raw: 'a', summary: '{"pitches":[]}', spin: '[]' }, { report: { warnings: [] }, baseEtag: null, pitchCount: 1, gameCount: 1 });
  await action(bucket, state, 'prepared', { season: '2042-fall', stageId: stage.id });
  let stageReads = 0, cancelError;
  bucket.onGet = async key => {
    if (key === `datasets/v2/staged/${stage.id}.json` && ++stageReads === 3) {
      state.job = await getImportJob(bucket, owner, state.job.id);
      cancelError = await action(bucket, state, 'cancel').catch(error => error);
    }
  };
  await action(bucket, state, 'publish', { season: '2042-fall' });
  assert.equal(cancelError.code, 'publishing');
  assert.equal((await getImportJob(bucket, owner, state.job.id)).seasons[0].status, 'committed');
  assert.equal((await readHead(bucket, '2042-fall')).active, stage.id);
});

test('lost commit response is reconciled only by a current lease owner without switching the head again', async () => {
  const bucket = new Bucket(), state = await create(bucket);
  state.job = await putImportChunk(bucket, owner, state.job.id, 0, 0, state.bytes, state.hash, state.job.revision, state.token);
  await action(bucket, state, 'ready');
  const stage = await stageImport(bucket, '2042-fall', { raw: 'a', summary: '{"pitches":[]}', spin: '[]' }, { report: { warnings: [] }, baseEtag: null, pitchCount: 1, gameCount: 1 });
  await action(bucket, state, 'prepared', { season: '2042-fall', stageId: stage.id });
  let headWrites = 0;
  bucket.afterPut = async key => { if (key === 'datasets/v2/2042-fall/head.json') { headWrites++; throw new Error('injected lost head response'); } };
  await assert.rejects(() => action(bucket, state, 'publish', { season: '2042-fall' }), /injected lost head response/);
  state.job = await getImportJob(bucket, owner, state.job.id);
  assert.ok(state.job.publishing);
  await assert.rejects(() => updateImportJob(bucket, 'another-owner', { id: state.job.id, action: 'reconcile', season: '2042-fall', token: state.token, revision: state.job.revision }), error => error.status === 404);
  await assert.rejects(() => updateImportJob(bucket, owner, { id: state.job.id, action: 'reconcile', season: '2042-fall', token: 'stale-token', revision: state.job.revision }), error => error.code === 'lease');
  await action(bucket, state, 'reconcile', { season: '2042-fall' });
  assert.equal(state.job.seasons[0].status, 'committed');
  assert.equal(state.job.publishing, null);
  assert.equal(headWrites, 1);
});

test('unbounded declared file sizes fail before allocation or storage writes', async () => {
  const bucket = new Bucket(), hash = await sha256('a');
  await assert.rejects(() => createImportJob(bucket, owner, [{ name: 'huge.csv', season: '2042-fall', size: Number.MAX_SAFE_INTEGER, sha256: hash }]), error => error.status === 413);
  assert.equal(bucket.items.size, 0);
});

test('a different season cannot clear an in-flight publishing fence through reconcile', async () => {
  const bucket = new Bucket();
  const state = await createImportJob(bucket, owner, [
    { name: 'fall.csv', size: 1, season: '2042-fall', sha256: await sha256('a') },
    { name: 'spring.csv', size: 1, season: '2042-spring', sha256: await sha256('a') },
  ]);
  const bytes = new TextEncoder().encode('a'), hash = await sha256(bytes);
  for (let i = 0; i < 2; i++) state.job = await putImportChunk(bucket, owner, state.job.id, i, 0, bytes, hash, state.job.revision, state.token);
  await action(bucket, state, 'ready');
  const payload = { raw: 'a', summary: '{"pitches":[]}', spin: '[]' }, meta = { report: { warnings: [] }, baseEtag: null, pitchCount: 1, gameCount: 1 };
  const fall = await stageImport(bucket, '2042-fall', payload, meta);
  const spring = await stageImport(bucket, '2042-spring', payload, meta);
  await commitStage(bucket, spring.id);
  await action(bucket, state, 'prepared', { season: '2042-fall', stageId: fall.id });
  await action(bucket, state, 'prepared', { season: '2042-spring', stageId: spring.id });
  let stageReads = 0, reconcileError;
  bucket.onGet = async key => {
    if (key === `datasets/v2/staged/${fall.id}.json` && ++stageReads === 3) {
      state.job = await getImportJob(bucket, owner, state.job.id);
      reconcileError = await action(bucket, state, 'reconcile', { season: '2042-spring' }).catch(error => error);
    }
  };
  await action(bucket, state, 'publish', { season: '2042-fall' });
  assert.equal(reconcileError.code, 'publishing');
  assert.equal(state.job.seasons.find(item => item.season === '2042-fall').status, 'committed');
});

test('concurrent terminal cleanup cannot erase a late failed deletion checkpoint', async () => {
  const bucket = new Bucket(), state = await create(bucket), entered = deferred(), resume = deferred();
  bucket.onPut = async key => { if (key.includes('/sources/')) { entered.resolve(); await resume.promise; } };
  const pending = putImportChunk(bucket, owner, state.job.id, 0, 0, state.bytes, state.hash, state.job.revision, state.token);
  const observed = pending.catch(error => error);
  await entered.promise;
  let injected = false;
  bucket.onList = async prefix => {
    if (!injected && prefix.includes('/sources/')) {
      injected = true;
      bucket.failDelete = true;
      resume.resolve();
      assert.match((await observed).message, /injected delete failure/);
      bucket.failDelete = false;
    }
  };
  await action(bucket, state, 'cancel').catch(error => { assert.equal(error.code, 'conflict'); });
  assert.equal(sources(bucket).length, 1);
  assert.equal((await getImportJob(bucket, owner, state.job.id)).cleanupPending, true);
  assert.equal((await listImportJobs(bucket, owner)).jobs.length, 1);
  await action(bucket, state, 'cleanup');
  assert.equal(sources(bucket).length, 0);
});
