import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { packBundled, restoreBundled } from '../../scripts/bundled-data.mjs';
test('a clean checkout regenerates exact large season assets from compressed blocks and refuses damaged source',async()=>{
  const root=await mkdtemp(join(tmpdir(),'tohto-bundled-'));
  try {
    const source=join(root,'source'),archive=join(root,'archive'),output=join(root,'output');await mkdir(source);
    const bytes=Buffer.from('\uFEFF'+JSON.stringify({name:'原本',values:Array.from({length:200000},(_,i)=>[i,'日本語😀'])}));
    await writeFile(join(source,'season-2050-spring.json'),bytes);
    const a=await packBundled(source,archive);assert.ok(a.files[0].parts.length>1);
    const before=await readFile(join(archive,'manifest.json'));await packBundled(source,archive);assert.deepEqual(await readFile(join(archive,'manifest.json')),before);
    await restoreBundled(archive,output);assert.deepEqual(await readFile(join(output,'season-2050-spring.json')),bytes);
    await writeFile(join(archive,a.files[0].parts[0].key),'broken');
    await assert.rejects(()=>restoreBundled(archive,join(root,'corrupt')),/checksum/);
  }finally{await rm(root,{recursive:true,force:true});}
});
