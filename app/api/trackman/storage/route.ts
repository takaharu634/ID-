import { handlePushStorage } from '../../../../server/trackman-push.mjs';
import { pushContext, type PushEnv } from '../../../../server/trackman-push-context';
export const runtime = 'edge';
export async function PUT(request: Request) {
  try { const { env } = await import('cloudflare:workers'); return await handlePushStorage(request, pushContext(env as unknown as PushEnv, request)); }
  catch { return Response.json({ error: 'Google連携の保存領域が利用できません。' }, { status: 503, headers: { 'cache-control': 'no-store' } }); }
}

export async function GET(request:Request) { return PUT(request); }
