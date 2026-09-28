import { applyPitchQuality } from '../../../lib/pitch-quality.mjs';
import { adminApiGuard } from '../../admin-auth';
import { bundledSeasonCsv } from '../../../server/import-baseline';
import { activeObject, findSnapshot } from '../../../server/import-store.mjs';
import { isSeasonKey, seasonLabel } from '../../../lib/seasons.mjs';
import { listSeasons } from '../../../server/season-catalog.mjs';
import { openObject } from '../../../server/object-store.mjs';
import bundledSeasons from '../../../lib/generated/seasons.json';
export const runtime = 'edge';
export async function GET(request: Request) {
  const { env } = await import('cloudflare:workers');
  const storage = env as unknown as { BUCKET?: R2Bucket; ADMIN_EMAILS?: string };
  const url = new URL(request.url), season = url.searchParams.get('season') || (await listSeasons(storage.BUCKET)).latest;
  const format = url.searchParams.get('format') || 'json', csv = format === 'csv';
  const version = url.searchParams.get('version');
  const headers: Record<string,string> = {'cache-control':'no-store','content-type':csv?'text/csv; charset=utf-8':'application/json; charset=utf-8'};
  if (csv || version || format==='sources' || format==='input') { const denied = adminApiGuard(request,storage.ADMIN_EMAILS); if (denied) return denied; }
  if (!isSeasonKey(season) || !['csv','json','spin','sources','input'].includes(format)) return Response.json({error:'取得条件が不正です。'},{status:400,headers});
  if (csv) headers['content-disposition'] = `attachment; filename="tohto-${season}-${version || 'current'}.csv"`;
  try {
    const kind = csv ? 'raw' : ['spin','sources','input'].includes(format) ? format : 'summary';
    if(['sources','input'].includes(format))headers['content-disposition']=`attachment; filename="tohto-${season}-${version||'current'}-${format}.${format==='input'?'csv':'json'}"`;
    if (storage.BUCKET) {
      let object;
      if (version) {
        const row = await findSnapshot(storage.BUCKET,season,version);
        if (!row) return Response.json({error:'保存版がありません。'},{status:404,headers});
        if(!row.objects[kind])return Response.json({error:'この保存版には指定された原本がありません。'},{status:404,headers});
        object = await openObject(storage.BUCKET,row.objects[kind]);
        if (!object) throw new Error('保存版が見つかりません。');
      } else object = await activeObject(storage.BUCKET,season,kind);
      if (object && !('chunked' in object) && format === 'json' && !version) return Response.json(applyPitchQuality(await object.json()), {headers});
      if (object) return new Response(object.body as unknown as ReadableStream<Uint8Array>,{headers});
      if(['sources','input'].includes(format))return Response.json({error:'入力原本がありません。'},{status:404,headers});
      // Existing deployments used one legacy slot. Never apply it to a different season.
      const old = await storage.BUCKET.get('datasets/current.json');
      if (old) {
        const text = await old.text();
        if (JSON.parse(text).metadata?.season === seasonLabel(season)) {
          if (format === 'json') return Response.json(applyPitchQuality(JSON.parse(text)),{headers});
          if (csv) { const raw = await storage.BUCKET.get('datasets/current.csv'); if (!raw) throw new Error('以前のCSVが見つかりません。'); return new Response(raw.body as unknown as ReadableStream<Uint8Array>,{headers}); }
          // Legacy uploads had no paired spin snapshot. Do not mix versions silently.
          return Response.json({error:'この旧保存版には回転データがありません。CSVを再検証してください。'},{status:409,headers});
        }
      }
    }
    if (!bundledSeasons.includes(season)) return new Response(null,{status:204,headers});
    if (csv) return new Response(await bundledSeasonCsv(season),{headers});
    return new Response(null,{status:204,headers});
  } catch { return Response.json({error:'最新の保存データを取得できませんでした。'},{status:503,headers}); }
}
