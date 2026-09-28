// Immutable compressed blocks. Browser import workers and Workers share the format.
const encoder = {encode: value => new TextEncoder().encode(value)};
export const sha256 = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? encoder.encode(value) : value))].map(x=>x.toString(16).padStart(2,'0')).join('');
export const BLOCK_CHARS = 128 * 1024;
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const base64 = bytes => { let result=''; for(let i=0;i<bytes.length;i+=8192) result+=String.fromCharCode(...bytes.subarray(i,i+8192)); return btoa(result); };
const unbase64 = value => Uint8Array.from(atob(value),c=>c.charCodeAt(0));
export async function compressText(text) {
  return base64(new Uint8Array(await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer()));
}
export async function decompressText(text) {
  const stream = new Blob([unbase64(text)]).stream().pipeThrough(new DecompressionStream('gzip'));
  const reader=stream.getReader(), chunks=[]; let size=0;
  for(;;) { const {value,done}=await reader.read(); if(done) break; size+=value.length; if(size>BLOCK_CHARS*4+16) {await reader.cancel();throw new Error('分割データが上限を超えています。');} chunks.push(value); }
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
  return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
}
export function* splitText(text) {
  for(let i=0;i<text.length;) { let end=Math.min(text.length,i+BLOCK_CHARS); if(end<text.length && /[\uD800-\uDBFF]/.test(text[end-1])) end--; yield text.slice(i,end);i=end; }
}
/** Stable game boundaries share unchanged pitch blocks between releases. */
export function* objectSegments(text, kind) {
  if(kind==='summary') {
    const data=typeof text==='string'?JSON.parse(text):text;
    if(!Array.isArray(data.pitches)) throw new Error('投球データがありません。');
    const {pitches,...summary}=data;
    yield* splitText(JSON.stringify(summary).slice(0,-1)+',"pitches":[');
    let group=[],game,first=true;
    const emit=rows=>(first?'':',')+rows.map(p=>JSON.stringify(p)).join(',');
    for(const pitch of pitches) {
      if(group.length && (pitch.gameId!==game || group.length>=100)) {yield* splitText(emit(group));first=false;group=[];}
      game=pitch.gameId;group.push(pitch);
    }
    if(group.length) yield* splitText(emit(group));
    yield ']}';
  } else yield* splitText(text);
}
export async function putVerified(bucket,key,text) {
  const hash=await sha256(text);
  const old=await bucket.get(key);
  if(old) { if(await sha256(await old.text())!==hash) throw new Error('保存内容の競合を検出しました。');return {key,sha256:hash,bytes:encoder.encode(text).length}; }
  const saved=await bucket.put(key,text,{sha256:hash,onlyIf:new Headers({'If-None-Match':'*'}),httpMetadata:{contentType:'text/plain; charset=utf-8'}});
  const check=await bucket.get(key);
  if(!check || await sha256(await check.text())!==hash) throw new Error('バックアップの照合に失敗しました。');
  return {key,sha256:hash,bytes:encoder.encode(text).length};
}
export async function writeObject(bucket,key,text,kind,season) {
  let segments;
  if(typeof text==='string') {
    if(text.length<BLOCK_CHARS*2) return putVerified(bucket,key,text);
    segments=objectSegments(text,kind);
  } else {
    if(kind!=='summary' || !text || typeof text!=='object') throw new Error('保存内容が不正です。');
    // Inspect a bounded prefix to keep the existing small-object representation.
    const remaining=objectSegments(text,kind), prefix=[];let chars=0, done=false;
    while(chars<BLOCK_CHARS*2) { const next=remaining.next();if(next.done){done=true;break;}prefix.push(next.value);chars+=next.value.length; }
    if(done) return putVerified(bucket,key,JSON.stringify(text));
    segments=(function*(){yield* prefix;yield* remaining;})();
  }
  const parts=[];let bytes=0;
  for(const segment of segments) {
    const rawHash=await sha256(segment), compressed=await compressText(segment), hash=await sha256(compressed);
    const block=await putVerified(bucket,`datasets/v3/${season}/blocks/${hash}.gz.b64`,compressed);
    // A read-back must also decompress to the exact original bytes before staging.
    if(await sha256(await decompressText(await (await bucket.get(block.key)).text()))!==rawHash) throw new Error('圧縮データを復元できません。');
    const rawBytes=encoder.encode(segment).length;bytes+=rawBytes;
    parts.push({...block,rawSha256:rawHash,rawBytes});
  }
  const manifest={format:'tohto-chunks-v1',kind,season,bytes,parts};
  const ref=await putVerified(bucket,key+'.manifest.json',JSON.stringify(manifest));
  return {...ref,format:manifest.format,contentBytes:bytes};
}
export async function readManifest(bucket,ref) {
  const obj=await bucket.get(ref.key);if(!obj) throw new Error('保存版が欠けています。');
  const text=await obj.text();if(await sha256(text)!==ref.sha256) throw new Error('保存版が破損しています。');
  const m=JSON.parse(text);
  if(m.format!=='tohto-chunks-v1'||!Array.isArray(m.parts)||!m.parts.length||!Number.isSafeInteger(m.bytes)||m.bytes<0 || !ref.key.startsWith(`datasets/v2/${m.season}/versions/`) || !ref.key.endsWith(`/${m.kind}.${['raw','input'].includes(m.kind)?'csv':'json'}.manifest.json`)) throw new Error('分割データの索引が不正です。');
  let bytes=0;
  for(const p of m.parts) {
    if(!digest(p.sha256)||!digest(p.rawSha256)||p.key!==`datasets/v3/${m.season}/blocks/${p.sha256}.gz.b64`||!Number.isSafeInteger(p.rawBytes)||p.rawBytes<0||p.rawBytes>BLOCK_CHARS*4+16) throw new Error('分割データの参照が不正です。');
    bytes+=p.rawBytes;
  }
  if(bytes!==m.bytes) throw new Error('分割データの容量が一致しません。');
  return m;
}
/** Checks stored compressed bytes AND the exact bytes that readers will receive. */
export async function verifyObject(bucket,ref) {
  if(!ref || !digest(ref.sha256)) throw new Error('保存版の照合値が不正です。');
  if(ref.format==='tohto-chunks-v1') {
    const m=await readManifest(bucket,ref);
    for(const part of m.parts) await verifyObject(bucket,part);
    return;
  }
  const raw = ref.rawSha256 !== undefined || ref.rawBytes !== undefined;
  if(raw && (!digest(ref.rawSha256) || !Number.isSafeInteger(ref.rawBytes) || ref.rawBytes<0 || ref.rawBytes>BLOCK_CHARS*4+16)) throw new Error('分割データの参照が不正です。');
  // Compressed blocks must be downloaded even when R2 provides their checksum.
  const obj=raw || !bucket.head ? await bucket.get(ref.key) : await bucket.head(ref.key);
  if(!obj) throw new Error('保存版が欠けています。');
  const checksum=obj.checksums?.sha256;
  let saved;
  if(raw || !checksum) {
    const body=obj.text?obj:await bucket.get(ref.key);
    if(!body) throw new Error('保存版が欠けています。');
    saved=await body.text(); // R2 response bodies are single-use.
  }
  const actual=saved!==undefined?await sha256(saved):[...new Uint8Array(checksum)].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(actual!==ref.sha256) throw new Error('保存版が破損しています。');
  if(raw) {
    const bytes=encoder.encode(await decompressText(saved));
    if(bytes.length!==ref.rawBytes || await sha256(bytes)!==ref.rawSha256) throw new Error('保存版の復元に失敗しました。');
  }
}
export async function objectReferences(bucket,ref) {
  if(ref.format!=='tohto-chunks-v1') return [ref];
  const m=await readManifest(bucket,ref);
  return [{key:ref.key,sha256:ref.sha256},...m.parts.map(p=>({key:p.key,sha256:p.sha256,rawSha256:p.rawSha256,rawBytes:p.rawBytes}))];
}
export async function openObject(bucket,ref) {
  if(!ref) throw new Error('保存版の参照がありません。');
  if(ref.format!=='tohto-chunks-v1') return bucket.get(ref.key);
  const manifest=await readManifest(bucket,ref);
  const makeStream=()=>{let index=0;return new ReadableStream({async pull(controller){
    if(index===manifest.parts.length){controller.close();return;}
    try {const p=manifest.parts[index++], obj=await bucket.get(p.key);if(!obj) throw new Error('分割データが欠けています。');
      const saved=await obj.text();if(await sha256(saved)!==p.sha256)throw new Error('保存版が破損しています。');
      const raw=await decompressText(saved), bytes=encoder.encode(raw);
      if(bytes.length!==p.rawBytes||await sha256(bytes)!==p.rawSha256)throw new Error('保存版の復元に失敗しました。');
      controller.enqueue(bytes);
    }catch(e){controller.error(e);}
  }});};
  const arrayBuffer=()=>new Response(makeStream()).arrayBuffer();
  const text=async()=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await arrayBuffer());
  return {get body(){return makeStream();},text,json:async()=>JSON.parse(await text()),arrayBuffer,size:manifest.bytes,chunked:true};
}
