/// <reference lib="webworker" />
import { prepareImport } from '../../server/import-service.mjs';
import { activeObject } from '../../server/import-store.mjs';
import { decodeUtf8, csvRows, encodeCsv, detectSeason } from '../../lib/import-validation.mjs';
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
    if (r.status === 204 && kind === 'csv') return '';
    if (r.status === 204 && kind !== 'csv') {
      const s = await fetch(`/data/${kind === 'spin' ? 'spin' : 'season'}-${season}.json`,{cache:'no-store'});
      if (s.status===404) return kind==='spin'?'[]':'';
      if (!s.ok) throw new Error('同梱データを取得できません。'); return s.text();
    }
    if (!r.ok) throw new Error('既存データを取得できません。'); return decodeUtf8(await r.arrayBuffer());
  }
  const csv=await get('csv');
  if(!csv) return {raw:'',summary:'',spin:'[]'};
  return {raw:csv,summary:await get('json'),spin:await get('spin')};
}
self.onmessage = async (event: MessageEvent<File[]>) => {
  try {
    const files=Array.isArray(event.data)?event.data:[event.data];
    const groups=new Map<string,{file:File,text:string}[]>();
    for(const file of files) {
      if(!file.name.toLowerCase().endsWith('.csv')) throw new Error('TrackMan CSVを選択してください。');
      const text=decodeUtf8(await file.arrayBuffer()), season=detectSeason(csvRows(text).rows).season;
      groups.set(season,[...(groups.get(season)||[]),{file,text}]);
    }
    const result=[];
    for(const entries of groups.values()) {
      let input=entries[0].text;
      if(entries.length>1) {
        const headers=new Set<string>(),rows:Record<string,string>[]=[];
        for(const entry of entries) {const parsed=csvRows(entry.text);parsed.headers.forEach((h:string)=>headers.add(h));rows.push(...parsed.rows);}
        input=encodeCsv([...headers],rows);
      }
      result.push(await prepareImport(bucket,input,entries.map(e=>e.file.name).join('、').slice(0,250),baseline,entries.map(e=>({name:e.file.name,text:e.text}))));
    }
    self.postMessage({result});
  } catch(error) { self.postMessage({error:error instanceof Error ? error.message : '検証に失敗しました。'}); }
};
