import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pack, verify, restore, safeRelative } from '../../tools/longevity/archive.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'tohto-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source'), archive = path.join(root, 'archive'), dest = path.join(root, 'restored');
  await mkdir(source); return { root, source, archive, dest };
}
async function reseal(archive, mutation) {
  const indexPath = path.join(archive, 'index.ndjson');
  const index = mutation(await readFile(indexPath, 'utf8'));
  await writeFile(indexPath, index);
  const m = JSON.parse(await readFile(path.join(archive, 'manifest.json'), 'utf8'));
  m.indexBytes = Buffer.byteLength(index); m.indexSha256 = hash(index);
  const text = JSON.stringify(m) + '\n';
  await writeFile(path.join(archive, 'manifest.json'), text);
  await writeFile(path.join(archive, 'manifest.sha256'), hash(text) + '\n');
}

test('exact round trip: Japanese names, BOM, CRLF, null bytes, empty directories/files', async t => {
  const { source, archive, dest } = await fixture(t);
  await mkdir(path.join(source, '2027-spring', '空'), { recursive: true });
  const data = Buffer.concat([Buffer.from('\uFEFF選手,値\r\n"東恩納,蒼",1.23000\r\n'), Buffer.from([0, 255, 128])]);
  await writeFile(path.join(source, '2027-spring', 'データ.csv'), data);
  await writeFile(path.join(source, 'empty.csv'), '');
  const meta = await pack(source, archive);
  assert.equal(meta.files, 2);
  assert.equal((await verify(archive, { expectedManifestHash: meta.manifestSha256 })).verified, true);
  await restore(archive, dest, { expectedManifestHash: meta.manifestSha256 });
  assert.deepEqual(await readFile(path.join(dest, '2027-spring', 'データ.csv')), data);
  assert.equal((await readFile(path.join(dest, 'empty.csv'))).length, 0);
  assert.equal((await lstat(path.join(dest, '2027-spring', '空'))).isDirectory(), true);
});

test('repeated blocks share objects without changing original files', async t => {
  const { source, archive, dest } = await fixture(t);
  const block = Buffer.alloc(1024, 65), data = Buffer.concat([block, block, block]);
  await writeFile(path.join(source, 'a'), data); await writeFile(path.join(source, 'b'), data);
  const m = await pack(source, archive, { chunkBytes: 1024 });
  assert.equal(m.objects, 1); assert.equal(m.contentBytes, 6144);
  await restore(archive, dest); assert.deepEqual(await readFile(path.join(dest, 'b')), data);
});

test('no year or pitch-count ceiling in byte archive; handles >25000 records', async t => {
  const { source, archive, dest } = await fixture(t);
  await mkdir(path.join(source, '2045-fall'));
  const data = 'PitchUID,Date\r\n' + Array.from({length: 30001}, (_, i) => `${i},2045-09-01\r\n`).join('');
  await writeFile(path.join(source, '2045-fall', 'pitches.csv'), data);
  await pack(source, archive); await restore(archive, dest);
  assert.equal(await readFile(path.join(dest, '2045-fall', 'pitches.csv'), 'utf8'), data);
});

test('empty data folder is a valid archive', async t => {
  const { source, archive, dest } = await fixture(t);
  assert.equal((await pack(source, archive)).files, 0);
  await restore(archive, dest); assert.deepEqual(await readdir(dest), []);
});

test('existing archive and restore destinations are never overwritten', async t => {
  const { source, archive, dest } = await fixture(t);
  await pack(source, archive); await mkdir(dest); await writeFile(path.join(dest, 'keep'), 'unchanged');
  await assert.rejects(pack(source, archive), /already exists/);
  await assert.rejects(restore(archive, dest), /already exists/);
  assert.equal(await readFile(path.join(dest, 'keep'), 'utf8'), 'unchanged');
});

test('archive inside source and restore inside archive are rejected', async t => {
  const { source, archive } = await fixture(t);
  await assert.rejects(pack(source, path.join(source, 'backup')), /outside source/);
  await pack(source, archive);
  await assert.rejects(restore(archive, path.join(archive, 'output')), /outside archive/);
});

test('source symlink and symlinked destination into source are rejected', async t => {
  const { root, source, archive } = await fixture(t);
  await writeFile(path.join(root, 'private'), 'secret');
  await symlink(path.join(root, 'private'), path.join(source, 'link'));
  await assert.rejects(pack(source, archive), /Links/);
  await rm(path.join(source, 'link'));
  const alias = path.join(root, 'alias'); await symlink(source, alias, 'dir');
  await assert.rejects(pack(source, path.join(alias, 'backup')), /outside source/);
});

test('object corruption stops verify and does not create restoration output', async t => {
  const { source, archive, dest } = await fixture(t);
  await writeFile(path.join(source, 'a'), 'some data'); await pack(source, archive);
  const [name] = await readdir(path.join(archive, 'objects'));
  const obj = path.join(archive, 'objects', name), bytes = await readFile(obj); bytes[10] ^= 1; await writeFile(obj, bytes);
  await assert.rejects(verify(archive), /checksum/);
  await assert.rejects(restore(archive, dest), /checksum/);
  await assert.rejects(lstat(dest), { code: 'ENOENT' });
});

test('missing object is detected', async t => {
  const { source, archive } = await fixture(t);
  await writeFile(path.join(source, 'a'), 'a'); await pack(source, archive);
  const [name] = await readdir(path.join(archive, 'objects')); await rm(path.join(archive, 'objects', name));
  await assert.rejects(verify(archive), { code: 'ENOENT' });
});

test('external trusted manifest hash detects rewritten archive metadata', async t => {
  const { source, archive } = await fixture(t); const m = await pack(source, archive);
  const file = path.join(archive, 'manifest.json'); const text = (await readFile(file, 'utf8')).replace('"version": 1', '"version": 2');
  await writeFile(file, text); await writeFile(path.join(archive, 'manifest.sha256'), hash(text));
  await assert.rejects(verify(archive, { expectedManifestHash: m.manifestSha256 }), /Manifest checksum/);
});

test('truncated or modified index fails verification', async t => {
  const { source, archive } = await fixture(t);
  await writeFile(path.join(source, 'a'), 'a'); await pack(source, archive);
  await writeFile(path.join(archive, 'index.ndjson'), '{}\n');
  await assert.rejects(verify(archive), /Index checksum/);
});

test('path traversal blocked even when internal hashes are recomputed', async t => {
  const { source, archive, dest } = await fixture(t);
  await writeFile(path.join(source, 'a'), 'a'); await pack(source, archive);
  await reseal(archive, text => text.replace('"path":"a"', '"path":"../escape"'));
  await assert.rejects(restore(archive, dest), /Unsafe archive path/);
});

test('duplicate file records are rejected', async t => {
  const { source, archive } = await fixture(t);
  await writeFile(path.join(source, 'a'), 'a'); await pack(source, archive);
  await reseal(archive, text => text + text);
  await assert.rejects(verify(archive), /Duplicate or unsorted/);
});

test('oversized decompression descriptor and index lines rejected', async t => {
  const { source, archive } = await fixture(t);
  await writeFile(path.join(source, 'a'), 'a'); await pack(source, archive);
  await reseal(archive, text => text.replace('"offset":0,"bytes":1', '"offset":0,"bytes":999999999'));
  await assert.rejects(verify(archive), /Invalid chunk/);
  await reseal(archive, () => JSON.stringify({ padding: 'x'.repeat(17000) }) + '\n');
  await assert.rejects(verify(archive), /line is too large/);
});

test('chunk size and path validation are strict', () => {
  for (const name of ['../a', '/etc/passwd', 'a\\b', 'a//b', 'CON', 'C:/a', 'a\0b', 'a.']) assert.throws(() => safeRelative(name));
  assert.equal(safeRelative('2055-spring/中央.csv'), '2055-spring/中央.csv');
});

test('parallel exports never replace one another', async t => {
  const { source, archive } = await fixture(t); await writeFile(path.join(source, 'a'), Buffer.alloc(16384));
  const results = await Promise.allSettled([pack(source, archive), pack(source, archive)]);
  assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal((await verify(archive)).verified, true);
});
