import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { verifyBackupToken, backupExportGuard } from '../../server/backup-auth.mjs';
import { backupExportResponse, backupRestoreResponse, BACKUP_TABLES, restorableKey } from '../../server/backup-service.mjs';
import { createArchive, verifyArchive, hash } from '../../tools/backup/archive.mjs';
const env={BACKUP_OIDC_ENABLED:'true',BACKUP_GITHUB_REPOSITORY_ID:'1380720373',BACKUP_GITHUB_OWNER_ID:'319011362',BACKUP_GITHUB_BRANCH:'main',BACKUP_OIDC_AUDIENCE:'https://example.test/api/backup/export',BACKUP_OIDC_SUBJECT:'repo:takaharu634@319011362/ID-touto-@1380720373:ref:refs/heads/main'};
const now=Date.now(), sec=Math.floor(now/1000), pair=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...pair.publicKey.export({format:'jwk'}),kid:'test-key',alg:'RS256',use:'sig'};
const claims={iss:'https://token.actions.githubusercontent.com',aud:env.BACKUP_OIDC_AUDIENCE,sub:env.BACKUP_OIDC_SUBJECT,repository_id:env.BACKUP_GITHUB_REPOSITORY_ID,repository_owner_id:env.BACKUP_GITHUB_OWNER_ID,repository:'takaharu634/ID-touto-',repository_visibility:'private',ref:'refs/heads/main',ref_type:'branch',workflow_ref:'takaharu634/ID-touto-/.github/workflows/backup-datasets.yml@refs/heads/main',event_name:'schedule',runner_environment:'github-hosted',exp:sec+300,iat:sec,nbf:sec,run_id:'123'};
const jwt=(patch={},head={})=>{const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');const input=`${encode({alg:'RS256',kid:'test-key',...head})}.${encode({...claims,...patch})}`;return `${input}.${sign('RSA-SHA256',Buffer.from(input),pair.privateKey).toString('base64url')}`;};
test('backup OIDC accepts only signed pinned private main workflow identity',async()=>{
  assert.equal((await verifyBackupToken(jwt(),env,{now,jwks:[jwk]})).repositoryId,'1380720373');
  for(const patch of [{aud:'other'},{sub:'repo:other/main'},{repository_id:'2'},{repository_owner_id:'3'},{repository:'other/repo'},{repository_visibility:'public'},{ref:'refs/pull/1/merge'},{ref_type:'tag'},{workflow_ref:'takaharu634/ID-touto-/.github/workflows/ci.yml@refs/heads/main'},{event_name:'pull_request'},{runner_environment:'self-hosted'},{exp:sec-1},{iat:sec+60},{nbf:sec+60},{iat:sec-1000},{exp:sec+1000}]) await assert.rejects(verifyBackupToken(jwt(patch),env,{now,jwks:[jwk]}));
  await assert.rejects(verifyBackupToken(jwt({}, {alg:'HS256'}),env,{now,jwks:[jwk]}));
  await assert.rejects(verifyBackupToken(jwt(),{...env,BACKUP_OIDC_ENABLED:'false'},{now,jwks:[jwk]}));
  const altered=jwt().split('.');altered[2]=Buffer.alloc(256).toString('base64url');await assert.rejects(verifyBackupToken(altered.join('.'),env,{now,jwks:[jwk]}));
});
test('backup auth fails closed and JWKS rotation uses fixed trusted endpoint',async()=>{
  const denied=await backupExportGuard(new Request('https://x.test'),env);assert.equal(denied.status,401);assert.equal(denied.headers.get('cache-control'),'no-store');
  let url;await verifyBackupToken(jwt(),env,{now,fetcher:async (u,options)=>{url=u;assert.equal(options.redirect,'manual');return Response.json({keys:[jwk]});}});assert.equal(url,'https://token.actions.githubusercontent.com/.well-known/jwks');
  await assert.rejects(verifyBackupToken(jwt({}, {kid:'rotated'}),env,{now,fetcher:async()=>Response.json({keys:[]})}));
  await assert.rejects(verifyBackupToken(jwt({}, {kid:'redirected'}),env,{now,fetcher:async(u,options)=>{assert.equal(u,'https://token.actions.githubusercontent.com/.well-known/jwks');assert.equal(options.redirect,'manual');return new Response(null,{status:302,headers:{location:'https://other.test/jwks'}});}}));
});
class Bucket{
  constructor(entries=[]){this.map=new Map(entries.map(([key,value])=>[key,Buffer.from(value)]));this.writes=[];}
  async get(key,options){const b=this.map.get(key);if(!b)return null;const etag=hash(b);if(options?.onlyIf?.etagMatches&&options.onlyIf.etagMatches!==etag)return {etag,size:b.length};return {key,etag,size:b.length,checksums:{sha256:Uint8Array.from(Buffer.from(etag,'hex')).buffer},body:new Blob([b]).stream(),arrayBuffer:async()=>Uint8Array.from(b).buffer,text:async()=>b.toString(),json:async()=>JSON.parse(b)};}
  async put(key,value,options={}){const bytes=Buffer.from(value instanceof ReadableStream?await new Response(value).arrayBuffer():value);if(options.sha256&&hash(bytes)!==options.sha256)throw new Error('Checksum mismatch');if(options.onlyIf&&this.map.has(key))return null;this.map.set(key,bytes);this.writes.push(key);return this.get(key);}
  async list({prefix,cursor,limit}){const all=[...this.map].filter(([key])=>key.startsWith(prefix)).sort(([a],[b])=>a.localeCompare(b));const start=Number(cursor||0),rows=all.slice(start,start+limit);return{objects:rows.map(([key,b])=>({key,size:b.length,etag:hash(b),uploaded:new Date(0)})),truncated:start+limit<all.length,cursor:String(start+limit)};}
}
const allow=async()=>null;
const id='11111111-1111-4111-8111-111111111111',season='2041-spring',rawKey=`datasets/v2/${season}/versions/${id}/raw.csv`;
test('export is read-only, ETag consistent and excludes private auth database/prefixes',async()=>{
 const bucket=new Bucket([[rawKey,'csv'],['import-jobs/private/a','private'],['config/token','secret']]);
 const db={prepare(sql){assert.match(sql,/^SELECT id,name,completed_at,fingerprint FROM trackman_push_files WHERE id > \? ORDER BY id LIMIT 500$/);return{bind(){return{all:async()=>({results:[{id:'a',name:'game',completed_at:1,fingerprint:'f',token_hash:'secret'}]})};}};}};
 const storage={BUCKET:bucket,DB:db};
 const call=params=>backupExportResponse(new Request(`https://x.test/api/backup/export?${new URLSearchParams(params)}`),storage,allow);
 const page=await (await call({})).json();assert.deepEqual(page.objects.map(x=>x.key),[rawKey]);
 assert.equal((await call({mode:'object',key:'config/token',etag:'x'})).status,400);
 assert.equal((await call({mode:'object',key:rawKey,etag:'outdated'})).status,412);
 assert.equal(await (await call({mode:'object',key:rawKey,etag:hash('csv')})).text(),'csv');
 assert.equal((await call({mode:'database',table:'trackman_push_channels'})).status,400);
 assert.equal((await call({mode:'database',table:'__proto__'})).status,400);
 const table=await (await call({mode:'database',table:'trackman_push_files'})).json();assert.equal(table.rows[0].token_hash,undefined);
 const usage=await (await call({mode:'usage',scope:'import-jobs/'})).json();assert.equal(usage.bytes,7);assert.equal(usage.objects,1);assert.equal(usage.key,undefined);
 assert.equal((await backupExportResponse(new Request('https://x.test',{method:'POST'}),storage,allow)).status,405);assert.equal(bucket.writes.length,0);
});
// Runtime FixedLengthStream contract reproduced without buffering in the handler.
globalThis.FixedLengthStream=class{constructor(length){let seen=0;const stream=new TransformStream({transform(chunk,controller){seen+=chunk.length;if(seen>length)throw new Error('Length overflow');controller.enqueue(chunk);},flush(){if(seen!==length)throw new Error('Length mismatch');}});this.readable=stream.readable;this.writable=stream.writable;}};
const restoreRequest=(key,value='csv',extra={})=>new Request(`https://x.test/api/backup/restore?key=${encodeURIComponent(key)}`,{method:'PUT',headers:{'x-content-sha256':hash(value),'x-content-bytes':String(Buffer.byteLength(value)),...extra},body:value});
test('restore checks auth/origin/hash/length, refuses heads and never overwrites or activates',async()=>{
 const bucket=new Bucket(),storage={BUCKET:bucket};
 assert.equal((await backupRestoreResponse(restoreRequest(rawKey),storage,()=>new Response(null,{status:403}))).status,403);
 assert.equal((await backupRestoreResponse(restoreRequest(rawKey,'csv',{origin:'https://other.test'}),storage,()=>null)).status,403);
 assert.equal((await backupRestoreResponse(restoreRequest(`datasets/v2/${season}/head.json`),storage,()=>null)).status,400);
 assert.equal((await backupRestoreResponse(restoreRequest('datasets/v3/verification/x.json'),storage,()=>null)).status,400);
 assert.equal((await backupRestoreResponse(restoreRequest(rawKey,'csv',{'x-content-sha256':'0'.repeat(64)}),storage,()=>null)).status,503);assert.equal(bucket.map.size,0);
 assert.equal((await backupRestoreResponse(restoreRequest(rawKey,'csv',{'x-content-bytes':'2'}),storage,()=>null)).status,503);assert.equal(bucket.map.size,0);
 const result=await backupRestoreResponse(restoreRequest(rawKey),storage,()=>null);assert.equal(result.status,200);assert.equal((await result.json()).activeHeadChanged,false);
 assert.equal((await backupRestoreResponse(restoreRequest(rawKey),storage,()=>null)).status,200);assert.equal(bucket.writes.length,1);
 assert.equal((await backupRestoreResponse(restoreRequest(rawKey,'different'),storage,()=>null)).status,409);assert.equal(await(await bucket.get(rawKey)).text(),'csv');
 for(const key of ['../x','datasets/v2/../head.json','datasets/v3/verification/x.json',`datasets/v2/${season}/head.json`])assert.equal(restorableKey(key),false);
});
function fixture(){
 const bucket=new Bucket([[rawKey,'pitch CSV'],[`datasets/v2/${season}/versions/${id}/summary.json`,'{"pitches":[]}'],[`datasets/v2/${season}/versions/${id}/spin.json`,'[]']]);
 const objects=Object.fromEntries([...bucket.map].map(([key,b])=>[key.split('/').at(-1).split('.')[0],{key,sha256:hash(b),bytes:b.length}]));
 const snapshot={season,id,createdAt:'2041-04-01T00:00:00.000Z',fileName:'春.csv',pitchCount:1,gameCount:1,objects,report:{warnings:[]}};
 bucket.map.set(`datasets/v2/${season}/head.json`,Buffer.from(JSON.stringify({season,active:id,versions:[snapshot]})));
 const api=async(params,binary)=>{const response=await backupExportResponse(new Request(`https://x.test/?${new URLSearchParams(params)}`),{BUCKET:bucket,DB:{prepare(sql){const table=sql.includes('data_imports')?'data_imports':'trackman_push_files';return{bind(){return{all:async()=>({results:table==='data_imports'?[{id:'test',file_name:"a'; DROP TABLE x;--",uploaded_at:'today',uploaded_by:'admin',raw_object_key:rawKey,summary_object_key:'s',pitch_count:1,game_count:1,team_count:2,is_active:1}]:[]})};}};}}},allow);if(!response.ok)throw new Error('API failed');return binary?response.arrayBuffer():response.json();};
 return{bucket,api};
}
test('backup is independently restorable after deleting prior archive and safely recovers future head descriptors',async()=>{
 const root=await mkdtemp(join(tmpdir(),'tohto-backup-test-'));try{
 const {api}=fixture(),first=join(root,'first'),second=join(root,'second');
 const one=await createArchive({root:first,api});assert.equal(one.stats.objects,4);
 const two=await createArchive({root:second,previousRoot:first,api});assert.equal(two.manifest.reusedObjects,4);
 await rm(first,{recursive:true});assert.equal((await verifyArchive(second)).stats.objects,4);
 const out=join(root,'recovered');execFileSync(process.execPath,['tools/backup/restore.mjs','extract',second,out],{cwd:resolve(import.meta.dirname,'../..')});
 const plan=JSON.parse(await readFile(join(out,'restore-plan.json')));assert.equal(plan.versions[0].season,'2041-spring');assert.equal(plan.activeHeadChanged,false);
 assert.ok(plan.objects.some(x=>x.key===`datasets/v3/${season}/versions/${id}.json`));assert.ok(!plan.objects.some(x=>x.key.endsWith('/head.json')));
 const sql=await readFile(join(out,'database-missing-only.sql'),'utf8');assert.match(sql,/INSERT OR IGNORE/);assert.ok(sql.includes(Buffer.from("a'; DROP TABLE x;--").toString('hex')));assert.doesNotMatch(sql,/DROP TABLE/);assert.match(sql,/,0\);/);
 assert.equal(await readFile(join(out,rawKey),'utf8'),'pitch CSV');
 await assert.rejects(async()=>execFileSync(process.execPath,['tools/backup/restore.mjs','extract',second,out],{cwd:resolve(import.meta.dirname,'../..'),stdio:'pipe'}));
 }finally{await rm(root,{recursive:true});}
});
test('backup rejects torn captures, checksum corruption and missing referenced objects',async()=>{
 const root=await mkdtemp(join(tmpdir(),'tohto-backup-fault-'));try{
 const {api,bucket}=fixture();let scans=0;
 await assert.rejects(createArchive({root:join(root,'torn'),api:async(params,binary)=>{if(params.mode==='inventory'&&++scans===2)bucket.map.set('datasets/new',Buffer.from('new'));return api(params,binary);}}),/changed during backup/);
 bucket.map.delete('datasets/new');const target=join(root,'valid'),result=await createArchive({root:target,api});
 await writeFile(join(target,'objects',`${result.manifest.objects[0].sha256}.gz`),'bad');await assert.rejects(verifyArchive(target),/size mismatch|checksum mismatch/);
 const missing=fixture();missing.bucket.map.delete(rawKey);await assert.rejects(createArchive({root:join(root,'missing'),api:missing.api}),/Missing\/corrupt referenced/);
 }finally{await rm(root,{recursive:true});}
});
