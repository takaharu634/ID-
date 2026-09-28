import { adminApiGuard } from '../../../admin-auth';
import { pushContext, type PushEnv } from '../../../../server/trackman-push-context';
import { scriptTemplate, engineVersion } from '../../../../server/generated/drive-push-script.mjs';
import manifest from '../../../../integrations/trackman-drive/appsscript.json';
import { readSources, saveSources } from '../../../../server/drive-settings.mjs';
import { invokeScript } from '../../../../server/trackman-push.mjs';
export const runtime = 'edge';
const headers = { 'cache-control': 'no-store', 'cross-origin-resource-policy': 'same-origin' };
export async function GET(request: Request) {
  const { env } = await import('cloudflare:workers'); const storage = env as unknown as PushEnv;
  const denied = adminApiGuard(request, storage.ADMIN_EMAILS); if (denied) return denied;
  try {
    const context = pushContext(storage, request), download = new URL(request.url).searchParams.get('download');
    if (download === 'script') {
      if (!storage.TRACKMAN_SYNC_SECRET) throw new Error('接続キーが未設定です。');
      const code = scriptTemplate.replaceAll("'__BASE_URL__'", JSON.stringify(new URL(request.url).origin)).replaceAll("'__SYNC_SECRET__'", JSON.stringify(storage.TRACKMAN_SYNC_SECRET));
      return new Response(code, { headers: { ...headers, 'content-type': 'text/plain; charset=utf-8', 'content-disposition': 'attachment; filename="ID-Tohto-Drive.gs"' } });
    }
    if (download === 'manifest') return new Response(JSON.stringify(manifest, null, 2), { headers: { ...headers, 'content-type': 'application/json', 'content-disposition': 'attachment; filename="appsscript.json"' } });
    const state = await context.store.state(), channels = await context.store.channels();
    const expiresAt = Math.max(0, ...channels.map((c: { expires_at: number }) => c.expires_at));
    return Response.json({ configured: Boolean(storage.TRACKMAN_SYNC_SECRET), connected: Boolean(state?.script_url), enabled: Boolean(state?.enabled), expiresAt, active: Boolean(state?.enabled && expiresAt > Date.now()), lastEventAt: state?.last_event_at || null, lastSuccessAt: state?.last_success_at || null, error: state?.last_error || null, result: state?.last_result ? JSON.parse(state.last_result) : null, engineVersion, sources:await readSources(storage.BUCKET) }, { headers });
  } catch { return Response.json({ error: 'Google連携の設定を取得できません。' }, { status: 503, headers }); }
}
export async function POST(request: Request) {
  const { env } = await import('cloudflare:workers'); const storage = env as unknown as PushEnv;
  const denied = adminApiGuard(request, storage.ADMIN_EMAILS); if (denied) return denied;
  if (request.headers.get('origin') !== new URL(request.url).origin) return Response.json({ error: '同じ管理画面から操作してください。' }, { status: 403, headers });
  try {
    const context = pushContext(storage, request), body = await request.json();
    if (body.action === 'sources') return Response.json({sources:await saveSources(storage.BUCKET,body.sources)},{headers});
    if (body.action === 'pause') { await context.store.pause(); return Response.json({ ok: true }, { headers }); }
    if (body.action === 'retry' && storage.TRACKMAN_SYNC_SECRET) return Response.json(await invokeScript(await context.store.state(), storage.TRACKMAN_SYNC_SECRET, 'manual-retry'), { headers });
    return Response.json({ error: '操作が不正です。' }, { status: 400, headers });
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : '操作を完了できません。' }, { status: 400, headers }); }
}
