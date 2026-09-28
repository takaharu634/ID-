import { handleBridge } from '../../../../server/trackman-push.mjs';
import { pushContext, type PushEnv } from '../../../../server/trackman-push-context';
export const runtime = 'edge';
export async function POST(request: Request) {
  try { const { env } = await import('cloudflare:workers'); return await handleBridge(request, pushContext(env as unknown as PushEnv, request)); }
  catch { return Response.json({ error: 'Google連携を開始できません。' }, { status: 503, headers: { 'cache-control': 'no-store' } }); }
}
