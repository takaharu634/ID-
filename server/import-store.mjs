import { SUPPORTED_SEASONS } from '../lib/import-validation.mjs';
export const sha256 = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const headKey = season => `datasets/v2/${season}/head.json`;
const safeId = id => typeof id === 'string' && /^[a-f0-9-]{36}$/.test(id);
export async function readHead(bucket, season) {
  if (!SUPPORTED_SEASONS.includes(season)) throw new Error('シーズンが不正です。');
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
  const obj = await bucket.get(v.objects[kind].key);
  if (!obj) throw new Error('保存版のデータが見つかりません。');
  return obj;
}
async function putChecked(bucket, key, text) {
  const hash = await sha256(text);
  await bucket.put(key, text, { sha256: hash, httpMetadata: { contentType: key.endsWith('.csv') ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8' } });
  const saved = await bucket.get(key);
  if (!saved || await sha256(await saved.text()) !== hash) throw new Error('バックアップの照合に失敗しました。公開中のデータは維持しています。');
  return { key, sha256: hash };
}
export async function saveSnapshot(bucket, season, payload, meta) {
  const id = crypto.randomUUID(), prefix = `datasets/v2/${season}/versions/${id}`;
  const objects = {};
  for (const [kind, value] of Object.entries(payload)) objects[kind] = await putChecked(bucket, `${prefix}/${kind}.${kind === 'raw' || kind === 'input' ? 'csv' : 'json'}`, value);
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
async function switchHead(bucket, season, h, next) {
  const onlyIf = h.etag ? { etagMatches: h.etag } : new Headers({ 'If-None-Match': '*' });
  const result = await bucket.put(headKey(season), JSON.stringify({ ...next, season, updatedAt: new Date().toISOString() }), { onlyIf, httpMetadata: { contentType: 'application/json' } });
  if (!result) throw new Error('別の更新が先に反映されました。最新状態を読み直してください。');
}
async function verifySnapshot(bucket, v) {
  if (!safeId(v.id) || !SUPPORTED_SEASONS.includes(v.season)) throw new Error('保存版の識別子が不正です。');
  for (const kind of ['raw', 'summary', 'spin']) {
    const ref = v.objects[kind], obj = ref && await bucket.get(ref.key);
    if (!ref || ref.key !== `datasets/v2/${v.season}/versions/${v.id}/${kind}.${kind === 'raw' ? 'csv' : 'json'}`) throw new Error('保存版の参照が不正です。');
    if (!obj) throw new Error('保存版が欠けています。切り替えを停止しました。');
    const checksum = obj.checksums?.sha256;
    const actual = checksum ? [...new Uint8Array(checksum)].map(x=>x.toString(16).padStart(2,'0')).join('') : await sha256(await obj.text());
    if (actual !== ref.sha256) throw new Error('保存版が破損しています。切り替えを停止しました。');
  }
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
  const v = h.versions.find(x => x.id === id);
  if (!v) throw new Error('復元する保存版がありません。');
  await verifySnapshot(bucket, v);
  await switchHead(bucket, season, h, { active: id, versions: h.versions });
  return v;
}
