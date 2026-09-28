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
type WorkerRequest = { type:'inspect'; files:File[] } | { type:'prepare'; jobId:string; files:{index:number;name:string;sha256:string}[] };
self.onmessage = async (event: MessageEvent<File[] | WorkerRequest>) => {
  try {
    const request=event.data;
    if(!Array.isArray(request) && request.type==='inspect') {
      const files=[];
      for(const file of request.files) {
        if(!file.name.toLowerCase().endsWith('.csv')) throw new Error('TrackMan CSVを選択してください。');
        const bytes=await file.arrayBuffer(),season=detectSeason(csvRows(decodeUtf8(bytes)).rows).season;
        const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
        files.push({name:file.name,size:file.size,season,sha256});
      }
      self.postMessage({files});return;
    }
    const files:File[]=Array.isArray(request)?request:[];
    if(!Array.isArray(request)) for(const file of request.files) {
      const response=await fetch(`/api/import-jobs?id=${encodeURIComponent(request.jobId)}&file=${file.index}`,{cache:'no-store'});
      if(!response.ok)throw new Error('保存済み原本を取得できません。通信とサインイン状態を確認してください。');
      const bytes=await response.arrayBuffer();
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
      if(hash!==file.sha256)throw new Error('保存済み原本の全体照合値が一致しません。取り込みを中止して原本から追加してください。');
      files.push(new File([bytes],file.name,{type:'text/csv'}));
    }
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
        for(const entry of entries) {const parsed=csvRows(entry.text);parsed.headers.forEach((h:string)=>headers.add(h));for (const row of parsed.rows) rows.push(row);}
        input=encodeCsv([...headers],rows);
      }
      result.push(await prepareImport(bucket,input,entries.map(e=>e.file.name).join('、').slice(0,250),baseline,entries.map(e=>({name:e.file.name,text:e.text}))));
    }
    self.postMessage({result});
  } catch(error) { self.postMessage({error:error instanceof Error ? error.message : '検証に失敗しました。'}); }
};
