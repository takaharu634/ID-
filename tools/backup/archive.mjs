import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, lstat } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { BACKUP_TABLES } from '../../server/backup-service.mjs';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const safeKey = key => typeof key === 'string' && key.startsWith('datasets/') && key.length <= 1024 && !/[\x00-\x1f\\]/.test(key) && !key.split('/').some(part => ['', '.', '..'].includes(part));
const file = (root, sha) => { if (!digest(sha)) throw new Error('Invalid blob hash'); return join(root, 'objects', `${sha}.gz`); };
export async function unpackObject(root, object) {
  if (!safeKey(object.key) || !digest(object.sha256) || !digest(object.gzipSha256) || !Number.isSafeInteger(object.bytes) || object.bytes < 0 || object.bytes > 1024 * 1024 * 1024) throw new Error('Invalid backup object');
  const path = file(root, object.sha256), stat = await lstat(path);
  if (!stat.isFile() || stat.size !== object.gzipBytes) throw new Error('Backup compressed size mismatch');
  const packed = await readFile(path); if (hash(packed) !== object.gzipSha256) throw new Error('Backup compressed checksum mismatch');
  const bytes = gunzipSync(packed, { maxOutputLength: Math.max(1, object.bytes) });
  if (bytes.length !== object.bytes || hash(bytes) !== object.sha256) throw new Error('Backup content checksum mismatch');
  return bytes;
}
export async function readManifest(root) {
  const content = await readFile(join(root, 'manifest.json'));
  const expected = (await readFile(join(root, 'manifest.sha256'), 'utf8')).trim();
  if (!digest(expected) || hash(content) !== expected) throw new Error('Backup manifest checksum mismatch');
  const manifest = JSON.parse(content);
  if (manifest.format !== 'id-tohto-backup-v1' || !Array.isArray(manifest.objects) || !manifest.database || manifest.scope !== 'datasets/') throw new Error('Invalid backup format');
  const keys = new Set(); for (const obj of manifest.objects) { if (!safeKey(obj.key) || keys.has(obj.key)) throw new Error('Duplicate/unsafe object key'); keys.add(obj.key); }
  for (const [name, columns] of Object.entries(BACKUP_TABLES)) {
    const table = manifest.database[name];
    if (!table || JSON.stringify(table.columns) !== JSON.stringify(columns) || !Array.isArray(table.rows)) throw new Error('Invalid database backup');
    const ids = new Set(); for (const row of table.rows) {
      if (!row || typeof row.id !== 'string' || ids.has(row.id) || Object.keys(row).some(key => !columns.includes(key))) throw new Error('Invalid database row');
      for (const column of columns) if (!(column in row) || !['string','number'].includes(typeof row[column]) && row[column] !== null || typeof row[column] === 'number' && !Number.isSafeInteger(row[column])) throw new Error('Invalid database value');
      ids.add(row.id);
    }
  }
  if (Object.keys(manifest.database).some(name => !Object.hasOwn(BACKUP_TABLES, name))) throw new Error('Unexpected database table');
  return manifest;
}
export async function verifyArchive(root) {
  const manifest = await readManifest(root), byKey = new Map(manifest.objects.map(o => [o.key, o]));
  let bytes = 0, packed = 0; const packedHashes=new Set();
  for (const obj of manifest.objects) {
    const raw = await unpackObject(root, obj); bytes += raw.length; if(!packedHashes.has(obj.sha256)){packed+=obj.gzipBytes;packedHashes.add(obj.sha256);}
    // Verify every durable reference in active/archived heads and chunk manifests.
    if (/\/(?:head\.json|heads\/[^/]+\.json|history\/[^/]+\.json|versions\/[^/]+\.json)$/.test(obj.key) || obj.key.endsWith('.manifest.json')) {
      const value = JSON.parse(raw);
      const refs = obj.key.endsWith('.manifest.json') ? value.parts : (value.versions || (value.objects ? [value] : [])).flatMap(v => Object.values(v.objects || {}));
      if (!Array.isArray(refs)) throw new Error('Invalid archived references');
      for (const ref of refs) { const target = byKey.get(ref.key); if (!target || target.sha256 !== ref.sha256) throw new Error(`Missing/corrupt referenced object: ${ref.key}`); }
      if (value.active && !(value.versions || []).some(v => v.id === value.active)) throw new Error('Active backup descriptor missing');
    }
  }
  return { manifest, stats: { objects: manifest.objects.length, bytes, gzipBytes: packed, databaseRows: Object.values(manifest.database).reduce((n,t) => n + t.rows.length, 0) } };
}
async function inventory(api) {
  let cursor = null; const objects = [], seen = new Set(), pages = new Set();
  do {
    const result = await api({ mode: 'inventory', ...(cursor ? { cursor } : {}) });
    if (!Array.isArray(result.objects)) throw new Error('Missing inventory');
    for (const object of result.objects) { if (!safeKey(object.key) || seen.has(object.key) || !object.etag || !Number.isSafeInteger(object.bytes) || object.bytes < 0) throw new Error('Invalid inventory'); seen.add(object.key); objects.push(object); }
    cursor = result.cursor; if (cursor) { if (pages.has(cursor)) throw new Error('Inventory pagination loop'); pages.add(cursor); }
  } while (cursor);
  return objects.sort((a,b) => a.key.localeCompare(b.key));
}
export async function createArchive({ root, previousRoot, api, source = {} }) {
  await mkdir(join(root, 'objects'), { recursive: true });
  let previous = new Map();
  if (previousRoot) { try { previous = new Map((await readManifest(previousRoot)).objects.map(o => [o.key,o])); } catch { /* An unavailable previous artifact cannot prevent a new full backup. */ } }
  const start = await inventory(api), objects = []; let reused = 0;
  for (const entry of start) {
    const old = previous.get(entry.key); let object;
    if (old?.etag === entry.etag && old.bytes === entry.bytes) {
      try { await unpackObject(previousRoot, old); await copyFile(file(previousRoot, old.sha256), file(root, old.sha256)); object = { ...old, ...entry }; reused++; } catch { /* Re-fetch corrupt/missing reusable bytes. */ }
    }
    if (!object) {
      const raw = Buffer.from(await api({ mode:'object', key:entry.key, etag:entry.etag }, true));
      if (raw.length !== entry.bytes) throw new Error(`Incomplete object: ${entry.key}`);
      const compressed = gzipSync(raw, { level: 6 }), sha = hash(raw);
      await writeFile(file(root, sha), compressed);
      object = { ...entry, sha256:sha, gzipSha256:hash(compressed), gzipBytes:compressed.length };
    }
    objects.push(object);
  }
  const database = {};
  for (const [table, columns] of Object.entries(BACKUP_TABLES)) {
    const rows = []; let after = '', prior;
    do { const page = await api({ mode:'database', table, ...(after ? { after } : {}) });
      if (JSON.stringify(page.columns) !== JSON.stringify(columns) || !Array.isArray(page.rows)) throw new Error('Database columns changed');
      rows.push(...page.rows); prior = after; after = page.after;
      if (after && (typeof after !== 'string' || after <= prior)) throw new Error('Database pagination did not advance');
    } while (after);
    database[table] = { columns, rows };
  }
  const end = await inventory(api);
  // Mutable heads and immutable additions must remain stable across the capture.
  const identity = rows => JSON.stringify(rows.map(({key,etag,bytes}) => ({key,etag,bytes})));
  if (identity(start) !== identity(end)) throw new Error('Storage changed during backup; retry after import finishes');
  const currentKeys=new Set(objects.map(o=>o.key));
  const manifest = { format:'id-tohto-backup-v1', scope:'datasets/', createdAt:new Date().toISOString(), atomicAcrossDatabase:false,
    source, objects, database, removedObjects:[...previous.keys()].filter(key=>!currentKeys.has(key)).length, excluded:['import-jobs/','trackman_push_state','trackman_push_channels','environment secrets'], reusedObjects:reused };
  const content = JSON.stringify(manifest, null, 2);
  await writeFile(join(root,'manifest.json'), content); await writeFile(join(root,'manifest.sha256'), `${hash(content)}\n`);
  return verifyArchive(root);
}
const literal = value => value === null ? 'NULL' : typeof value === 'number' ? String(value) : `CAST(X'${Buffer.from(value,'utf8').toString('hex')}' AS TEXT)`;
export function recoverySql(manifest) {
  const lines = ['-- Review before execution. Missing rows only. Existing rows are never changed.', '-- data_imports.is_active is forced to 0. Activate a verified snapshot in the admin UI.', 'BEGIN TRANSACTION;'];
  for (const [table, columns] of Object.entries(BACKUP_TABLES)) for (const row of manifest.database[table].rows) {
    const values = columns.map(column => literal(column === 'is_active' ? 0 : row[column]));
    lines.push(`INSERT OR IGNORE INTO ${table} (${columns.join(',')}) VALUES (${values.join(',')});`);
  }
  lines.push('COMMIT;'); return `${lines.join('\n')}\n`;
}
