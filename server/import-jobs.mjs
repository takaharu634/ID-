import { sha256 } from './object-store.mjs';
import { isSeasonKey } from '../lib/seasons.mjs';
import { findSnapshot, advanceStageVerification, commitStage, readHead } from './import-store.mjs';

export const IMPORT_CHUNK_BYTES = 1024 * 1024;
export const IMPORT_LEASE_MS = 15 * 60 * 1000;
const MAX_BYTES = 512 * IMPORT_CHUNK_BYTES;
const terminal = job => ['cancelled', 'completed'].includes(job.status);
const idPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fail = (message, status = 400, code = 'invalid') => { throw Object.assign(new Error(message), { status, code }); };
const prefix = (owner, id = '') => `import-jobs/v1/${owner}/${id}`;
const key = (owner, id) => `${prefix(owner, id)}/job.json`;
const nowIso = () => new Date().toISOString();
export async function importJobOwner(request) {
  const email = request.headers.get('oai-authenticated-user-email');
  if (!email) fail('管理者としてサインインしてください。', 401);
  const userId = request.headers.get('oai-authenticated-user-id');
  return sha256(userId ? `id:${userId}` : `email:${email.trim().toLowerCase()}`);
}
export function publicImportJob(job) {
  const { lease, ...visible } = job;
  return { ...visible, leaseUntil: lease?.until || null };
}
async function read(bucket, owner, id) {
  if (!idPattern.test(id)) fail('取り込み ID が不正です。');
  const object = await bucket.get(key(owner, id));
  if (!object) fail('取り込みが見つかりません。', 404);
  const job = await object.json();
  if (job.id !== id || job.format !== 'tohto-import-job-v1') fail('取り込み記録を読み込めません。', 503);
  return { job, etag: object.etag };
}
async function save(bucket, owner, previous, next) {
  const value = { ...next, revision: previous.job.revision + 1, updatedAt: nowIso() };
  const saved = await bucket.put(key(owner, value.id), JSON.stringify(value), {
    onlyIf: { etagMatches: previous.etag }, httpMetadata: { contentType: 'application/json' },
  });
  if (!saved) fail('別の画面が取り込みを更新しました。一覧を読み直してください。', 409, 'conflict');
  return value;
}
function authorize(job, revision, token) {
  // Always check ownership before any idempotent checkpoint shortcut.
  if (!token || job.lease?.token !== token || job.lease.until <= Date.now()) fail('処理の使用期限が切れました。一覧から再開してください。', 409, 'lease');
  if (job.revision !== revision) fail('取り込みの状態が変わりました。一覧を読み直してください。', 409, 'conflict');
  if (terminal(job)) fail('終了した取り込みです。', 409, 'terminal');
}
async function cleanSources(bucket, owner, id) {
  // Keep the terminal tombstone. A late PUT must observe it and remove its own object.
  let cursor;
  do {
    const page = await bucket.list({ prefix: `${prefix(owner, id)}/sources/`, limit: 1000, ...(cursor ? { cursor } : {}) });
    if (page.objects.length) await bucket.delete(page.objects.map(item => item.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}
async function finish(bucket, owner, previous, status) {
  const next = terminal(previous.job) ? previous.job : await save(bucket, owner, previous, { ...previous.job, status, lease: null, cleanupPending: true });
  // Retry cleanup even when a previous terminal response was lost or deletion failed.
  const cleanupStart = await read(bucket, owner, next.id);
  await cleanSources(bucket, owner, next.id);
  // Clear only the generation that was scanned. A late writer may have reported
  // another cleanup failure while this list/delete pass was in flight.
  return cleanupStart.job.cleanupPending ? save(bucket, owner, cleanupStart, { ...cleanupStart.job, cleanupPending: false }) : (await read(bucket, owner, next.id)).job;
}
export async function createImportJob(bucket, owner, files) {
  if (!Array.isArray(files) || !files.length || files.length > 128) fail('CSV は 1〜128 ファイルずつ選択してください。');
  let bytes = 0;
  const validated = files.map(file => {
    if (typeof file.name !== 'string' || !file.name.toLowerCase().endsWith('.csv') || file.name.length > 250 || !Number.isSafeInteger(file.size) || file.size <= 0 || !isSeasonKey(file.season) || !/^[a-f0-9]{64}$/.test(file.sha256)) fail('入力ファイルの情報が不正です。');
    bytes += file.size;
    if (bytes > MAX_BYTES) fail('一度に保存できる原本は 512 MiB です。試合ごとに分けて追加してください。', 413);
    return { name: file.name, size: file.size, season: file.season, sha256: file.sha256, chunks: Array(Math.ceil(file.size / IMPORT_CHUNK_BYTES)).fill(null) };
  });
  if (bytes > MAX_BYTES) fail('一度に保存できる原本は 512 MiB です。試合ごとに分けて追加してください。', 413);
  const id = crypto.randomUUID(), token = crypto.randomUUID();
  const job = { format: 'tohto-import-job-v1', id, revision: 0, createdAt: nowIso(), updatedAt: nowIso(), status: 'uploading', files: validated,
    seasons: [...new Set(validated.map(file => file.season))].map(season => ({ season, status: 'pending' })),
    lease: { token, until: Date.now() + IMPORT_LEASE_MS } };
  const saved = await bucket.put(key(owner, id), JSON.stringify(job), { onlyIf: new Headers({ 'If-None-Match': '*' }), httpMetadata: { contentType: 'application/json' } });
  if (!saved) fail('保存 ID が競合しました。もう一度実行してください。', 409);
  return { job: publicImportJob(job), token };
}
export async function listImportJobs(bucket, owner, cursor) {
  const page = await bucket.list({ prefix: prefix(owner), delimiter: '/', limit: 100, ...(cursor ? { cursor } : {}) });
  const jobs = [];
  for (const path of page.delimitedPrefixes || []) {
    const id = path.split('/').at(-2);
    const current = await read(bucket, owner, id);
    if (!terminal(current.job) || current.job.cleanupPending) jobs.push(publicImportJob(current.job));
  }
  return { jobs: jobs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), cursor: page.truncated ? page.cursor : null };
}
export async function getImportJob(bucket, owner, id) { return publicImportJob((await read(bucket, owner, id)).job); }
export async function putImportChunk(bucket, owner, id, fileIndex, chunkIndex, bytes, hash, revision, token) {
  const current = await read(bucket, owner, id), job = current.job;
  authorize(job, revision, token);
  const file = job.files[fileIndex];
  if (job.status !== 'uploading' || !Number.isInteger(fileIndex) || !Number.isInteger(chunkIndex) || !file || chunkIndex < 0 || chunkIndex >= file.chunks.length) fail('原本の保存先が不正です。');
  const expectedBytes = Math.min(IMPORT_CHUNK_BYTES, file.size - chunkIndex * IMPORT_CHUNK_BYTES);
  if (bytes.byteLength !== expectedBytes || !/^[a-f0-9]{64}$/.test(hash) || await sha256(bytes) !== hash) fail('原本チャンクの容量または照合値が一致しません。');
  const sourceKey = `${prefix(owner, id)}/sources/${fileIndex}/${chunkIndex}/${hash}`;
  const old = file.chunks[chunkIndex];
  if (old && (old.sha256 !== hash || old.bytes !== expectedBytes)) fail('原本を上書きできません。新しい取り込みを作成してください。', 409);
  await bucket.put(sourceKey, bytes, { onlyIf: new Headers({ 'If-None-Match': '*' }), sha256: hash });
  try {
    // A cancel/reclaim may have won while PUT was in flight.
    const latest = await read(bucket, owner, id);
    authorize(latest.job, revision, token);
    const check = await bucket.get(sourceKey);
    if (!check || await sha256(await check.arrayBuffer()) !== hash) fail('原本を保存後に照合できませんでした。', 503);
    if (old) return publicImportJob(latest.job);
    const next = structuredClone(job);
    next.files[fileIndex].chunks[chunkIndex] = { key: sourceKey, sha256: hash, bytes: expectedBytes };
    next.lease.until = Date.now() + IMPORT_LEASE_MS;
    return publicImportJob(await save(bucket, owner, current, next));
  } catch (error) {
    const latest = await read(bucket, owner, id);
    if (terminal(latest.job) || latest.job.files[fileIndex]?.chunks[chunkIndex]?.key !== sourceKey) {
      try { await bucket.delete(sourceKey); }
      catch (cleanupError) {
        if (terminal(latest.job)) {
          // Advance revision even when already pending, invalidating a concurrent cleanup scan.
          for (let attempt = 0; ; attempt++) {
            const pending = await read(bucket, owner, id);
            try { await save(bucket, owner, pending, { ...pending.job, cleanupPending: true }); break; }
            catch (failure) { if (failure.code !== 'conflict' || attempt >= 4) throw failure; }
          }
        }
        throw cleanupError;
      }
    }
    throw error;
  }
}
export async function getImportSource(bucket, owner, id, fileIndex) {
  const { job } = await read(bucket, owner, id);
  if (terminal(job)) fail('終了した取り込みの原本は削除されています。', 410);
  const file = job.files[fileIndex];
  if (!Number.isInteger(fileIndex) || !file || file.chunks.some(chunk => !chunk)) fail('原本の保存が完了していません。', 409);
  let index = 0;
  return new ReadableStream({ async pull(controller) {
    if (index === file.chunks.length) { controller.close(); return; }
    try {
      const part = file.chunks[index++];
      const object = await bucket.get(part.key);
      if (!object) fail('原本の一部が見つかりません。', 503);
      const bytes = await object.arrayBuffer();
      if (bytes.byteLength !== part.bytes || await sha256(bytes) !== part.sha256) fail('原本が破損しています。', 503);
      controller.enqueue(new Uint8Array(bytes));
    } catch (error) { controller.error(error); }
  } });
}
export async function updateImportJob(bucket, owner, body) {
  let current = await read(bucket, owner, body.id), job = current.job;
  if (body.action === 'cleanup' && terminal(job)) return { job: publicImportJob(await finish(bucket, owner, current, job.status)) };
  if (body.action === 'cancel' && job.status === 'cancelled') return { job: publicImportJob(await finish(bucket, owner, current, 'cancelled')) };
  if (body.action === 'finish' && job.status === 'completed') return { job: publicImportJob(await finish(bucket, owner, current, 'completed')) };
  if (body.action === 'claim') {
    if (terminal(job)) fail('終了した取り込みです。', 409);
    if (job.lease && job.lease.until > Date.now()) fail('別の画面が処理中です。一時停止するか、使用期限後に再開してください。', 409, 'lease');
    const token = crypto.randomUUID();
    job = await save(bucket, owner, current, { ...job, lease: { token, until: Date.now() + IMPORT_LEASE_MS } });
    return { job: publicImportJob(job), token };
  }
  authorize(job, body.revision, body.token);
  if (job.publishing && !['publish', 'reconcile', 'renew'].includes(body.action)) fail('反映の結果を照合中です。先に取り込みを再開してください。', 409, 'publishing');
  if (body.action === 'cancel') return { job: publicImportJob(await finish(bucket, owner, current, 'cancelled')) };
  if (body.action === 'pause') return { job: publicImportJob(await save(bucket, owner, current, { ...job, lease: null })) };
  if (body.action === 'renew') return { job: publicImportJob(await save(bucket, owner, current, { ...job, lease: { ...job.lease, until: Date.now() + IMPORT_LEASE_MS } })) };
  if (body.action === 'ready') {
    if (job.files.some(file => file.chunks.some(chunk => !chunk))) fail('原本の保存が完了していません。', 409);
    job = await save(bucket, owner, current, { ...job, status: 'ready' });
    return { job: publicImportJob(job) };
  }
  if (body.action === 'finish') {
    if (job.seasons.some(item => !['committed', 'unchanged'].includes(item.status))) fail('未完了のシーズンがあります。', 409);
    return { job: publicImportJob(await finish(bucket, owner, current, 'completed')) };
  }
  if (job.status !== 'ready') fail('原本の保存が完了していません。', 409);
  const item = job.seasons.find(entry => entry.season === body.season);
  if (!item) fail('シーズンが不正です。');
  if (job.publishing && (job.publishing.season !== item.season || job.publishing.stageId !== item.prepared?.id)) fail('反映中のシーズンの結果を先に照合してください。', 409, 'publishing');
  if (['committed', 'unchanged'].includes(item.status)) return { job: publicImportJob(job) };
  if (body.action === 'prepared') {
    if (body.unchanged === true) Object.assign(item, { status: 'unchanged', prepared: null });
    else {
      if (!idPattern.test(body.stageId || '')) fail('検証 ID が不正です。');
      const object = await bucket.get(`datasets/v2/staged/${body.stageId}.json`);
      const stage = object ? await object.json() : null;
      if (!stage || stage.snapshot.season !== item.season) fail('検証結果が見つかりません。');
      Object.assign(item, { status: 'prepared', prepared: { id: stage.snapshot.id, season: item.season, report: stage.snapshot.report, expiresAt: stage.expiresAt } });
    }
    return { job: publicImportJob(await save(bucket, owner, current, job)) };
  }
  if (body.action === 'reconcile' || body.action === 'publish') {
    if (!item.prepared) fail('検証が必要です。', 409, 'revalidate');
    const saved = await findSnapshot(bucket, item.season, item.prepared.id);
    if (saved && (saved.id !== item.prepared.id || saved.season !== item.season)) fail('保存履歴の識別子が一致しません。', 503);
    if (saved) {
      item.status = 'committed';
      job.publishing = null;
      return { job: publicImportJob(await save(bucket, owner, current, job)) };
    }
    const stagedObject = await bucket.get(`datasets/v2/staged/${item.prepared.id}.json`);
    const staged = stagedObject ? await stagedObject.json() : null;
    const head = await readHead(bucket, item.season);
    if (!staged || staged.expiresAt <= Date.now() || staged.expectedEtag !== head.etag) {
      Object.assign(item, { status: 'pending', prepared: null });
      job.publishing = null;
      return { job: publicImportJob(await save(bucket, owner, current, job)), revalidate: true };
    }
    if (body.action === 'reconcile') return { job: publicImportJob(job) };
    if (item.prepared.report.warnings.length && body.acknowledgeWarnings !== true) fail('検証結果を確認してから反映してください。', 409, 'warnings');
    const proof = await advanceStageVerification(bucket, item.prepared.id);
    if (!proof.complete) return { job: publicImportJob(job), verifying: true, checked: proof.offset, total: proof.total };
    // A durable publishing fence prevents cancellation from overtaking a head switch.
    current = await read(bucket, owner, body.id);
    authorize(current.job, body.revision, body.token);
    if (current.job.publishing && current.job.publishing.stageId !== item.prepared.id) fail('別の反映結果を照合中です。', 409, 'publishing');
    job = await save(bucket, owner, current, { ...job, publishing: { stageId: item.prepared.id, season: item.season, startedAt: nowIso() } });
    try {
      await commitStage(bucket, item.prepared.id, body.acknowledgeWarnings === true);
      current = await read(bucket, owner, body.id);
      // A reclaimed lease must not receive an old holder's checkpoint.
      authorize(current.job, job.revision, body.token);
      const next = current.job;
      next.seasons.find(entry => entry.season === item.season).status = 'committed';
      next.publishing = null;
      return { job: publicImportJob(await save(bucket, owner, current, next)) };
    } catch (error) {
      // Preserve the fence when the result is unknown. A retry first reconciles history.
      // Known pre-publication rejection can safely return this season to validation.
      if (/検証から1時間|検証後にデータが更新|別の更新が先に反映/.test(error.message)) {
        current = await read(bucket, owner, body.id);
        authorize(current.job, job.revision, body.token);
        const saved = await findSnapshot(bucket, item.season, item.prepared.id);
        const next = current.job, entry = next.seasons.find(value => value.season === item.season);
        Object.assign(entry, saved ? { status: 'committed' } : { status: 'pending', prepared: null });
        next.publishing = null;
        return { job: publicImportJob(await save(bucket, owner, current, next)), revalidate: !saved };
      }
      throw error;
    }
  }
  fail('操作が不正です。');
}
