import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { verifyArchive, unpackObject, recoverySql, hash } from './archive.mjs';
import { restorableKey } from '../../server/backup-service.mjs';
const [mode, input, output] = process.argv.slice(2);
if (!['verify','extract'].includes(mode) || !input || mode === 'extract' && !output) throw new Error('Usage: node tools/backup/restore.mjs verify <archive> | extract <archive> <new-output-directory>');
const root = resolve(input), { manifest, stats } = await verifyArchive(root);
if (mode === 'extract') {
  const destination = resolve(output);
  await mkdir(destination); // Refuse an existing output to avoid overwriting user files.
  for (const object of manifest.objects) {
    const path = join(destination,...object.key.split('/')); await mkdir(resolve(path,'..'),{recursive:true}); await writeFile(path,await unpackObject(root,object),{flag:'wx'});
  }
  // Recent descriptors normally live only in the mutable head; recover them as
  // immutable archive entries so existing admin verification can discover them.
  const versions=new Map();
  const recovered = new Map(manifest.objects.filter(o=>restorableKey(o.key)).map(o=>[o.key,o]));
  for (const object of manifest.objects.filter(o=>/^datasets\/v2\/[^/]+\/head\.json$/.test(o.key))) {
    const head=JSON.parse(await unpackObject(root,object));
    for (const snapshot of head.versions || []) {
      versions.set(`${snapshot.season}/${snapshot.id}`,snapshot);
      if (!/^[1-9]\d{3}-(spring|fall)$/.test(snapshot.season || '') || !/^[a-f0-9-]{36}$/.test(snapshot.id || '') || !Number.isFinite(Date.parse(snapshot.createdAt))) throw new Error('Invalid recoverable descriptor');
      const raw=Buffer.from(JSON.stringify(snapshot));
      const keys=[`datasets/v3/${snapshot.season}/versions/${snapshot.id}.json`,`datasets/v3/${snapshot.season}/history/${String(9999999999999-Date.parse(snapshot.createdAt)).padStart(13,'0')}-${snapshot.id}.json`];
      for (const key of keys) {
        const existing=recovered.get(key);
        if (existing && existing.sha256!==hash(raw)) throw new Error('Conflicting backup descriptors');
        if (!existing) { const path=join(destination,...key.split('/')); await mkdir(resolve(path,'..'),{recursive:true}); await writeFile(path,raw,{flag:'wx'}); recovered.set(key,{key,sha256:hash(raw),bytes:raw.length}); }
      }
    }
  }
  for (const object of manifest.objects.filter(o=>/^datasets\/v3\/[^/]+\/versions\/[^/]+\.json$/.test(o.key))) {
    const snapshot=JSON.parse(await unpackObject(root,object)); versions.set(`${snapshot.season}/${snapshot.id}`,snapshot);
  }
  for (const snapshot of versions.values()) if (!/^[1-9]\d{3}-(spring|fall)$/.test(snapshot.season||'') || !/^[a-f0-9-]{36}$/.test(snapshot.id||'') || !Number.isFinite(Date.parse(snapshot.createdAt)) || !Number.isSafeInteger(snapshot.pitchCount) || snapshot.pitchCount<0) throw new Error('Invalid recovery candidate');
  await writeFile(join(destination,'database-missing-only.sql'),recoverySql(manifest));
  await writeFile(join(destination,'restore-plan.json'),JSON.stringify({
    instructions:'管理者として /api/backup/restore に PUT し、不足分を保存します。head は切り替えません。最後に管理画面の保存履歴から対象版を選んで復元します。',
    versions:[...versions.values()].map(({season,id,fileName,createdAt,pitchCount})=>({season,id,fileName:fileName||id,createdAt,pitchCount})).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))),
    endpoint:'/api/backup/restore', method:'PUT', activeHeadChanged:false,
    objects:[...recovered.values()].map(({key,sha256,bytes})=>({key,headers:{'x-content-sha256':sha256,'x-content-bytes':String(bytes)}})),
    excluded:manifest.objects.filter(o=>!restorableKey(o.key)).map(o=>o.key),
    recoveryNote:'直近の保存版も不変記述子として復旧対象に含みます。公開切替は管理画面の保存履歴から行い、/api/upload action=restore の検証を経ます。',
  },null,2));
}
console.log(JSON.stringify({verified:true,...stats, ...(output?{output:resolve(output)}:{})}));
