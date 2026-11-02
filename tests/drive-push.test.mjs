import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Miniflare, Headers as ProxyHeaders } from 'miniflare';
import { scriptTemplate, engineVersion } from '../server/generated/drive-push-script.mjs';
import { handleBridge, handleNotification, handlePushStorage, hmac, pushStore } from '../server/trackman-push.mjs';
import { activeObject, readHead, restoreSnapshot, sha256 } from '../server/import-store.mjs';
import { csvRows, encodeCsv } from '../lib/import-validation.mjs';
import { buildPayload, combineInputs } from '../integrations/trackman-drive/engine-entry.mjs';

const secret = 'test-only-not-a-deployed-key-'.repeat(3), origin = 'https://id.example.test';
// Node proxy adapter only. The compiled-runtime test exercises Workers' native stream.
globalThis.FixedLengthStream = class extends TransformStream {
  constructor(size) { let count = 0; super({ transform(chunk, controller) { count += chunk.byteLength; if (count > size) throw new Error('size'); controller.enqueue(chunk); }, flush() { if (count !== size) throw new Error('size'); } }); }
};
const sourceManifest = JSON.parse(await fs.readFile(new URL('../data/trackman/2026-fall/manifest.json', import.meta.url), 'utf8'));
const raw = combineInputs(await Promise.all(sourceManifest.files.map(f => fs.readFile(new URL(`../data/trackman/2026-fall/${f.id}.csv`, import.meta.url), 'utf8'))));
const base = { raw, summary: await fs.readFile(new URL('../public/data/season-2026-fall.json', import.meta.url), 'utf8'), spin: await fs.readFile(new URL('../public/data/spin-2026-fall.json', import.meta.url), 'utf8') };
const parsed = csvRows(raw), now = '2026-09-26T09:00:00.000Z';
const row = { ...parsed.rows.at(-1), PitchUID: randomUUID(), PitchNo: '9999' };
const input = encodeCsv(parsed.headers, [row]);
const expectedPitchCount = new Set(parsed.rows.map(p => p.PitchUID)).size + 1;
const files = [{ id: 'known-file', name: 'known.csv', size: 100, modifiedTime: now }, { id: 'added-file', name: 'new.csv', size: Buffer.byteLength(input), modifiedTime: now }];
const payload = buildPayload(base, input, now);

test('Apps Script engine matches existing calculations and blocks invalid CSV', () => {
  const context = vm.createContext({ console });
  vm.runInContext(scriptTemplate, context);
  const value = context.TohtoImport.buildPayload(base, input, now);
  assert.deepEqual(JSON.parse(JSON.stringify(value)), payload);
  assert.equal(JSON.parse(value.summary).pitches.length, expectedPitchCount);
  assert.equal(value.report.addedRows, 1);
  assert.deepEqual(value.report.warnings.length, 0);
  assert.equal(buildPayload(base, raw, now).unchanged, true);
  assert.ok(combineInputs([encodeCsv(parsed.headers, [{ ...row, Date: '2031-05-01' }])]).includes('2031-05-01'));
  assert.throws(() => buildPayload(base, 'not,a,csv\n1,2,3', now));
  const unknown=buildPayload(base, encodeCsv(parsed.headers, [{ ...row, PitchUID: randomUUID(), Batter: 'Unregistered, Test', BatterId: '999999999' }]), now);assert.match(unknown.report.notices[0].message,/漢字表記未登録/);assert.equal(unknown.report.warnings.length,0);
});

test('notification renewal performs no CSV reads or import; signed doPost is required', async () => {
  const calls = [], properties = new Map([['cursor','change-start']]);
  const context = vm.createContext({ console,
    Utilities: { getUuid: randomUUID, DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }, computeDigest: (_, s) => [...createHash('sha256').update(s).digest()], computeHmacSha256Signature: (s, key) => [...createHmac('sha256', key).update(s).digest()] },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => properties.get(k), setProperty: (k, v) => properties.set(k, v) }) },
    Drive: { Changes: { watch: (body, folder) => { calls.push(['watch', folder]); return { resourceId: 'resource', expiration: body.expiration }; }, list: () => assert.fail('renewal must not list CSVs') }, Channels: { stop: () => calls.push(['stop']) } },
    UrlFetchApp: { fetch: (url, options) => { const body = JSON.parse(options.payload); calls.push([body.action]); const expected = createHmac('sha256', secret).update(options.headers['x-trackman-time'] + '\n' + createHash('sha256').update(options.payload).digest('hex')).digest('hex'); assert.equal(options.headers['x-trackman-signature'], expected); return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body.action === 'configuration' ? { enabled: true } : { ok: true }) }; } },
    ScriptApp: {getProjectTriggers:()=>[],newTrigger:name=>({timeBased:()=>({after:()=>({create:()=>calls.push(['queued',name])})})})},
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }) }
  });
  vm.runInContext(scriptTemplate.replace("'__SYNC_SECRET__'", JSON.stringify(secret)), context);
  context.renewNotification();
  assert.deepEqual(calls.map(c => c[0]), ['configuration', 'register', 'watch', 'registered']);
  assert.equal(calls.find(c => c[0] === 'watch')[1], 'change-start');
  assert.equal(context.doPost({ postData: { contents: JSON.stringify({ time: Date.now(), channelId: 'fake', signature: 'fake' }) } }).ok, false);
  let imports = 0; context.tohtoSync = () => { imports++; return { ok: true }; };
  const time = String(Date.now()), channelId = randomUUID();
  assert.equal(context.doPost({ postData: { contents: JSON.stringify({ time, channelId, signature: await hmac(secret, `notify\n${time}\n${channelId}`) }) } }).ok, true);
  assert.equal(imports, 0);assert.equal(calls.at(-1)[0],'queued');
});

test('Apps Script resumes a timed-out compressed upload without re-uploading completed blocks',()=>{
  const properties=new Map(),stored=new Map(),counts=new Map();let clock=0;
  const blob=value=>{const bytes=typeof value==='string'?Buffer.from(value):Buffer.from(value);return {getBytes:()=>[...bytes],getDataAsString:()=>bytes.toString('utf8')};};
  const context=vm.createContext({console,Date:class extends Date{static now(){return clock;}},
    Utilities:{newBlob:blob,gzip:b=>blob(gzipSync(Buffer.from(b.getBytes()))),ungzip:b=>blob(gunzipSync(Buffer.from(b.getBytes()))),base64Encode:b=>Buffer.from(b).toString('base64'),base64Decode:s=>[...Buffer.from(s,'base64')],DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,s)=>[...createHash('sha256').update(s).digest()]},
    PropertiesService:{getScriptProperties:()=>({setProperty:(k,v)=>properties.set(k,v)})}});
  vm.runInContext(scriptTemplate,context);
  context.tohtoPut=(key,value)=>{clock+=100;stored.set(key,value);counts.set(key,(counts.get(key)||0)+1);return {key,sha256:createHash('sha256').update(value).digest('hex'),bytes:Buffer.byteLength(value)};};
  context.tohtoGet=key=>stored.get(key);
  vm.runInContext('tohtoDeadline=150;tohtoJob={progress:{}};',context);
  const text='\uFEFF'+Array.from({length:40000},(_,i)=>`p${i},日本語😀\r\n`).join(''),id=randomUUID();
  assert.throws(()=>context.tohtoUpload('2032-spring',id,'raw',text),/__TOHTO_YIELD__/);
  assert.ok(JSON.parse(properties.get('job')).progress[id+':raw']>0);
  vm.runInContext('tohtoDeadline=Infinity;',context);
  const ref=context.tohtoUpload('2032-spring',id,'raw',text);
  assert.equal(context.tohtoRead({ref}),text);
  for(const [key,n] of counts)if(key.endsWith('.gz.b64'))assert.equal(n,1,key);
});

test('isolated D1/R2 push flow authenticates, publishes, deduplicates and restores unchanged bytes', { timeout: 120000 }, async () => {
  const mf = new Miniflare({ modules: true, script: 'export default {fetch(){return new Response("test")}}', compatibilityDate: '2026-05-01', d1Databases: ['DB'], r2Buckets: ['BUCKET'], port: 0 });
  try {
    const db = await mf.getD1Database('DB'), realBucket = await mf.getR2Bucket('BUCKET');
    const bucket = { get: (...a) => realBucket.get(...a), head: (...a) => realBucket.head(...a), put: async (key, data, options) => {return realBucket.put(key, data instanceof ReadableStream ? await new Response(data).arrayBuffer() : data, { ...options, onlyIf: options?.onlyIf instanceof Headers ? new ProxyHeaders([...options.onlyIf]) : options?.onlyIf });} };
    const migration = (await Promise.all(['0001_broken_revanche.sql','0002_wise_wrecking_crew.sql'].map(f=>fs.readFile(new URL('../drizzle/'+f,import.meta.url),'utf8')))).join('--> statement-breakpoint');
    for (const sql of migration.split('--> statement-breakpoint')) await db.prepare(sql.trim()).run();
    const store = pushStore(db), context = { bucket, store, secret, engineVersion, baselineFiles: files.slice(0, 1), loadBundled: kind => base[kind] };
    async function bridge(action, fields = {}, overrides = {}) {
      const body = JSON.stringify({ action, engineVersion, ...fields }), time = String(Date.now());
      return handleBridge(new Request(origin + '/api/trackman/bridge', { method: 'POST', body, headers: { 'x-trackman-time': time, 'x-trackman-signature': await hmac(secret, time + '\n' + await sha256(body)), ...overrides } }), context);
    }
    async function value(action, fields) { for(let attempt=0;attempt<100;attempt++){const r = await bridge(action, fields); const v = await r.json(); assert.equal(r.status, 200, JSON.stringify(v)); if(!v.verifying)return v;}assert.fail('verification did not finish'); }
    assert.equal((await bridge('connect', {}, { 'x-trackman-signature': '0'.repeat(64) })).status, 401);
    assert.equal((await bridge('connect', {}, { 'x-trackman-time': String(Date.now() - 600000) })).status, 401);
    assert.equal((await bridge('connect', { scriptUrl: 'https://attacker.example/exec' })).status, 400);
    await value('connect', { scriptUrl: 'https://script.google.com/macros/s/test-deployment/exec' });
    assert.equal((await bridge('plan', { files: files.slice(1) })).status, 400);
    const plan = await value('plan', { files }); assert.deepEqual(plan.files, files.slice(1)); assert.equal(plan.baseEtag, null);
    const id = randomUUID(), objects = {};
    async function upload(kind, data, overrideHash, targetId=id) {
      const key = `datasets/v2/2026-fall/versions/${targetId}/${kind}.${['raw', 'input'].includes(kind) ? 'csv' : 'json'}`, hash = overrideHash || await sha256(data), time = String(Date.now());
      return handlePushStorage(new Request(origin + '/api/trackman/storage?key=' + encodeURIComponent(key), { method: 'PUT', body: data, headers: { 'x-trackman-time': time, 'x-trackman-signature': await hmac(secret, time + '\n' + key + '\n' + hash), 'x-content-sha256': hash, 'x-content-bytes': String(Buffer.byteLength(data)) } }), context);
    }
    assert.equal((await upload('raw', payload.raw, '0'.repeat(64))).status, 409);
    assert.equal((await readHead(bucket, '2026-fall')).active, null);
    for (const kind of ['raw', 'input', 'summary', 'spin', 'report']) {
      const r = await upload(kind, kind === 'report' ? JSON.stringify(payload.report) : payload[kind]);
      const result = await r.json(); assert.equal(r.status, 200, JSON.stringify(result)); objects[kind] = result;
    }
    assert.equal((await upload('raw', payload.raw)).status, 200);
    assert.equal((await upload('raw', 'different contents')).status, 409);
    const previousId=randomUUID(),previousObjects={};
    for(const kind of ['raw','summary','spin']){const r=await upload(kind,base[kind],null,previousId);assert.equal(r.status,200);previousObjects[kind]=await r.json();}
    const previousData=JSON.parse(base.summary),previousSnapshot={id:previousId,season:'2026-fall',createdAt:now,report:{warnings:[]},fileName:'previous',pitchCount:previousData.pitches.length,gameCount:previousData.games.length,objects:previousObjects};
    const summary = JSON.parse(payload.summary), snapshot = { id, season: '2026-fall', pitchCount: summary.pitches.length, gameCount: summary.games.length, report: payload.report, objects };
    const damaged = structuredClone(snapshot); damaged.objects.spin.key = 'datasets/v2/2026-spring/versions/'+id+'/spin.json';
    assert.equal((await bridge('publish', { baseEtag: null, files: plan.files, snapshot: damaged })).status, 400);
    assert.equal((await readHead(bucket, '2026-fall')).active, null);
    const result = await value('publish', { baseEtag: null, files: plan.files, snapshot, previousSnapshot }); assert.equal(result.pitches, expectedPitchCount);
    const head = await readHead(bucket, '2026-fall'); assert.equal(head.versions.length, 2); assert.equal(head.active, id);
    assert.equal((await value('publish', { baseEtag: null, files: plan.files, snapshot, previousSnapshot })).id,id);
    assert.equal((await value('plan', { files: files.map(f => ({ ...f, modifiedTime: new Date().toISOString() })) })).files.length, 2);
    assert.equal((await store.state()).last_error, null);

    const channelId = randomUUID(), token = randomUUID() + randomUUID(), expiration = Date.now() + 80000000;
    await value('register', { id: channelId, token, expiration }); assert.equal((await store.channels()).length, 0);
    await value('registered', { id: channelId, resourceId: 'resource', expiration }); assert.equal((await store.channels()).length, 1);
    let invoked = 0;
    const fetcher = async (url, options) => { invoked++; assert.equal(url, 'https://script.google.com/macros/s/test-deployment/exec'); const b = JSON.parse(options.body); assert.equal(b.signature, await hmac(secret, `notify\n${b.time}\n${channelId}`)); return Response.json({ ok: true }); };
    function notification(message, overrides = {}) { return new Request(origin + '/api/trackman/notify', { method: 'POST', headers: { 'x-goog-channel-id': channelId, 'x-goog-channel-token': token, 'x-goog-resource-id': 'resource', 'x-goog-message-number': String(message), 'x-goog-resource-state': 'update', ...overrides } }); }
    assert.equal((await handleNotification(notification(1, { 'x-goog-resource-state': 'sync' }), { store, secret, fetcher })).status, 204); assert.equal(invoked, 0);
    assert.equal((await handleNotification(notification(2, { 'x-goog-channel-token': 'wrong' }), { store, secret, fetcher })).status, 401);
    assert.equal((await handleNotification(notification(2, { 'x-goog-resource-id': 'wrong' }), { store, secret, fetcher })).status, 401);
    assert.equal((await handleNotification(notification(2), { store, secret, fetcher })).status, 204);
    assert.equal((await handleNotification(notification(2), { store, secret, fetcher })).status, 204); assert.equal(invoked, 1);
    assert.equal((await handleNotification(notification(3), { store, secret, fetcher: async () => { throw new Error('temporary failure'); } })).status, 503);
    assert.equal((await store.channel(channelId)).last_message, '2');
    await store.pause();
    assert.equal((await handleNotification(notification(3), { store, secret, fetcher })).status, 204); assert.equal(invoked, 1);
    assert.equal((await bridge('plan', { files })).status, 400);
    await restoreSnapshot(bucket, '2026-fall', head.versions[0].id, id);
    const restored = await activeObject(bucket, '2026-fall', 'raw'); assert.deepEqual(Buffer.from(await restored.arrayBuffer()), Buffer.from(raw));
    console.log('Real fall baseline + one isolated test pitch; hashes, stale writes, duplicate notifications, pause and byte-exact restoration verified.');
  } finally { await mf.dispose(); }
});
