import { adminApiGuard } from '../../admin-auth';
import { SUPPORTED_SEASONS } from '../../../lib/import-validation.mjs';
declare const FixedLengthStream: new (length: number) => {readable:ReadableStream<Uint8Array>;writable:WritableStream<Uint8Array>};
export const runtime = 'edge';
const json = (error: string, status: number) => Response.json({ error }, { status, headers: { 'cache-control': 'no-store' } });
export async function GET(request: Request) { return storageRequest(request); }
export async function PUT(request: Request) { return storageRequest(request); }
async function storageRequest(request: Request) {
  const { env } = await import('cloudflare:workers');
  const storage = env as unknown as { BUCKET?: R2Bucket; ADMIN_EMAILS?: string };
  const denied = adminApiGuard(request, storage.ADMIN_EMAILS); if (denied) return denied;
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return json('同じサイトの管理画面から操作してください。',403);
  if (!storage.BUCKET) return json('保存領域が利用できません。',503);
  const key = new URL(request.url).searchParams.get('key') || '';
  const parts = key.split('/'), uuid = '[a-f0-9-]{36}';
  const objectKey = new RegExp(`^datasets/v2/(2025-fall|2026-spring|2026-fall)/versions/${uuid}/(raw\\.csv|input\\.csv|summary\\.json|spin\\.json|report\\.json)$`).test(key);
  const stageKey = new RegExp(`^datasets/v2/staged/${uuid}\\.json$`).test(key);
  const headKey = parts.length === 4 && parts[0] === 'datasets' && parts[1] === 'v2' && SUPPORTED_SEASONS.includes(parts[2]) && parts[3] === 'head.json';
  if (!objectKey && !stageKey && !(request.method === 'GET' && headKey)) return json('保存先が不正です。',400);
  try {
    if (request.method === 'GET') {
      const object = await storage.BUCKET.get(key); if (!object) return new Response(null,{status:404});
      return new Response(object.body as unknown as ReadableStream<Uint8Array>,{headers:{'cache-control':'no-store','etag':object.etag,'content-type':key.endsWith('.csv')?'text/csv; charset=utf-8':'application/json'}});
    }
    const hash = request.headers.get('x-content-sha256') || '';
    if (!/^[a-f0-9]{64}$/.test(hash)) return json('保存内容の照合値がありません。',400);
    const length = Number(request.headers.get('x-content-bytes'));
    if (!Number.isSafeInteger(length) || length <= 0 || length > (stageKey ? 1000000 : 45*1024*1024)) return json('保存サイズが不正、または上限を超えています。',413);
    if (!request.body) return json('保存内容がありません。',400);
    // R2 verifies the checksum while streaming; existing snapshots cannot be overwritten.
    // Framework request streams can lose the original length. Enforce it without buffering.
    const stream = new FixedLengthStream(length), controller = new AbortController();
    const transfer = request.body.pipeTo(stream.writable,{signal:controller.signal});
    // Attach a rejection handler immediately; the original promise is still awaited below.
    transfer.catch(()=>{});
    try {
      const saved = await storage.BUCKET.put(key, stream.readable as unknown as Parameters<R2Bucket['put']>[1], {sha256:hash,onlyIf:new Headers({'If-None-Match':'*'}) as unknown as NonNullable<Parameters<R2Bucket['put']>[2]>['onlyIf'],httpMetadata:{contentType:key.endsWith('.csv')?'text/csv; charset=utf-8':'application/json'}});
      if (!saved) { controller.abort(); await transfer.catch(()=>{}); return json('同じ保存IDが既に存在します。再度検証してください。',409); }
      await transfer;
      return Response.json({etag:saved.etag},{headers:{'cache-control':'no-store'}});
    } catch(error) { controller.abort(); await transfer.catch(()=>{}); throw error; }
  } catch(error) { console.error('[import storage]', error instanceof Error ? error.message : 'Storage error'); return json('保存または照合に失敗しました。現在の表示データは維持しています。',503); }
}
