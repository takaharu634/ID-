export const DEFAULT_SOURCES = [
  {id:'1eQhb4GYv3zlP-74BAK3g8xzkO3htUCr6',label:'TrackMan 秋季',recursive:true},
  {id:'1kagc93d5zaeNtAJ4qY9h_cYjUN2f25lW',label:'TrackMan 春季',recursive:true},
];
const KEY='datasets/settings/drive-sources.json';
export function validateSources(sources) {
  if(!Array.isArray(sources)||!sources.length||sources.length>50)throw new Error('対象フォルダは1〜50件で指定してください。');
  const seen=new Set();
  return sources.map(s=>{if(!s||!/^[A-Za-z0-9_-]{10,200}$/.test(s.id)||seen.has(s.id))throw new Error('フォルダIDが不正、または重複しています。');seen.add(s.id);return {id:s.id,label:String(s.label||'TrackMan').slice(0,100),recursive:s.recursive!==false};});
}
export async function readSources(bucket) {const value=await bucket.get(KEY);return value?validateSources(await value.json()):DEFAULT_SOURCES;}
export async function saveSources(bucket,sources) {const value=validateSources(sources);await bucket.put(KEY,JSON.stringify(value),{httpMetadata:{contentType:'application/json'}});return value;}
