import { handleNotification } from '../../../../server/trackman-push.mjs';
import { pushContext, type PushEnv } from '../../../../server/trackman-push-context';
export const runtime = 'edge';
export async function POST(request: Request) {
  try { const { env } = await import('cloudflare:workers'); return await handleNotification(request, pushContext(env as unknown as PushEnv, request)); }
  catch { return new Response(null, { status: 503 }); }
}
