import { isSeasonKey } from '../lib/seasons.mjs';
import { sha256, writeObject, openObject, verifyObject, putVerified, objectReferences } from './object-store.mjs';
export { sha256 } from './object-store.mjs';
const headKey = season => `datasets/v2/${season}/head.json`;
const VERIFICATION_VERSION = 2;
const safeId = id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
export async function readHead(bucket, season) {
  if (!isSeasonKey(season)) throw new Error('シーズンが不正です。');
  const obj = await bucket.get(headKey(season));
  if (!obj) return { etag: null, active: null, versions: [] };
  const h = await obj.json();
  if (h.season !== season || !Array.isArray(h.versions)) throw new Error('保存履歴を読み込めません。');
  return { ...h, etag: obj.etag };
}
export async function activeObject(bucket, season, kind = 'summary') {
  const h = await readHead(bucket, season);
  if (!h.active) return null;
  const v = h.versions.find(x => x.id === h.active);
  if (!v || !v.objects[kind]) throw new Error('公開中の保存版が見つかりません。');
  const obj = await openObject(bucket,v.objects[kind]);
  if (!obj) throw new Error('保存版のデータが見つかりません。');
  return obj;
}
const putChecked = putVerified;
export async function saveSnapshot(bucket, season, payload, meta) {
  const id = crypto.randomUUID(), prefix = `datasets/v2/${season}/versions/${id}`;
  const objects = {};
  for (const [kind, value] of Object.entries(payload)) objects[kind] = await writeObject(bucket, `${prefix}/${kind}.${kind === 'raw' || kind === 'input' ? 'csv' : 'json'}`, value,kind,season);
  return { ...meta, id, season, createdAt: new Date().toISOString(), objects };
}
export async function stageImport(bucket, season, payload, meta, baseline = null) {
  const h = await readHead(bucket, season);
  // Baseline is captured before the caller calculates the new dataset.
  if (meta.baseEtag !== h.etag) throw new Error('別の更新が入りました。再度CSVを検証してください。');
  const previous = !h.active && baseline ? await saveSnapshot(bucket, season, baseline.payload, baseline.meta) : null;
  const snapshot = await saveSnapshot(bucket, season, payload, meta);
  const stage = { snapshot, previous, expectedEtag: h.etag, expiresAt: Date.now() + 3600000 };
  await putChecked(bucket, `datasets/v2/staged/${snapshot.id}.json`, JSON.stringify(stage));
  return snapshot;
}
// Authenticated deterministic import agents upload immutable objects separately,
// keeping CSV calculation and large request bodies off the Sites Worker.
export async function stageStoredSnapshot(bucket, snapshot, baseEtag, baseline = null, options = {}) {
  const h = await readHead(bucket, snapshot.season);
  if (h.etag !== baseEtag) throw new Error('別の更新が入りました。再度CSVを検証してください。');
  const staged=await bucket.get(`datasets/v2/staged/${snapshot.id}.json`);
  if(staged) {
    const old=await staged.json();
    if(old.expectedEtag!==baseEtag || JSON.stringify(old.snapshot.objects)!==JSON.stringify(snapshot.objects) || JSON.stringify(old.snapshot.report)!==JSON.stringify(snapshot.report))throw new Error('検証中の保存内容が変わりました。');
    return old.snapshot;
  }
  if(!options.deferVerification)await verifySnapshot(bucket, snapshot);
  const previous = !h.active ? (options.previousSnapshot || (baseline ? await saveSnapshot(bucket, snapshot.season, baseline.payload, baseline.meta) : null)) : null;
  await putChecked(bucket, `datasets/v2/staged/${snapshot.id}.json`, JSON.stringify({ snapshot, previous, expectedEtag: h.etag, expiresAt: Date.now() + 3600000 }));
  return snapshot;
}
async function switchHead(bucket, season, h, next) {
  // Archive evicted history entries before compacting the head; never delete data.
  const unique=[...new Map(next.versions.map(v=>[v.id,v])).values()];
  const ordered=unique.sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
  const recent=ordered.slice(-40);
  const active=ordered.find(v=>v.id===next.active);
  if(active && !recent.some(v=>v.id===active.id)) recent[0]=active;
  for(const v of ordered.filter(v=>!recent.some(r=>r.id===v.id))) {
    await putChecked(bucket,`datasets/v3/${season}/history/${String(9999999999999-Date.parse(v.createdAt)).padStart(13,'0')}-${v.id}.json`,JSON.stringify(v));
    await putChecked(bucket,`datasets/v3/${season}/versions/${v.id}.json`,JSON.stringify(v));
  }
  if(h.active) {
    const backup=JSON.stringify({...h,etag:undefined});
    await putChecked(bucket,`datasets/v3/${season}/heads/${await sha256(backup)}.json`,backup);
  }
  next={...next,versions:recent,storageVersion:3};
  const onlyIf = h.etag ? { etagMatches: h.etag } : new Headers({ 'If-None-Match': '*' });
  const result = await bucket.put(headKey(season), JSON.stringify({ ...next, season, updatedAt: new Date().toISOString() }), { onlyIf, httpMetadata: { contentType: 'application/json' } });
  if (!result) throw new Error('別の更新が先に反映されました。最新状態を読み直してください。');
}
export async function verifySnapshot(bucket, v) {
  if (!safeId(v.id) || !isSeasonKey(v.season)) throw new Error('保存版の識別子が不正です。');
  const receipt=await bucket.get(`datasets/v3/verification/${v.id}.json`);
  if(receipt) {const proof=await receipt.json();if(proof.version===VERIFICATION_VERSION && proof.complete && proof.snapshotHash===await sha256(JSON.stringify(v)) && proof.checkedAt>Date.now()-3600000)return;}
  for (const kind of ['raw', 'summary', 'spin', ...['input','report','sources'].filter(k=>v.objects[k])]) {
    const ref=v.objects[kind];
    const extension=kind==='raw'||kind==='input'?'csv':'json';
    const expected=`datasets/v2/${v.season}/versions/${v.id}/${kind}.${extension}${ref?.format==='tohto-chunks-v1'?'.manifest.json':''}`;
    if(!ref || ref.key!==expected) throw new Error('保存版の参照が不正です。');
    await verifyObject(bucket,ref);
  }
}
/** Bounded verification can resume after a request/time limit without exposing partial data. */
export async function advanceVerification(bucket, snapshot) {
  if(!snapshot || !safeId(snapshot.id)||!isSeasonKey(snapshot.season))throw new Error('保存版が不正です。');
  const refs=[];
  for(const kind of ['raw','summary','spin',...['input','report','sources'].filter(k=>snapshot.objects[k])]) {
    const ref=snapshot.objects[kind],extension=['raw','input'].includes(kind)?'csv':'json';
    if(ref?.key!==`datasets/v2/${snapshot.season}/versions/${snapshot.id}/${kind}.${extension}${ref?.format==='tohto-chunks-v1'?'.manifest.json':''}`)throw new Error('保存版の参照が不正です。');
    for (const reference of await objectReferences(bucket,ref)) refs.push(reference);
  }
  const key=`datasets/v3/verification/${snapshot.id}.json`,snapshotHash=await sha256(JSON.stringify(snapshot));
  const saved=await bucket.get(key),prior=saved?await saved.json():null;
  const offset=prior?.version===VERIFICATION_VERSION && prior.snapshotHash===snapshotHash && prior.checkedAt>Date.now()-3600000 && Number.isSafeInteger(prior.offset) && prior.offset>=0 && prior.offset<=refs.length ? prior.offset : 0;
  const end=Math.min(refs.length,offset+80);
  for(let i=offset;i<end;i++) await verifyObject(bucket,refs[i]);
  const result={version:VERIFICATION_VERSION,snapshotHash,offset:end,total:refs.length,complete:end===refs.length,checkedAt:Date.now()};
  await bucket.put(key,JSON.stringify(result),{httpMetadata:{contentType:'application/json'}});
  return result;
}
export async function advanceStageVerification(bucket,id) {
  if(!safeId(id))throw new Error('検証IDが不正です。');
  const object=await bucket.get(`datasets/v2/staged/${id}.json`);if(!object)throw new Error('検証結果が見つかりません。');
  const stage=await object.json();
  // A successful commit remains retryable after its response was lost.
  const head=await readHead(bucket,stage.snapshot.season);
  if(head.active===id)return {version:VERIFICATION_VERSION,complete:true,offset:0,total:0,alreadyCommitted:true};
  if(stage.expiresAt<Date.now())throw new Error('検証期限が切れました。CSVを再検証してください。');
  if(stage.previous) {const previous=await advanceVerification(bucket,stage.previous);if(!previous.complete)return previous;}
  return advanceVerification(bucket,stage.snapshot);
}
export async function findSnapshot(bucket, season, id) {
  if(!isSeasonKey(season)||!safeId(id)) throw new Error('保存版の識別子が不正です。');
  const head=await readHead(bucket,season), recent=head.versions.find(v=>v.id===id);
  if(recent) return recent;
  const archived=await bucket.get(`datasets/v3/${season}/versions/${id}.json`);
  return archived?archived.json():null;
}
export async function historyPage(bucket,season,cursor) {
  if(!isSeasonKey(season)) throw new Error('シーズンが不正です。');
  const page=await bucket.list({prefix:`datasets/v3/${season}/history/`,limit:40,...(cursor?{cursor}:{})});
  const versions=[];
  for(const obj of page.objects) { const value=await bucket.get(obj.key);if(!value)throw new Error('履歴を取得できません。');versions.push(await value.json()); }
  return {versions,nextCursor:page.truncated?page.cursor:null};
}
export async function commitStage(bucket, id, acknowledgeWarnings = false) {
  if (!safeId(id)) throw new Error('検証IDが不正です。');
  const obj = await bucket.get(`datasets/v2/staged/${id}.json`);
  if (!obj) throw new Error('検証結果が見つかりません。');
  const stage = await obj.json(), v = stage.snapshot, h = await readHead(bucket, v.season);
  if (h.active === id) return v; // idempotent retry after response loss
  if (stage.expiresAt < Date.now()) throw new Error('検証から1時間経過しました。再度検証してください。');
  if (stage.expectedEtag !== h.etag) throw new Error('検証後にデータが更新されました。再度検証してください。');
  if (v.report.warnings.length && !acknowledgeWarnings) throw new Error('確認が必要な項目があります。内容を確認してから反映してください。');
  await verifySnapshot(bucket, v);
  if (stage.previous) await verifySnapshot(bucket, stage.previous);
  await switchHead(bucket, v.season, h, { active: id, versions: [...h.versions, ...(stage.previous ? [stage.previous] : []), v] });
  return v;
}
export async function restoreSnapshot(bucket, season, id, expectedActive) {
  const h = await readHead(bucket, season);
  if (h.active !== expectedActive) throw new Error('別の更新が入りました。履歴を読み直してください。');
  const v = await findSnapshot(bucket,season,id);
  if (!v) throw new Error('復元する保存版がありません。');
  await verifySnapshot(bucket, v);
  await switchHead(bucket, season, h, { active: id, versions: [...h.versions,v] });
  return v;
}
