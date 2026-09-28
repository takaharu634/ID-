import test from 'node:test';
import assert from 'node:assert/strict';
import { importAction, publishPrepared, notifyDatasetUpdated } from '../lib/import-actions.ts';
const item = (season: string, warning = false) => ({ id: season, season, report: { warnings: warning ? ['確認'] : [] } });

test('warning-only future season stays pending without requesting an unpublished dataset', async () => {
  const future = item('2035-spring', true);
  const requests: string[] = [];
  const result = await publishPrepared([future], async value => { requests.push(value.id); }, () => {});
  assert.deepEqual(result.pending, [future]);
  assert.deepEqual(result.committed, []);
  assert.deepEqual(requests, []);
});

test('mixed-season failure retains warnings and failed/unattempted imports while preserving confirmed commits', async () => {
  const values = [item('2035-spring', true), item('2026-fall'), item('2036-spring'), item('2036-fall')];
  const snapshots: string[][] = [], requests: string[] = [];
  const result = await publishPrepared(values, async value => {
    requests.push(value.id);
    if (value.season === '2036-spring') throw new Error('network');
  }, pending => snapshots.push(pending.map(x => x.season)));
  assert.deepEqual(requests, ['2026-fall', '2036-spring']);
  assert.deepEqual(result.committed.map(x => x.season), ['2026-fall']);
  assert.deepEqual(result.pending.map(x => x.season), ['2035-spring', '2036-spring', '2036-fall']);
  assert.deepEqual(snapshots.at(-1), result.pending.map(x => x.season));
  assert.equal(result.error, 'network');
});

test('verification continues across batches and stops when the server repeatedly makes no progress', async () => {
  let calls = 0;
  const fetcher = (async () => ++calls < 3 ? Response.json({ verifying: true, checked: calls * 80, total: 200 }, { status: 202 }) : Response.json({ ok: true })) as typeof fetch;
  assert.equal((await importAction({ action: 'commit' }, fetcher)).ok, true);
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(importAction({}, (async () => { calls++; return Response.json({ verifying: true, checked: 0, total: 10 }, { status: 202 }); }) as typeof fetch), /照合が進みません/);
  assert.equal(calls, 4);
});

test('missing cross-tab messaging support does not turn a saved import into a failure', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'BroadcastChannel');
  Object.defineProperty(globalThis, 'BroadcastChannel', { value: undefined, configurable: true });
  try { assert.doesNotThrow(notifyDatasetUpdated); }
  finally { if (descriptor) Object.defineProperty(globalThis, 'BroadcastChannel', descriptor); else Reflect.deleteProperty(globalThis, 'BroadcastChannel'); }
});
