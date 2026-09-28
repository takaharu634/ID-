import test from 'node:test';
import assert from 'node:assert/strict';
import { writeObject, openObject, readManifest, sha256, verifyObject, objectReferences, BLOCK_CHARS } from '../../server/object-store.mjs';
import { stageImport, advanceVerification, advanceStageVerification, verifySnapshot, commitStage, readHead } from '../../server/import-store.mjs';
class Bucket {
 items=new Map();
 async get(key) {const text=this.items.get(key);if(text===undefined)return null;const response=new Response(text);return {etag:await sha256(text),text:()=>response.text(),json:()=>response.json()};}
 async head(key) {const text=this.items.get(key);return text===undefined?null:{checksums:{sha256:await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))}};}
 async put(key,text,options={}) {const old=this.items.get(key);if(options.onlyIf?.etagMatches && (old===undefined || options.onlyIf.etagMatches!==await sha256(old)))return null;if(options.onlyIf?.get?.('If-None-Match')==='*' && old!==undefined)return null;this.items.set(key,text);return {etag:await sha256(text)};}
}
const season='2042-fall',key=(id,kind)=>`datasets/v2/${season}/versions/${id}/${kind}.${kind==='raw'?'csv':'json'}`;
async function alteredRaw(bucket,ref,field) {
 const manifest=await readManifest(bucket,ref);
 if(field==='rawSha256')manifest.parts[0].rawSha256='0'.repeat(64);
 else {manifest.parts[0].rawBytes++;manifest.bytes++;}
 const text=JSON.stringify(manifest);await bucket.put(ref.key,text);return {...ref,sha256:await sha256(text)};
}
test('valid compressed checksum cannot disguise incorrect decompressed hash or size',async()=>{
 for(const field of ['rawSha256','rawBytes']) {
  const bucket=new Bucket(),ref=await writeObject(bucket,key(crypto.randomUUID(),'raw'),'原本😀'.repeat(70000),'raw',season),bad=await alteredRaw(bucket,ref,field);
  await assert.rejects(verifyObject(bucket,bad),/復元/);
  const refs=await objectReferences(bucket,bad);assert.equal(typeof refs[1].rawSha256,'string');assert.equal(typeof refs[1].rawBytes,'number');
  await assert.rejects(verifyObject(bucket,refs[1]),/復元/);
 }
});
test('verified bytes are read once per R2 body, including buckets with checksum metadata',async()=>{
 const bucket=new Bucket(),ref=await writeObject(bucket,key(crypto.randomUUID(),'raw'),'日本語😀'.repeat(70000),'raw',season);
 await verifyObject(bucket,ref);const references=await objectReferences(bucket,ref);for(const r of references)await verifyObject(bucket,r);
 assert.equal(await (await openObject(bucket,ref)).text(),'日本語😀'.repeat(70000));
});
test('old verification receipt cannot bypass raw checks on commit or resumed verification',async()=>{
 const bucket=new Bucket(),snapshot=await stageImport(bucket,season,{raw:'original'.repeat(40000),summary:'{"pitches":[]}',spin:'[]'},{report:{warnings:[]},baseEtag:null});
 snapshot.objects.raw=await alteredRaw(bucket,snapshot.objects.raw,'rawSha256');
 const stageKey=`datasets/v2/staged/${snapshot.id}.json`,stage=JSON.parse(bucket.items.get(stageKey));stage.snapshot=snapshot;await bucket.put(stageKey,JSON.stringify(stage));
 const refs=await objectReferences(bucket,snapshot.objects.raw);
 await bucket.put(`datasets/v3/verification/${snapshot.id}.json`,JSON.stringify({snapshotHash:await sha256(JSON.stringify(snapshot)),complete:true,offset:refs.length+2,checkedAt:Date.now()}));
 await assert.rejects(verifySnapshot(bucket,snapshot),/復元/);await assert.rejects(advanceVerification(bucket,snapshot),/復元/);await assert.rejects(commitStage(bucket,snapshot.id),/復元/);
 assert.equal((await readHead(bucket,season)).active,null);
});
test('native summary staging preserves small bytes and large manifest block bytes exactly',async()=>{
 for(const n of [1,500]) {
  const first=new Bucket(),second=new Bucket(),id=crypto.randomUUID(),data={pitches:Array.from({length:n},(_,i)=>({id:String(i),gameId:'g'+Math.floor(i/200),label:'日本語😀'.repeat(300)})),metadata:{n},after:'retained'};
  const refA=await writeObject(first,key(id,'summary'),JSON.stringify(data),'summary',season),refB=await writeObject(second,key(id,'summary'),data,'summary',season);
  assert.deepEqual(refB,refA);assert.deepEqual(second.items,first.items);assert.deepEqual(await (await openObject(second,refB)).json(),data);
 }
});
test('native summary preserves representation at chunk threshold boundaries',async()=>{
 for(const delta of [-1,0,1]) {
  const data={pitches:[],padding:''};data.padding='x'.repeat(BLOCK_CHARS*2-JSON.stringify(data).length+delta);
  const a=new Bucket(),b=new Bucket(),id=crypto.randomUUID();
  const oldRef=await writeObject(a,key(id,'summary'),JSON.stringify(data),'summary',season),nativeRef=await writeObject(b,key(id,'summary'),data,'summary',season);
  assert.deepEqual(nativeRef,oldRef);assert.deepEqual(b.items,a.items);
 }
});

test('lost commit response remains retryable after staging expiry without changing the head',async()=>{
 const bucket=new Bucket(),snapshot=await stageImport(bucket,season,{raw:'source',summary:'{"pitches":[]}',spin:'[]'},{report:{warnings:[]},baseEtag:null});
 await commitStage(bucket,snapshot.id);const before=await readHead(bucket,season);
 const key=`datasets/v2/staged/${snapshot.id}.json`,stage=JSON.parse(bucket.items.get(key));stage.expiresAt=0;await bucket.put(key,JSON.stringify(stage));
 assert.equal((await advanceStageVerification(bucket,snapshot.id)).alreadyCommitted,true);assert.equal((await commitStage(bucket,snapshot.id)).id,snapshot.id);assert.deepEqual(await readHead(bucket,season),before);
});
