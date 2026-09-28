import {Miniflare} from 'miniflare';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const root=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,'');
test('compiled Workers API preserves authorization, stores real data and restores every original byte', {timeout:120000}, async()=>{
const modules=(await fs.readdir(root+'/dist/server',{recursive:true})).filter(f=>f.endsWith('.js')).map(f=>({type:'ESModule',path:root+'/dist/server/'+f})).sort((a,b)=>Number(b.path.endsWith('/server/index.js'))-Number(a.path.endsWith('/server/index.js')));
const mf=new Miniflare({modules,compatibilityDate:'2026-05-01',compatibilityFlags:['nodejs_compat'],r2Buckets:['BUCKET'],bindings:{ADMIN_EMAILS:'admin@example.test'},serviceBindings:{ASSETS:async request=>{try{const p=new URL(request.url).pathname;return new Response(await fs.readFile(root+'/public'+p));}catch{return new Response(null,{status:404});}}},port:0});
try {
 for(const path of ['/api/upload','/api/imports','/api/import-storage?key=datasets/v2/2026-fall/head.json','/api/dataset?format=csv']) {
  const method=path==='/api/upload'?'POST':'GET';
  const anonymous=await mf.dispatchFetch('http://test.local'+path,{method});assert.equal(anonymous.status,401,path);
  const other=await mf.dispatchFetch('http://test.local'+path,{method,headers:{'oai-authenticated-user-email':'other@example.test'}});assert.equal(other.status,403,path);
 }
 console.log('All data administration endpoints reject anonymous and non-admin requests');
 const page=await mf.dispatchFetch('http://test.local/admin');assert.equal(page.status,200);assert.match(await page.text(),/signin-with-chatgpt/);console.log('Login entry renders');
 const logged=await mf.dispatchFetch('http://test.local/admin',{headers:{'oai-authenticated-user-email':'admin@example.test'}});assert.equal(logged.status,200);assert.match(await logged.text(),/CSVデータ管理/);console.log('Authorized admin page renders');
 const publicData=await mf.dispatchFetch('http://test.local/api/dataset?season=2026-fall');assert.equal(publicData.status,204);
 console.log('Uninitialized per-season dataset explicitly returns 204');
 const {prepareImport}=await import(root+'/server/import-service.mjs');
 const {csvRows,encodeCsv}=await import(root+'/lib/import-validation.mjs');
 const headers={'oai-authenticated-user-email':'admin@example.test'};
 const adapter={
  get:async key=>{const r=await mf.dispatchFetch('http://test.local/api/import-storage?key='+encodeURIComponent(key),{headers});if(r.status===404)return null;assert.equal(r.status,200);return {etag:r.headers.get('etag'),text:async()=>new TextDecoder('utf-8',{ignoreBOM:true}).decode(await r.arrayBuffer()),json:()=>r.json()};},
  put:async(key,text,options)=>{const r=await mf.dispatchFetch('http://test.local/api/import-storage?key='+encodeURIComponent(key),{method:'PUT',headers:{...headers,'x-content-sha256':options.sha256,'x-content-bytes':String(Buffer.byteLength(text)),'content-type':'text/plain'},body:text});assert.equal(r.status,200,await r.clone().text());return r.json();}
 };
 const season='2026-spring',raw=await fs.readFile(root+'/data/raw/season-2026-spring.csv','utf8'),parsed=csvRows(raw);
 const row={...parsed.rows.at(-1),PitchUID:crypto.randomUUID(),PitchNo:'9999'};if(!row.Date)row.Date=parsed.rows.find(r=>r.GameUID===row.GameUID&&r.Date).Date;
 const baseline={raw,summary:await fs.readFile(root+'/public/data/season-2026-spring.json','utf8'),spin:await fs.readFile(root+'/public/data/spin-2026-spring.json','utf8')};
 const stage=await prepareImport(adapter,encodeCsv(parsed.headers,[row]),'isolated-test.csv',async()=>baseline);assert.equal(stage.report.addedRows,1);
 const requestAction=async body=>{for(let attempt=0;attempt<100;attempt++){const r=await mf.dispatchFetch('http://test.local/api/upload',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(body)});if(r.status!==202)return r;await r.text();}assert.fail('verification did not finish');};
 const commit=await requestAction({action:'commit',id:stage.id,acknowledgeWarnings:true});assert.equal(commit.status,200,await commit.clone().text());
 const current=await mf.dispatchFetch('http://test.local/api/dataset?season='+season);const value=await current.json();assert.equal(value.pitches.length,11944);console.log('Real 11,943-pitch spring baseline + one test pitch committed through compiled API');
 const history=await (await mf.dispatchFetch('http://test.local/api/imports',{headers})).json();assert.equal(history.imports.length,2);const original=history.imports.find(v=>!v.isActive);
 const restore=await requestAction({action:'restore',id:original.id,season,expectedActive:stage.id});assert.equal(restore.status,200,await restore.clone().text());
 const restored=await mf.dispatchFetch('http://test.local/api/dataset?season='+season+'&format=csv',{headers});assert.deepEqual(Buffer.from(await restored.arrayBuffer()),Buffer.from(raw));console.log('Restore returns original CSV byte-for-byte; production data was never used or changed');
 const future={...row,Date:'2035-05-01',GameUID:'future-game',PitchUID:crypto.randomUUID()};
 const next=await prepareImport(adapter,encodeCsv(parsed.headers,[future]),'future.csv',async()=>({raw:'',summary:'',spin:'[]'}));
 assert.equal((await requestAction({action:'commit',id:next.id,acknowledgeWarnings:true})).status,200);
 const catalog=await (await mf.dispatchFetch('http://test.local/api/seasons')).json();assert.equal(catalog.latest,'2035-spring');
 const futureData=await (await mf.dispatchFetch('http://test.local/api/dataset?season=2035-spring')).json();assert.equal(futureData.pitches.length,1);
 assert.equal((await mf.dispatchFetch('http://test.local/api/dataset?season=2035-spring&format=csv')).status,401);
 console.log('Future season appears automatically without build/deploy; raw data remains private');
}finally{await mf.dispose();}

});
