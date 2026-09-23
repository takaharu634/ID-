import { adminApiGuard } from '../../admin-auth';
import { bundledSeasonCsv } from '../../../server/import-baseline';
import { activeObject, readHead } from '../../../server/import-store.mjs';
import { SUPPORTED_SEASONS, seasonLabel } from '../../../lib/import-validation.mjs';
export const runtime = 'edge';
export async function GET(request: Request) {
  const { env } = await import('cloudflare:workers');
  const storage = env as unknown as { BUCKET?: R2Bucket; ADMIN_EMAILS?: string };
  const url = new URL(request.url), season = url.searchParams.get('season') || '2026-spring';
  const format = url.searchParams.get('format') || 'json', csv = format === 'csv';
  const version = url.searchParams.get('version');
  const headers: Record<string,string> = {'cache-control':'no-store','content-type':csv?'text/csv; charset=utf-8':'application/json; charset=utf-8'};
  if (csv || version) { const denied = adminApiGuard(request,storage.ADMIN_EMAILS); if (denied) return denied; }
  if (!SUPPORTED_SEASONS.includes(season) || !['csv','json','spin'].includes(format)) return Response.json({error:'取得条件が不正です。'},{status:400,headers});
  if (csv) headers['content-disposition'] = `attachment; filename="tohto-${season}-${version || 'current'}.csv"`;
  try {
    const kind = csv ? 'raw' : format === 'spin' ? 'spin' : 'summary';
    if (storage.BUCKET) {
      let object;
      if (version) {
        const head = await readHead(storage.BUCKET,season), row = head.versions.find((v: {id:string})=>v.id === version);
        if (!row) return Response.json({error:'保存版がありません。'},{status:404,headers});
        object = await storage.BUCKET.get(row.objects[kind].key);
        if (!object) throw new Error('保存版が見つかりません。');
      } else object = await activeObject(storage.BUCKET,season,kind);
      if (object) return new Response(object.body as unknown as ReadableStream<Uint8Array>,{headers});
      // Existing deployments used one legacy slot. Never apply it to a different season.
      const old = await storage.BUCKET.get('datasets/current.json');
      if (old) {
        const text = await old.text();
        if (JSON.parse(text).metadata?.season === seasonLabel(season)) {
          if (format === 'json') return new Response(text,{headers});
          if (csv) { const raw = await storage.BUCKET.get('datasets/current.csv'); if (!raw) throw new Error('以前のCSVが見つかりません。'); return new Response(raw.body as unknown as ReadableStream<Uint8Array>,{headers}); }
          // Legacy uploads had no paired spin snapshot. Do not mix versions silently.
          return Response.json({error:'この旧保存版には回転データがありません。CSVを再検証してください。'},{status:409,headers});
        }
      }
    }
    if (csv) return new Response(await bundledSeasonCsv(season),{headers});
    return new Response(null,{status:204,headers});
  } catch { return Response.json({error:'最新の保存データを取得できませんでした。'},{status:503,headers}); }
}
