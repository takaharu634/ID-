import { listSeasons } from '../../../server/season-catalog.mjs';
export const runtime='edge';
export async function GET() {
  try {
    const {env}=await import('cloudflare:workers');
    const data=await listSeasons((env as unknown as {BUCKET?:R2Bucket}).BUCKET);
    return Response.json(data,{headers:{'cache-control':'no-store','access-control-allow-origin':'*'}});
  } catch { return Response.json({error:'シーズン一覧を取得できませんでした。'},{status:503,headers:{'cache-control':'no-store'}}); }
}
