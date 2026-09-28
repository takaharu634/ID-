import { adminApiGuard } from '../../admin-auth';
import { importJobOwner, createImportJob, listImportJobs, getImportJob, getImportSource, putImportChunk, updateImportJob, IMPORT_CHUNK_BYTES } from '../../../server/import-jobs.mjs';
export const runtime = 'edge';
const headers = { 'cache-control': 'no-store' };
export async function GET(request: Request) { return handle(request); }
export async function POST(request: Request) { return handle(request); }
export async function PUT(request: Request) { return handle(request); }
async function handle(request: Request) {
  const { env } = await import('cloudflare:workers');
  const storage = env as unknown as { BUCKET?: R2Bucket; ADMIN_EMAILS?: string };
  const denied = adminApiGuard(request, storage.ADMIN_EMAILS); if (denied) return denied;
  const origin = request.headers.get('origin');
  if (request.method !== 'GET' && origin && origin !== new URL(request.url).origin) return Response.json({ error: '同じサイトの管理画面から操作してください。' }, { status: 403, headers });
  if (!storage.BUCKET) return Response.json({ error: '保存領域が利用できません。' }, { status: 503, headers });
  try {
    const owner = await importJobOwner(request), query = new URL(request.url).searchParams;
    if (request.method === 'GET') {
      const id = query.get('id');
      if (!id) return Response.json(await listImportJobs(storage.BUCKET, owner, query.get('cursor')), { headers });
      if (query.has('file')) return new Response(await getImportSource(storage.BUCKET, owner, id, Number(query.get('file'))), { headers: { ...headers, 'content-type': 'text/csv; charset=utf-8', 'x-content-type-options': 'nosniff' } });
      return Response.json({ job: await getImportJob(storage.BUCKET, owner, id) }, { headers });
    }
    if (request.method === 'PUT') {
      if (!query.has('file') || !query.has('chunk') || !request.headers.has('x-job-revision')) throw new Error('原本の保存先が不正です。');
      const declared = Number(request.headers.get('x-content-bytes'));
      if (!Number.isSafeInteger(declared) || declared <= 0 || declared > IMPORT_CHUNK_BYTES) return Response.json({ error: '原本チャンクが上限を超えています。' }, { status: 413, headers });
      if (!request.body) throw new Error('原本がありません。');
      const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      for (;;) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > declared) { await reader.cancel(); throw new Error('原本の容量が一致しません。'); } chunks.push(next.value); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      if (size !== declared) throw new Error('原本の容量が一致しません。');
      const job = await putImportChunk(storage.BUCKET, owner, query.get('id') || '', Number(query.get('file')), Number(query.get('chunk')), bytes, request.headers.get('x-content-sha256') || '', Number(request.headers.get('x-job-revision')), request.headers.get('x-job-token'));
      return Response.json({ job }, { headers });
    }
    const bodyReader = request.body?.getReader(); if (!bodyReader) throw new Error('操作データがありません。');
    const bodyChunks: Uint8Array[] = []; let bodyBytes = 0;
    for (;;) { const chunk = await bodyReader.read(); if (chunk.done) break; bodyBytes += chunk.value.length; if (bodyBytes > 100000) { await bodyReader.cancel(); return Response.json({ error: '操作データが上限を超えています。' }, { status: 413, headers }); } bodyChunks.push(chunk.value); }
    const combined = new Uint8Array(bodyBytes); let bodyOffset = 0; for (const chunk of bodyChunks) { combined.set(chunk, bodyOffset); bodyOffset += chunk.length; }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(combined);
    const body = JSON.parse(text);
    const result = body.action === 'create' ? await createImportJob(storage.BUCKET, owner, body.files) : await updateImportJob(storage.BUCKET, owner, body);
    if (!result) throw new Error('操作が不正です。');
    return Response.json(result, { status: 'verifying' in result && result.verifying ? 202 : 200, headers });
  } catch (error) {
    const failure = error as { message?: string; status?: number; code?: string };
    return Response.json({ error: failure.message || '取り込みを保存できませんでした。', code: failure.code }, { status: failure.status || 400, headers });
  }
}
