import { isSeasonKey } from '../lib/seasons.mjs';
import { openObject } from './object-store.mjs';
import { readSources } from './drive-settings.mjs';
import { readHead, stageStoredSnapshot, commitStage, advanceStageVerification, sha256 } from './import-store.mjs';

export const PUSH_SEASON = '2026-fall';
export const PUSH_FOLDER = '1eQhb4GYv3zlP-74BAK3g8xzkO3htUCr6';
const noStore = { 'cache-control': 'no-store' };
const uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value);
const scriptUrl = value => typeof value === 'string' && /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(value);
export async function hmac(secret, message) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
function constantEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0; for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
export async function verifySigned(request, secret, hash, path = '') {
  if (!secret || secret.length < 48) return false;
  const time = request.headers.get('x-trackman-time'), signature = request.headers.get('x-trackman-signature');
  if (!/^\d{13}$/.test(time || '') || Math.abs(Date.now() - Number(time)) > 300000 || !/^[a-f0-9]{64}$/.test(signature || '')) return false;
  return constantEqual(signature, await hmac(secret, `${time}\n${path ? path + '\n' : ''}${hash}`));
}
export function pushStore(db) {
  const run = (sql, ...values) => db.prepare(sql).bind(...values).run();
  return {
    state: () => db.prepare('SELECT * FROM trackman_push_state WHERE id = ?').bind(PUSH_SEASON).first(),
    channel: id => db.prepare('SELECT * FROM trackman_push_channels WHERE id = ?').bind(id).first(),
    channels: async () => (await db.prepare('SELECT id, expires_at FROM trackman_push_channels WHERE expires_at > ? AND resource_id IS NOT NULL').bind(Date.now()).all()).results,
    async files(ids) {
      if(!ids)return (await db.prepare('SELECT id, name, fingerprint FROM trackman_push_files').all()).results;
      const rows=[];for(let i=0;i<ids.length;i+=80){const group=ids.slice(i,i+80);rows.push(...(await db.prepare('SELECT id,name,fingerprint FROM trackman_push_files WHERE id IN ('+group.map(()=>'?').join(',')+')').bind(...group).all()).results);}return rows;
    },
    async connect(url, baselineFiles) {
      await db.batch([
        db.prepare('INSERT INTO trackman_push_state (id, enabled, script_url) VALUES (?, 1, ?) ON CONFLICT(id) DO UPDATE SET enabled = 1, script_url = excluded.script_url, last_error = NULL').bind(PUSH_SEASON, url),
        ...baselineFiles.map(f => db.prepare('INSERT OR IGNORE INTO trackman_push_files (id, name, completed_at, fingerprint) VALUES (?, ?, ?, ?)').bind(f.id, f.name, Date.now(), f.modifiedTime && f.size ? `${f.modifiedTime}|${f.size}` : null))
      ]);
    },
    register: (id, tokenHash, expiration) => run('INSERT INTO trackman_push_channels (id, token_hash, expires_at) VALUES (?, ?, ?)', id, tokenHash, expiration),
    registered: (id, resourceId, expiration) => run('UPDATE trackman_push_channels SET resource_id = ?, expires_at = ? WHERE id = ?', resourceId, expiration, id),
    pause: () => run('UPDATE trackman_push_state SET enabled = 0 WHERE id = ?', PUSH_SEASON),
    event: () => run('UPDATE trackman_push_state SET last_event_at = ? WHERE id = ?', Date.now(), PUSH_SEASON),
    error: message => run('UPDATE trackman_push_state SET last_error = ? WHERE id = ?', message.slice(0, 1000), PUSH_SEASON),
    acknowledge: (id, message) => run('UPDATE trackman_push_channels SET last_message = ? WHERE id = ?', message, id),
    async completed(files, result) {
      await db.batch([
        ...files.map(f => db.prepare('INSERT INTO trackman_push_files (id, name, completed_at, fingerprint) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,completed_at=excluded.completed_at,fingerprint=excluded.fingerprint').bind(f.id, f.name, Date.now(), `${f.modifiedTime}|${f.size}`)),
        db.prepare('UPDATE trackman_push_state SET last_success_at = ?, last_error = NULL, last_result = ? WHERE id = ?').bind(Date.now(), JSON.stringify(result), PUSH_SEASON)
      ]);
    }
  };
}
export function validateFiles(files) {
  if (!Array.isArray(files) || !files.length || files.length > 1000) throw new Error('完全なCSV一覧を取得できません。');
  const seen = new Set();
  return files.map(f => {
    if (!f || !/^[A-Za-z0-9_-]{5,200}$/.test(f.id) || seen.has(f.id) || typeof f.name !== 'string' || !/\.csv$/i.test(f.name) || f.name.length > 250 || !Number.isSafeInteger(f.size) || f.size <= 0 || f.size > 30 * 1024 * 1024 || !Number.isFinite(Date.parse(f.modifiedTime))) throw new Error('CSV一覧のID・名前・サイズ・更新日時を確認できません。');
    seen.add(f.id); return { id: f.id, name: f.name, size: f.size, modifiedTime: f.modifiedTime };
  });
}
async function baselineAt(bucket, expected, loadBundled, kind, season, reference) {
  const head = await readHead(bucket, season);
  if (head.etag !== expected) throw new Error('取り込み中に別の更新が入りました。再実行してください。');
  if (!head.active) return {value:await loadBundled(kind,season)};
  const version = head.versions.find(v => v.id === head.active), ref = version?.objects[kind];
  if(reference && ref) return {ref};
  const obj = ref && await openObject(bucket,ref);
  if (!obj) throw new Error('既存の保存データを取得できません。');
  return {value:await obj.text()};
}
function validateSnapshot(body, season) {
  const v = body.snapshot;
  if (!v || !uuid(v.id) || v.season !== season || !Number.isSafeInteger(v.pitchCount) || v.pitchCount <= 0 || !Number.isSafeInteger(v.gameCount) || v.gameCount <= 0 || !v.report || !Array.isArray(v.report.warnings) || v.report.warnings.length || v.report.totalRows !== v.pitchCount || !(v.report.addedRows > 0) || v.report.previousRows + v.report.addedRows !== v.pitchCount) throw new Error('集計結果または検証結果が不正です。');
  for (const kind of ['raw', 'summary', 'spin', 'input', 'report']) {
    const ref = v.objects?.[kind], extension = (['raw', 'input'].includes(kind) ? 'csv' : 'json') + (v.objects?.[kind]?.format==='tohto-chunks-v1'?'.manifest.json':'');
    if (ref?.key !== `datasets/v2/${season}/versions/${v.id}/${kind}.${extension}` || !/^[a-f0-9]{64}$/.test(ref?.sha256 || '')) throw new Error('保存データの参照が不正です。');
  }
  return { id: v.id, season, createdAt: new Date().toISOString(), fileName: 'Driveからの追加', pitchCount: v.pitchCount, gameCount: v.gameCount, report: v.report, objects: v.objects, origin: 'drive-push' };
}
export async function handleBridge(request, { bucket, store, secret, engineVersion, baselineFiles, loadBundled }) {
  if (!secret) return Response.json({ error: 'Google連携は未設定です。' }, { status: 503, headers: noStore });
  const text = await request.text();
  if (text.length > 100000) return Response.json({ error: '要求サイズが大きすぎます。' }, { status: 413, headers: noStore });
  if (!await verifySigned(request, secret, await sha256(text))) return Response.json({ error: '接続の認証に失敗しました。' }, { status: 401, headers: noStore });
  try {
    const body = JSON.parse(text);
    const season=body.season || body.snapshot?.season || PUSH_SEASON;
    if(!isSeasonKey(season)) throw new Error('シーズンが不正です。');
    if (body.engineVersion !== engineVersion) throw new Error('取り込み処理の新版があります。管理画面から最新の連携スクリプトを設定してください。');
    let state = await store.state();
    if (body.action === 'connect') {
      if (!scriptUrl(body.scriptUrl)) throw new Error('Google Apps Scriptの公開URLが不正です。');
      await store.connect(body.scriptUrl, baselineFiles); return Response.json({ ok: true }, { headers: noStore });
    }
    if (body.action === 'configuration') return Response.json({ enabled: Boolean(state?.enabled), sources:await readSources(bucket) }, { headers: noStore });
    if (!state?.enabled) throw new Error('自動反映は停止中です。');
    if (body.action === 'register') {
      if (!uuid(body.id) || typeof body.token !== 'string' || body.token.length < 48 || body.token.length > 256 || !Number.isSafeInteger(body.expiration) || body.expiration <= Date.now() || body.expiration > Date.now() + 604800000) throw new Error('通知登録が不正です。');
      await store.register(body.id, await sha256(body.token), body.expiration);
      return Response.json({ ok: true }, { headers: noStore });
    }
    if (body.action === 'registered') {
      const channel = await store.channel(body.id);
      if (!channel || typeof body.resourceId !== 'string' || !body.resourceId || body.resourceId.length > 300 || !Number.isSafeInteger(body.expiration) || body.expiration > Date.now() + 604800000 || body.expiration <= Date.now()) throw new Error('Googleの通知登録結果が不正です。');
      await store.registered(body.id, body.resourceId, body.expiration); return Response.json({ ok: true }, { headers: noStore });
    }
    if (body.action === 'plan') {
      const files = validateFiles(body.files), known = await store.files(body.incremental?files.map(f=>f.id):undefined);
      if (!body.incremental && known.some(k => !files.some(f => f.id === k.id))) throw new Error('以前のCSVがフォルダ一覧にありません。既存データを維持し、自動反映を保留しました。');
      const head = await readHead(bucket, season);
      return Response.json({ enabled: true, files: files.filter(f => !known.some(k => k.id === f.id && k.fingerprint === `${f.modifiedTime}|${f.size}`)), baseEtag: head.etag, active:head.active, season }, { headers: noStore });
    }
    if (body.action === 'baseline') {
      if (!['raw', 'summary', 'spin'].includes(body.kind)) throw new Error('取得するデータの種類が不正です。');
      return Response.json(await baselineAt(bucket, body.baseEtag, loadBundled, body.kind,season,body.reference===true), { headers: noStore });
    }
    if (body.action === 'publish') {
      const files = validateFiles(body.files), head = await readHead(bucket, season);
      if(head.active===body.snapshot?.id) {const current=head.versions.find(v=>v.id===head.active);const result={addedRows:current.report.addedRows,pitches:current.pitchCount,games:current.gameCount,id:current.id};await store.completed(files,result);return Response.json(result,{headers:noStore});}
      if (head.etag !== body.baseEtag) throw new Error('別の更新が入りました。再実行してください。');
      let result;
      if (body.unchanged === true) {
        if (body.report?.addedRows !== 0 || body.report?.warnings?.length) throw new Error('重複確認の結果が不正です。');
        result = { unchanged: true, addedRows: 0 };
      } else {
        const v = validateSnapshot(body,season);
        const previous=body.previousSnapshot;
        const existingCount=head.active ? head.versions.find(x=>x.id===head.active)?.pitchCount : previous?.pitchCount || 0;
        if(existingCount!==v.report.previousRows)throw new Error('更新前の件数が一致しません。');
        if(previous && (head.active || !uuid(previous.id) || previous.season!==season || !Number.isSafeInteger(previous.pitchCount) || previous.pitchCount<=0 || !Array.isArray(previous.report?.warnings) || previous.report.warnings.length))throw new Error('更新前のバックアップが不正です。');
        await stageStoredSnapshot(bucket, v, body.baseEtag, null,{deferVerification:true,previousSnapshot:previous});
        const proof=await advanceStageVerification(bucket,v.id);
        if(!proof.complete)return Response.json({verifying:true,checked:proof.offset,total:proof.total},{headers:noStore});
        // A pause while calculation was running must also stop publication.
        state = await store.state(); if (!state?.enabled) throw new Error('自動反映は停止中です。');
        await commitStage(bucket, v.id, false);
        result = { addedRows: v.report.addedRows, pitches: v.pitchCount, games: v.gameCount, id: v.id };
      }
      await store.completed(files, result); return Response.json(result, { headers: noStore });
    }
    if (body.action === 'failure') { await store.error(String(body.message || '取り込みが中断しました。')); return Response.json({ ok: true }, { headers: noStore }); }
    throw new Error('操作が不正です。');
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : '反映を保留しました。' }, { status: 400, headers: noStore }); }
}
export async function handlePushStorage(request, { bucket, store, secret }) {
  const key = new URL(request.url).searchParams.get('key') || '', hash = request.headers.get('x-content-sha256'), size = Number(request.headers.get('x-content-bytes'));
  if (!/^datasets\/(?:v2\/[1-9]\d{3}-(?:spring|fall)\/versions\/[a-f0-9-]{36}\/(?:raw\.csv|input\.csv|summary\.json|spin\.json|report\.json)(?:\.manifest\.json)?|v3\/[1-9]\d{3}-(?:spring|fall)\/blocks\/[a-f0-9]{64}\.gz\.b64)$/.test(key) || !/^[a-f0-9]{64}$/.test(hash || '') || (request.method!=='GET' && (!Number.isSafeInteger(size) || size <= 0 || size > 48 * 1024 * 1024))) return Response.json({ error: '保存内容が不正です。' }, { status: 400, headers: noStore });
  if (!await verifySigned(request, secret, hash, key)) return Response.json({ error: '接続の認証に失敗しました。' }, { status: 401, headers: noStore });
  if (!(await store.state())?.enabled) return Response.json({ error: '自動反映は停止中です。' }, { status: 409, headers: noStore });
  try {
    if(request.method==='GET') {const object=await bucket.get(key);return object?new Response(object.body,{headers:noStore}):new Response(null,{status:404,headers:noStore});}
    const old = await bucket.head(key);
    if (old) { const expected = old.checksums?.sha256; const actual = expected && [...new Uint8Array(expected)].map(b => b.toString(16).padStart(2, '0')).join(''); if (actual !== hash) throw new Error('同名の保存データが既にあります。'); return Response.json({ key, sha256: hash }, { headers: noStore }); }
    if (!request.body) throw new Error('データが空です。');
    const stream = new FixedLengthStream(size), controller = new AbortController();
    const transfer = request.body.pipeTo(stream.writable, { signal: controller.signal }); transfer.catch(() => {});
    try {
      const saved = await bucket.put(key, stream.readable, { sha256: hash, onlyIf: new Headers({ 'If-None-Match': '*' }), httpMetadata: { contentType: key.endsWith('.csv') ? 'text/csv; charset=utf-8' : 'application/json' } });
      if (!saved) throw new Error('同時に保存が行われました。再実行してください。');
      await transfer;
    } catch (e) { controller.abort(); await transfer.catch(() => {}); throw e; }
    return Response.json({ key, sha256: hash }, { headers: noStore });
  } catch (e) { console.error('[trackman storage]', e instanceof Error ? e.message : 'Storage error'); return Response.json({ error: '保存データのサイズ・ハッシュを照合できません。公開データは維持しています。' }, { status: 409, headers: noStore }); }
}
export async function invokeScript(state, secret, channelId, fetcher = fetch) {
  if (!state?.enabled || !scriptUrl(state.script_url)) throw new Error('Google連携が未設定、または停止中です。');
  const time = String(Date.now()), body = { time, channelId, signature: await hmac(secret, `notify\n${time}\n${channelId}`) };
  const r = await fetcher(state.script_url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(25000), redirect: 'follow' });
  if (!r.ok) throw new Error('Google側の処理を起動できません。');
  const value = await r.json(); if (!value.ok) throw new Error(String(value.error || 'Google側の処理を再試行します。'));
  return value;
}
export async function handleNotification(request, { store, secret, fetcher = fetch }) {
  if (!secret) return new Response(null, { status: 503 });
  const id = request.headers.get('x-goog-channel-id'), token = request.headers.get('x-goog-channel-token'), resource = request.headers.get('x-goog-resource-id'), message = request.headers.get('x-goog-message-number'), event = request.headers.get('x-goog-resource-state');
  if (!uuid(id) || !token || token.length > 256 || !/^\d{1,30}$/.test(message || '')) return new Response(null, { status: 401 });
  const channel = await store.channel(id);
  if (!channel || channel.expires_at <= Date.now() || !await constantEqual(channel.token_hash, await sha256(token)) || channel.resource_id && channel.resource_id !== resource) return new Response(null, { status: 401 });
  if (event === 'sync') return new Response(null, { status: 204 });
  const state = await store.state();
  if (!state?.enabled || channel.last_message === message || !['add', 'update', 'change'].includes(event)) return new Response(null, { status: 204 });
  await store.event();
  try { await invokeScript(state, secret, id, fetcher); await store.acknowledge(id, message); return new Response(null, { status: 204 }); }
  catch (e) { await store.error(e instanceof Error ? e.message : 'Google側の処理が中断しました。'); return new Response(null, { status: 503 }); }
}
