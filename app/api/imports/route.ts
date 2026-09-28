import { adminApiGuard } from '../../admin-auth';
import { readHead, historyPage } from '../../../server/import-store.mjs';
import { listSeasons } from '../../../server/season-catalog.mjs';
import { isSeasonKey } from '../../../lib/seasons.mjs';
export const runtime = 'edge';
export async function GET(request: Request) {
  const { env } = await import('cloudflare:workers');
  const storage = env as unknown as {BUCKET?:R2Bucket;ADMIN_EMAILS?:string};
  const denied = adminApiGuard(request,storage.ADMIN_EMAILS); if (denied) return denied;
  const headers = {'cache-control':'no-store'};
  try {
    if (!storage.BUCKET) return Response.json({imports:[]},{headers});
    const rows = [];
    const query=new URL(request.url).searchParams;
    const requested=query.get('season'), cursor=query.get('cursor');
    if(requested && !isSeasonKey(requested)) return Response.json({error:'シーズンが不正です。'},{status:400,headers});
    const seasons=requested?[requested]:(await listSeasons(storage.BUCKET)).seasons.map((s:{key:string})=>s.key);
    let nextCursor=null;
    for (const season of seasons) {
      const h = await readHead(storage.BUCKET,season);
      const archived=requested?await historyPage(storage.BUCKET,season,cursor):{versions:[],nextCursor:null};
      nextCursor=archived.nextCursor;
      for (const v of [...(cursor?[]:h.versions),...archived.versions]) rows.push({id:v.id,season,fileName:v.fileName,uploadedAt:v.createdAt,pitchCount:v.pitchCount,isActive:v.id === h.active,expectedActive:h.active,report:v.report,sourceFormat:v.objects.sources?'sources':v.objects.input?'input':null});
    }
    return Response.json({imports:[...new Map(rows.map(r=>[r.id,r])).values()].sort((a,b)=>b.uploadedAt.localeCompare(a.uploadedAt)),nextCursor},{headers});
  } catch { return Response.json({error:'保存履歴を取得できませんでした。'},{status:503,headers}); }
}
