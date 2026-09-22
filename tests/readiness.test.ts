import assert from 'node:assert/strict';
import test from 'node:test';
import { waitForReady } from '../lib/readiness.ts';

test('print readiness resolves, times out, rejects and cancels without hanging', async () => {
  const signal = new AbortController().signal;
  assert.equal(await waitForReady(Promise.resolve('ready'), signal, 50), 'ready');
  await assert.rejects(waitForReady(Promise.reject(new Error('image failed')), signal, 50), /image failed/);
  await assert.rejects(waitForReady(new Promise(() => {}), signal, 5), /時間がかかって/);
  const cancel = new AbortController();
  const pending = waitForReady(new Promise(() => {}), cancel.signal, 5000);
  cancel.abort();
  await assert.rejects(pending, /中止/);
  await assert.rejects(waitForReady(Promise.resolve('late'), cancel.signal), /中止/);
});
