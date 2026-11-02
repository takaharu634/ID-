import { Miniflare } from 'miniflare';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,'');
test('compiled ID東都 serves the same-origin studio and accepts its menu without changing public data access', {timeout:60000}, async()=>{
 const modules=(await fs.readdir(root+'/dist/server',{recursive:true})).filter(f=>f.endsWith('.js')).map(f=>({type:'ESModule',path:root+'/dist/server/'+f})).sort((a,b)=>Number(b.path.endsWith('/server/index.js'))-Number(a.path.endsWith('/server/index.js')));
 const assets=async request=>{
  const pathname=new URL(request.url).pathname;
  if(!pathname.startsWith('/trajectory-studio/'))return new Response(null,{status:404});
  try {const bytes=await fs.readFile(root+'/dist/client'+pathname);const type=pathname.endsWith('.html')?'text/html; charset=utf-8':pathname.endsWith('.json')?'application/json':pathname.endsWith('.js')?'text/javascript':'application/octet-stream';return new Response(bytes,{headers:{'content-type':type}});}
  catch{return new Response(null,{status:404});}
 };
 const mf=new Miniflare({modules,compatibilityDate:'2026-05-01',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],r2Buckets:['BUCKET'],bindings:{ADMIN_EMAILS:'admin@example.test'},serviceBindings:{ASSETS:assets},port:0});
 try{
  const origin='http://test.local';
  for(const file of ['index.html?embedded=1&season=2026-fall','studio_controller.js','selection.js','scene.js','baseball.js','diagnostics.js','validation.js','embedded.js','NotoSansJP.woff2']){
   const res=await mf.dispatchFetch(origin+'/trajectory-studio/'+file);assert.equal(res.status,200,file);
   assert.deepEqual(Buffer.from(await res.arrayBuffer()),await fs.readFile(root+'/public/trajectory-studio/'+file.split('?')[0]),file);
  }
  const html=await fs.readFile(root+'/public/trajectory-studio/index.html','utf8');
  const catalog=JSON.parse(html.match(/<script>const DATA=([\s\S]*?);<\/script>/)[1]);
  for(const season of catalog.seasons){
   const path=season.pitchers[0].dataUrl;
   const res=await mf.dispatchFetch(origin+'/trajectory-studio/'+path);assert.equal(res.status,200);
   const payload=await res.json();assert.equal(payload.seasonId,season.id);assert.equal(payload.id,season.pitchers[0].id);assert(Array.isArray(payload.pitches));
   const summary=await mf.dispatchFetch(origin+'/api/dataset?season='+season.id);assert.equal(summary.status,204);assert.equal(summary.headers.get('x-dataset-season'),season.id);
  }
  const db=await mf.getD1Database('DB');await db.prepare(await fs.readFile(root+'/drizzle/0003_elite_spirit.sql','utf8')).run();
  const result=await mf.dispatchFetch(origin+'/api/usage',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({feature:'trajectory'})});assert.equal(result.status,204);
  assert.equal((await mf.dispatchFetch(origin+'/api/usage')).status,401);
 }finally{await mf.dispose();}
});
