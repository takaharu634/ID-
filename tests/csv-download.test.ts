import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { adminApiGuard } from '../app/admin-auth.ts';
import { bundledCsvResponse } from '../server/csv-download.ts';

test('original CSV download preserves every byte and requires an allowed administrator', async () => {
  assert.equal(adminApiGuard(new Request('https://example.test/api/dataset?format=csv'), 'admin@example.test')?.status, 401);
  assert.equal(adminApiGuard(new Request('https://example.test/api/dataset?format=csv', { headers: { 'oai-authenticated-user-email': 'other@example.test' } }), 'admin@example.test')?.status, 403);
  assert.equal(adminApiGuard(new Request('https://example.test/api/dataset?format=csv', { headers: { 'oai-authenticated-user-email': 'admin@example.test' } }), 'admin@example.test'), null);
  const bytes = await readFile(new URL('../data/raw/initial-data.csv', import.meta.url));
  const response = bundledCsvResponse(gzipSync(bytes).toString('base64'));
  assert.match(response.headers.get('cache-control')!, /no-store/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
});
