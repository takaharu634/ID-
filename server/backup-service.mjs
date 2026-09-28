import { backupExportGuard } from './backup-auth.mjs';
import { sha256 } from './object-store.mjs';
export const BACKUP_TABLES = Object.freeze({
  data_imports: ['id','file_name','uploaded_at','uploaded_by','raw_object_key','summary_object_key','pitch_count','game_count','team_count','is_active'],
  trackman_push_files: ['id','name','completed_at','fingerprint'],
});
const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const json = (value, status = 200) => Response.json(value, { status, headers });
const validKey = key => typeof key === 'string' && key.startsWith('datasets/') && key.length <= 1024 && !/[\x00-\x1f\\]/.test(key) && !key.split('/').some(part => ['.', '..', ''].includes(part));
const uuid = '[a-f0-9-]{36}', season = '[1-9]\\d{3}-(?:spring|fall)';
const immutablePatterns = [
  new RegExp(`^datasets/v2/${season}/versions/${uuid}/(?:raw\\.csv|input\\.csv|summary\\.json|spin\\.json|report\\.json|sources\\.json)(?:\\.manifest\\.json)?$`),
  new RegExp(`^datasets/v3/${season}/blocks/[a-f0-9]{64}\\.gz\\.b64$`),
  new RegExp(`^datasets/v3/${season}/(?:heads/[a-f0-9]{64}|versions/${uuid}|history/\\d{13}-${uuid})\\.json$`),
];
export const restorableKey = key => validKey(key) && immutablePatterns.some(pattern => pattern.test(key));
export async function backupExportResponse(request, env, guard = backupExportGuard) {
  const denied = await guard(request, env); if (denied) return denied;
  if (request.method !== 'GET') return json({ error: 'Read-only endpoint' }, 405);
  if (!env.BUCKET || !env.DB) return json({ error: 'Backup storage unavailable' }, 503);
  const params = new URL(request.url).searchParams, mode = params.get('mode') || 'inventory';
  try {
    if (mode === 'inventory') {
      const cursor = params.get('cursor'); if (cursor !== null && (!cursor || cursor.length > 8192)) return json({ error: 'Invalid cursor' }, 400);
      const page = await env.BUCKET.list({ prefix: 'datasets/', limit: 500, ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(page.objects) || typeof page.truncated !== 'boolean' || (page.truncated && (!page.cursor || page.cursor === cursor))) throw new Error('Inventory incomplete');
      const objects = page.objects.map(o => {
        if (!validKey(o.key) || !Number.isSafeInteger(o.size) || o.size < 0 || !o.etag) throw new Error('Invalid inventory entry');
        return { key: o.key, bytes: o.size, etag: o.etag, uploaded: o.uploaded?.toISOString?.() || null };
      });
      return json({ objects, cursor: page.truncated ? page.cursor : null, scope: 'datasets/', atomic: false });
    }
    if (mode === 'usage') {
      const prefix = params.get('scope'), cursor = params.get('cursor');
      if (!['datasets/','import-jobs/'].includes(prefix) || cursor !== null && (!cursor || cursor.length > 8192)) return json({error:'Invalid usage scope'},400);
      const page = await env.BUCKET.list({prefix,limit:500,...(cursor?{cursor}:{})});
      if (!Array.isArray(page.objects) || typeof page.truncated !== 'boolean' || page.truncated && (!page.cursor || page.cursor===cursor)) throw new Error('Usage incomplete');
      let bytes=0; for (const object of page.objects) { if (!object.key.startsWith(prefix) || !Number.isSafeInteger(object.size) || object.size<0) throw new Error('Invalid usage'); bytes+=object.size; }
      return json({scope:prefix,bytes,objects:page.objects.length,cursor:page.truncated?page.cursor:null});
    }
    if (mode === 'object') {
      const key = params.get('key'), etag = params.get('etag');
      if (!validKey(key) || !etag || etag.length > 256) return json({ error: 'Invalid object reference' }, 400);
      const object = await env.BUCKET.get(key, { onlyIf: { etagMatches: etag } });
      if (!object) return json({ error: 'Backup object disappeared' }, 409);
      if (!object.body || object.etag !== etag) return json({ error: 'Backup object changed; restart inventory' }, 412);
      return new Response(object.body, { headers: { ...headers, 'content-type': 'application/octet-stream', 'content-length': String(object.size), 'etag': object.etag } });
    }
    if (mode === 'database') {
      const table = params.get('table'), columns = BACKUP_TABLES[table], after = params.get('after') || '';
      if (!Object.hasOwn(BACKUP_TABLES, table || '') || !columns || after.length > 1024) return json({ error: 'Table is not exportable' }, 400);
      const result = await env.DB.prepare(`SELECT ${columns.join(',')} FROM ${table} WHERE id > ? ORDER BY id LIMIT 500`).bind(after).all();
      if (!Array.isArray(result.results)) throw new Error('Database read failed');
      const rows = result.results.map(row => Object.fromEntries(columns.map(column => [column, row[column] ?? null])));
      return json({ table, columns, rows, after: rows.length === 500 ? rows.at(-1).id : null, atomic: false });
    }
    return json({ error: 'Unknown export mode' }, 400);
  } catch { return json({ error: 'バックアップの読み取りに失敗しました。再実行してください。' }, 503); }
}
/** Recovery adds missing immutable bytes. Heads/stages/verification/config cannot be uploaded here. */
export async function backupRestoreResponse(request, env, adminGuard) {
  const denied = adminGuard(request, env.ADMIN_EMAILS); if (denied) return denied;
  if (request.method !== 'PUT') return json({ error: 'PUT required' }, 405);
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'Cross-origin request denied' }, 403);
  if (!env.BUCKET) return json({ error: 'Storage unavailable' }, 503);
  const key = new URL(request.url).searchParams.get('key'), hash = request.headers.get('x-content-sha256') || '';
  const length = Number(request.headers.get('x-content-bytes'));
  if (!restorableKey(key) || !/^[a-f0-9]{64}$/.test(hash)) return json({ error: 'Invalid immutable restore reference' }, 400);
  if (!Number.isSafeInteger(length) || length < 1 || length > 45 * 1024 * 1024 || !request.body) return json({ error: 'Invalid restore size' }, 413);
  try {
    const matching = async object => {
      if (!object || object.size!==length) return false;
      if (object.checksums?.sha256) return [...new Uint8Array(object.checksums.sha256)].map(x=>x.toString(16).padStart(2,'0')).join('')===hash;
      return await sha256(await object.arrayBuffer())===hash;
    };
    const old = await env.BUCKET.get(key);
    if (old) return await matching(old) ? json({ ok: true, existing: true }) : json({ error: 'Existing data differs; nothing overwritten' }, 409);
    // The platform stream enforces Content-Length while R2 verifies SHA-256;
    // no whole CSV buffer is allocated in the Worker.
    const stream = new globalThis.FixedLengthStream(length), controller = new AbortController();
    const transfer = request.body.pipeTo(stream.writable,{signal:controller.signal}); transfer.catch(()=>{});
    let saved;
    try {
      saved = await env.BUCKET.put(key, stream.readable, { sha256:hash,onlyIf:new Headers({'If-None-Match':'*'}),httpMetadata:{contentType:key.endsWith('.csv')?'text/csv; charset=utf-8':'application/json'} });
      if (!saved) { controller.abort(); await transfer.catch(()=>{}); const current=await env.BUCKET.get(key); return await matching(current)?json({ok:true,existing:true}):json({error:'Concurrent restore conflict'},409); }
      await transfer;
    } catch(error) { controller.abort(); await transfer.catch(()=>{}); throw error; }
    if (!await matching(await env.BUCKET.get(key))) throw new Error('Read-back mismatch');
    return json({ ok: true, activeHeadChanged: false });
  } catch { return json({ error: '復旧の照合に失敗しました。公開データは切り替えていません。' }, 503); }
}
