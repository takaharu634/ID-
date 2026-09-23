/// <reference lib="webworker" />
import { prepareImport } from '../../server/import-service.mjs';
import { activeObject } from '../../server/import-store.mjs';
import { decodeUtf8 } from '../../lib/import-validation.mjs';
const endpoint = (key: string) => `/api/import-storage?key=${encodeURIComponent(key)}`;
const bucket = {
  async get(key: string) {
    const r = await fetch(endpoint(key), {cache:'no-store'});
    if (r.status === 404) return null;
    if (!r.ok) throw new Error('保存データを取得できません。サインイン状態と通信を確認してください。');
    return {etag:r.headers.get('etag'),text:async()=>decodeUtf8(await r.arrayBuffer()),json:()=>r.json()};
  },
  async put(key: string, value: string, options: {sha256: string}) {
    const r = await fetch(endpoint(key),{method:'PUT',body:value,headers:{'content-type':'text/plain','x-content-sha256':options.sha256,'x-content-bytes':String(new TextEncoder().encode(value).byteLength)}});
    if (!r.ok) throw new Error((await r.json()).error || '保存に失敗しました。');
    return r.json();
  },
};
async function baseline(season: string) {
  const raw = await activeObject(bucket,season,'raw');
  if (raw) return {raw:await raw.text(),summary:'',spin:''};
  async function get(kind: string) {
    const r = await fetch(`/api/dataset?season=${season}&format=${kind}`,{cache:'no-store'});
    if (r.status === 204 && kind !== 'csv') {
      const s = await fetch(`/data/${kind === 'spin' ? 'spin' : 'season'}-${season}.json`,{cache:'no-store'});
      if (!s.ok) throw new Error('同梱データを取得できません。'); return s.text();
    }
    if (!r.ok) throw new Error('既存データを取得できません。'); return decodeUtf8(await r.arrayBuffer());
  }
  return {raw:await get('csv'),summary:await get('json'),spin:await get('spin')};
}
self.onmessage = async (event: MessageEvent<File>) => {
  try {
    const file = event.data;
    if (file.size > 30*1024*1024 || !file.name.toLowerCase().endsWith('.csv')) throw new Error('30MB以下のTrackMan CSVを選択してください。');
    const input = decodeUtf8(await file.arrayBuffer());
    const result = await prepareImport(bucket,input,file.name,baseline);
    self.postMessage({result});
  } catch(error) { self.postMessage({error:error instanceof Error ? error.message : '検証に失敗しました。'}); }
};
