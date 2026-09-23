import { adminApiGuard } from '../../admin-auth';
import { commitStage, restoreSnapshot } from '../../../server/import-store.mjs';
export const runtime = 'edge';
type Env = { BUCKET?: R2Bucket; ADMIN_EMAILS?: string; ASSETS?: { fetch: typeof fetch } };
export async function POST(request: Request) {
  const { env } = await import('cloudflare:workers');
  const storage = env as unknown as Env;
  const failure = adminApiGuard(request, storage.ADMIN_EMAILS);
  if (failure) return failure;
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: '同じサイトの管理画面から操作してください。' }, { status: 403 });
  if (!storage.BUCKET) return Response.json({ error: '保存領域が利用できません。' }, { status: 503 });
  try {
    if (request.headers.get('content-type')?.includes('application/json')) {
      const body = await request.json();
      const v = body.action === 'restore'
        ? await restoreSnapshot(storage.BUCKET, String(body.season), String(body.id), body.expectedActive)
        : body.action === 'commit' ? await commitStage(storage.BUCKET, String(body.id), body.acknowledgeWarnings === true) : null;
      if (!v) throw new Error('操作が不正です。');
      return Response.json({ ok: true, id: v.id, message: `${v.pitchCount.toLocaleString('ja-JP')}球を反映しました。` }, { headers: { 'cache-control': 'no-store' } });
    }
    throw new Error('管理画面から検証を実行してください。');
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : '取り込みに失敗しました。公開中のデータは維持しています。' }, { status: 400, headers: { 'cache-control': 'no-store' } });
  }
}
