import { adminApiGuard } from '../../admin-auth';
import { readHead } from '../../../server/import-store.mjs';
import { SUPPORTED_SEASONS } from '../../../lib/import-validation.mjs';
export const runtime = 'edge';
export async function GET(request: Request) {
  const { env } = await import('cloudflare:workers');
  const storage = env as unknown as {BUCKET?:R2Bucket;ADMIN_EMAILS?:string};
  const denied = adminApiGuard(request,storage.ADMIN_EMAILS); if (denied) return denied;
  const headers = {'cache-control':'no-store'};
  try {
    if (!storage.BUCKET) return Response.json({imports:[]},{headers});
    const rows = [];
    for (const season of SUPPORTED_SEASONS) {
      const h = await readHead(storage.BUCKET,season);
      for (const v of h.versions) rows.push({id:v.id,season,fileName:v.fileName,uploadedAt:v.createdAt,pitchCount:v.pitchCount,isActive:v.id === h.active,expectedActive:h.active,report:v.report});
    }
    return Response.json({imports:rows.sort((a,b)=>b.uploadedAt.localeCompare(a.uploadedAt))},{headers});
  } catch { return Response.json({error:'保存履歴を取得できませんでした。'},{status:503,headers}); }
}
