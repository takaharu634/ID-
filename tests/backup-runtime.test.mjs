import { Miniflare } from 'miniflare';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
const root=fileURLToPath(new URL('..',import.meta.url)).replace(/\/$/,'');
const sha=value=>createHash('sha256').update(value).digest('hex');
test('compiled backup recovery streams verified bytes and restores a missing future season only after explicit activation',{timeout:60000},async()=>{
 const modules=(await fs.readdir(root+'/dist/server',{recursive:true})).filter(f=>f.endsWith('.js')).map(f=>({type:'ESModule',path:root+'/dist/server/'+f})).sort((a,b)=>Number(b.path.endsWith('/server/index.js'))-Number(a.path.endsWith('/server/index.js')));
 const mf=new Miniflare({modules,compatibilityDate:'2026-05-01',compatibilityFlags:['nodejs_compat'],r2Buckets:['BUCKET'],d1Databases:['DB'],bindings:{ADMIN_EMAILS:'admin@example.test'},serviceBindings:{ASSETS:async()=>new Response(null,{status:404})},port:0});
 try{
  const headers={'oai-authenticated-user-email':'admin@example.test'},id=crypto.randomUUID(),season='2042-spring',key=kind=>`datasets/v2/${season}/versions/${id}/${kind}.${kind==='raw'?'csv':'json'}`;
  const put=(path,value,overrides={})=>mf.dispatchFetch('http://test.local/api/backup/restore?key='+encodeURIComponent(path),{method:'PUT',body:value,headers:{...headers,'x-content-sha256':sha(value),'x-content-bytes':String(Buffer.byteLength(value)),...overrides}});
  const denied=await mf.dispatchFetch('http://test.local/api/backup/restore?key='+encodeURIComponent(key('raw')),{method:'PUT',body:'x'});assert.equal(denied.status,401);
  assert.equal((await mf.dispatchFetch('http://test.local/api/backup/export')).status,401);
  assert.equal((await mf.dispatchFetch('http://test.local/api/backup/export',{headers})).status,401,'interactive admin cannot impersonate backup OIDC');
  const page=await mf.dispatchFetch('http://test.local/admin/recovery',{headers});assert.equal(page.status,200);assert.match(await page.text(),/外部バックアップの復旧/);
  const raw='PitchUID,Date,選手\r\nテスト,2042-04-01,日本語\r\n';
  const corrupt=await put(key('raw'),raw,{'x-content-sha256':'0'.repeat(64)});assert.equal(corrupt.status,503);
  const bucket=await mf.getR2Bucket('BUCKET');assert.equal(await bucket.get(key('raw')),null);
  assert.equal((await put(key('raw'),raw,{'x-content-bytes':String(Buffer.byteLength(raw)-1)})).status,503);assert.equal(await bucket.get(key('raw')),null);
  const snapshot={id,season,createdAt:new Date().toISOString(),fileName:'復旧.csv',pitchCount:1,gameCount:1,report:{warnings:[]},objects:{}};
  for(const [kind,value]of Object.entries({raw,summary:JSON.stringify({metadata:{pitches:1},pitches:[{id:'p1'}]}),spin:'[]'})){
    const response=await put(key(kind),value);assert.equal(response.status,200,await response.text());snapshot.objects[kind]={key:key(kind),sha256:sha(value),bytes:Buffer.byteLength(value)};
  }
  assert.equal((await put(key('raw'),raw)).status,200);
  assert.equal((await put(key('raw'),'different')).status,409);
  assert.equal((await put(`datasets/v2/${season}/head.json`,'{}')).status,400);
  assert.equal((await put(`datasets/v3/${season}/versions/${id}.json`,JSON.stringify(snapshot))).status,200);
  assert.equal((await mf.dispatchFetch(`http://test.local/api/dataset?season=${season}`)).status,204);
  const activation=await mf.dispatchFetch('http://test.local/api/upload',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({action:'restore',season,id,expectedActive:null})});assert.equal(activation.status,200,await activation.text());
  const restored=await mf.dispatchFetch(`http://test.local/api/dataset?season=${season}&format=csv`,{headers});assert.equal(restored.status,200);assert.deepEqual(Buffer.from(await restored.arrayBuffer()),Buffer.from(raw));
  const catalog=await(await mf.dispatchFetch('http://test.local/api/seasons')).json();assert.ok(catalog.seasons.some(s=>s.key===season));
 }finally{await mf.dispose();}
});

// Exercise native Workers fetch, including options validation, without external DNS.
test('Workers OIDC fetch accepts manual redirect mode, rejects 302 and verifies signed identity',{timeout:30000},async()=>{
 const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const jwk={...publicKey.export({format:'jwk'}),kid:'isolated-runtime-key',alg:'RS256',use:'sig'},seconds=Math.floor(Date.now()/1000);
 const env={BACKUP_OIDC_ENABLED:'true',BACKUP_GITHUB_REPOSITORY_ID:'1380720373',BACKUP_GITHUB_OWNER_ID:'319011362',BACKUP_GITHUB_BRANCH:'main',BACKUP_OIDC_AUDIENCE:'https://test.local/api/backup/export',BACKUP_OIDC_SUBJECT:'repo:takaharu634@319011362/ID-touto-@1380720373:ref:refs/heads/main'};
 const claims={iss:'https://token.actions.githubusercontent.com',aud:env.BACKUP_OIDC_AUDIENCE,sub:env.BACKUP_OIDC_SUBJECT,repository_id:env.BACKUP_GITHUB_REPOSITORY_ID,repository_owner_id:env.BACKUP_GITHUB_OWNER_ID,repository:'takaharu634/ID-touto-',repository_visibility:'private',ref:'refs/heads/main',ref_type:'branch',workflow_ref:'takaharu634/ID-touto-/.github/workflows/backup-datasets.yml@refs/heads/main',event_name:'push',runner_environment:'github-hosted',iat:seconds,nbf:seconds-300,exp:seconds+300};
 const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
 const input=`${encode({alg:'RS256',kid:jwk.kid})}.${encode(claims)}`,token=`${input}.${sign('RSA-SHA256',Buffer.from(input),privateKey).toString('base64url')}`;
 let redirect=true,calls=0;
 const mf=new Miniflare({modules:[{type:'ESModule',path:root+'/server/backup-test-entry.mjs',contents:"import {backupExportGuard} from './backup-auth.mjs'; export default {async fetch(request,env){return await backupExportGuard(request,env)||Response.json({verified:true});}};"},{type:'ESModule',path:root+'/server/backup-auth.mjs',contents:await fs.readFile(root+'/server/backup-auth.mjs','utf8')}],compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],bindings:env,outboundService:async request=>{
   calls++;assert.equal(request.url,'https://token.actions.githubusercontent.com/.well-known/jwks');
   return redirect?new Response(null,{status:302,headers:{location:'https://untrusted.test/jwks'}}):Response.json({keys:[jwk]});
 },port:0});
 try{
  const headers={authorization:`Bearer ${token}`};
  assert.equal((await mf.dispatchFetch('https://test.local/api/backup/export',{headers})).status,401);
  assert.equal(calls,1,'redirect must not be followed');redirect=false;
  const valid=await mf.dispatchFetch('https://test.local/api/backup/export',{headers});assert.equal(valid.status,200,await valid.text());assert.equal(calls,2);
 }finally{await mf.dispose();}
});
