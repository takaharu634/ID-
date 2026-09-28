import sourceManifest from '../data/trackman/2026-fall/manifest.json';
import { bundledSeasonCsv } from './import-baseline';
import { pushStore } from './trackman-push.mjs';
import { engineVersion } from './generated/drive-push-script.mjs';

export type PushEnv = { DB?: D1Database; BUCKET?: R2Bucket; ADMIN_EMAILS?: string; TRACKMAN_SYNC_SECRET?: string; ASSETS?: { fetch: typeof fetch } };
export function pushContext(storage: PushEnv, request: Request) {
  if (!storage.DB || !storage.BUCKET) throw new Error('保存領域が利用できません。');
  return { bucket: storage.BUCKET, store: pushStore(storage.DB), secret: storage.TRACKMAN_SYNC_SECRET, engineVersion, baselineFiles: sourceManifest.files,
    async loadBundled(kind: string,season='2026-fall') {
      const seasons=(await import('../lib/generated/seasons.json')).default;
      if(!seasons.includes(season)) return kind==='spin'?'[]':'';
      if (kind === 'raw') return bundledSeasonCsv(season);
      if (!['summary', 'spin'].includes(kind) || !storage.ASSETS) throw new Error('同梱データを取得できません。');
      const response = await storage.ASSETS.fetch(new Request(new URL(`/data/${kind === 'spin' ? 'spin' : 'season'}-${season}.json`, request.url)));
      if (!response.ok) throw new Error('同梱データを取得できません。');
      return response.text();
    }
  };
}
