// Compact, content-addressed source assets; public JSON is reconstructed at build time.
import { readFile, writeFile, mkdir, readdir, access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const blockBytes=4*1024*1024;
const allowed=name=>/^(?:initial-data|(?:season|spin)-[1-9]\d{3}-(?:spring|fall))\.json$/.test(name);
export async function packBundled(source='public/data',archive='data/bundled') {
  await mkdir(join(archive,'blocks'),{recursive:true});
  const files=[];
  for(const name of (await readdir(source)).filter(allowed).sort()) {
    const data=await readFile(join(source,name)),parts=[];
    for(let offset=0;offset<data.length;offset+=blockBytes) {
      const raw=data.subarray(offset,offset+blockBytes),compressed=gzipSync(raw,{level:9}),sha256=hash(compressed),key=`blocks/${sha256}.gz`;
      try {const existing=await readFile(join(archive,key));if(hash(existing)!==sha256)throw new Error('Bundled block is corrupt');}
      catch(e) {if(e.code!=='ENOENT')throw e;await writeFile(join(archive,key),compressed,{flag:'wx'});}
      parts.push({key,sha256,rawBytes:raw.length});
    }
    files.push({name,bytes:data.length,sha256:hash(data),parts});
  }
  if(!files.length)throw new Error('No bundled datasets');
  const manifest={format:'tohto-bundled-v1',blockBytes,files};
  await writeFile(join(archive,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  const referenced=new Set(files.flatMap(f=>f.parts.map(p=>p.key.slice(7))));
  for(const name of await readdir(join(archive,'blocks')))if(/^[a-f0-9]{64}\.gz$/.test(name)&&!referenced.has(name))await rm(join(archive,'blocks',name));
  return manifest;
}
export async function restoreBundled(archive='data/bundled',destination='public/data') {
  let manifest;
  try {manifest=JSON.parse(await readFile(join(archive,'manifest.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return;throw e;}
  if(manifest.format!=='tohto-bundled-v1'||!Array.isArray(manifest.files))throw new Error('Invalid bundled manifest');
  await mkdir(destination,{recursive:true});
  for(const file of manifest.files) {
    if(!allowed(file.name))throw new Error('Invalid bundled filename');
    const target=join(destination,file.name);
    // Keep explicit local edits. prepare-data repacks these before source publication.
    try {await access(target);continue;}catch(e){if(e.code!=='ENOENT')throw e;}
    const chunks=[];
    for(const part of file.parts) {
      if(!/^[a-f0-9]{64}$/.test(part.sha256)||part.key!==`blocks/${part.sha256}.gz`||part.rawBytes>blockBytes)throw new Error('Invalid bundled block');
      const compressed=await readFile(join(archive,part.key));if(hash(compressed)!==part.sha256)throw new Error('Bundled checksum mismatch');
      const raw=gunzipSync(compressed,{maxOutputLength:blockBytes});if(raw.length!==part.rawBytes)throw new Error('Bundled size mismatch');chunks.push(raw);
    }
    const data=Buffer.concat(chunks);if(data.length!==file.bytes||hash(data)!==file.sha256)throw new Error('Bundled restoration failed');
    await writeFile(target,data,{flag:'wx'});
  }
}
