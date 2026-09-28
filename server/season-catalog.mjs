import bundled from '../lib/generated/seasons.json' with { type: 'json' };
import { isSeasonKey, seasonInfo, sortSeasons } from '../lib/seasons.mjs';
import { readHead, sha256 } from './import-store.mjs';
export async function listSeasons(bucket) {
  const keys = new Set(bundled);
  if (bucket) {
    let cursor;
    do {
      const page = await bucket.list({prefix:'datasets/v2/',delimiter:'/',limit:1000,...(cursor?{cursor}:{})});
      for (const prefix of page.delimitedPrefixes || []) { const key=prefix.split('/')[2]; if(isSeasonKey(key)) keys.add(key); }
      if (page.truncated && (!page.cursor || page.cursor===cursor)) throw new Error('シーズン一覧の取得が中断しました。');
      cursor=page.truncated?page.cursor:undefined;
    } while(cursor);
  }
  const seasons=[];
  for (const key of sortSeasons(keys)) {
    const head=bucket?await readHead(bucket,key):null;
    const active=head?.versions.find(v=>v.id===head.active);
    if (!bundled.includes(key) && !active) continue;
    seasons.push({...seasonInfo(key),version:head?.active || 'bundled',...(active?{pitches:active.pitchCount,games:active.gameCount}: {})});
  }
  return {seasons,latest:seasons[0]?.key,revision:await sha256(JSON.stringify(seasons)),schemaVersion:1};
}
