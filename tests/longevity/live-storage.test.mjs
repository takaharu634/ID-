import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { writeObject, openObject, readManifest, sha256, verifyObject } from '../../server/object-store.mjs';
import { stageImport, commitStage, readHead, restoreSnapshot, findSnapshot, historyPage, advanceStageVerification } from '../../server/import-store.mjs';
import { listSeasons } from '../../server/season-catalog.mjs';
import { csvRows, encodeCsv, mergeImport } from '../../lib/import-validation.mjs';

class MemoryBucket {
  items=new Map(); writes=0;
  async get(key) {const value=this.items.get(key);if(!value)return null;return {etag:value.etag,text:async()=>value.text,json:async()=>JSON.parse(value.text)};}
  async put(key,text,options={}) {
    const old=this.items.get(key);
    if(options.onlyIf?.etagMatches && options.onlyIf.etagMatches!==old?.etag)return null;
    if(options.onlyIf?.get?.('If-None-Match')==='*' && old)return null;
    const etag=await sha256(text);this.items.set(key,{text,etag});this.writes++;return {etag};
  }
  async list({prefix='',limit=1000,cursor,delimiter}={}) {
    const all=[...this.items.keys()].filter(k=>k.startsWith(prefix)).sort();
    if(delimiter)return {objects:[],delimitedPrefixes:[...new Set(all.map(k=>prefix+k.slice(prefix.length).split(delimiter)[0]+delimiter))],truncated:false};
    const start=Number(cursor||0),keys=all.slice(start,start+limit),truncated=start+limit<all.length;
    return {objects:keys.map(key=>({key,size:Buffer.byteLength(this.items.get(key).text)})),truncated,cursor:truncated?String(start+limit):undefined};
  }
}
const season='2042-fall';
const path=(id,kind)=>`datasets/v2/${season}/versions/${id}/${kind}.${['raw','input'].includes(kind)?'csv':'json'}`;

test('compressed storage restores UTF-8, BOM and surrogate pairs byte for byte; corrupt/missing blocks fail',async()=>{
  const bucket=new MemoryBucket(), id=randomUUID(), raw='\uFEFFPitchUID,名前\r\n'+('日本語😀,a\r\n'.repeat(45000));
  const ref=await writeObject(bucket,path(id,'raw'),raw,'raw',season);
  assert.equal(ref.format,'tohto-chunks-v1');
  assert.deepEqual(Buffer.from(await (await openObject(bucket,ref)).arrayBuffer()),Buffer.from(raw));
  assert.equal(await (await openObject(bucket,ref)).text(),raw);
  assert.ok([...bucket.items.values()].reduce((n,v)=>n+Buffer.byteLength(v.text),0)<Buffer.byteLength(raw)/4);
  const manifest=await readManifest(bucket,ref), key=manifest.parts[0].key, original=bucket.items.get(key);
  bucket.items.set(key,{text:'broken',etag:'bad'});
  await assert.rejects(()=>verifyObject(bucket,ref),/破損/);
  await assert.rejects(async()=>new Response((await openObject(bucket,ref)).body).arrayBuffer(),/破損/);
  bucket.items.delete(key);await assert.rejects(()=>verifyObject(bucket,ref),/欠け/);
  bucket.items.set(key,original);await verifyObject(bucket,ref);
});

test('unchanged game blocks are reused while summary aggregates and appended games change',async()=>{
  const bucket=new MemoryBucket();
  const pitches=Array.from({length:500},(_,i)=>({id:String(i),gameId:'game-'+Math.floor(i/250),value:'測定'.repeat(300)}));
  const before={metadata:{pitches:pitches.length},pitches};
  const first=await writeObject(bucket,path(randomUUID(),'summary'),JSON.stringify(before),'summary',season);
  const secondData={metadata:{pitches:501},pitches:[...pitches,{id:'500',gameId:'new-game',value:'new'}]};
  const second=await writeObject(bucket,path(randomUUID(),'summary'),JSON.stringify(secondData),'summary',season);
  const a=await readManifest(bucket,first),b=await readManifest(bucket,second);
  assert.ok(a.parts.filter(p=>b.parts.some(q=>p.key===q.key)).length>=a.parts.length-2);
  assert.deepEqual(await (await openObject(bucket,second)).json(),secondData);
});

test('forty-entry head stays bounded, archived versions remain restorable, and future seasons discover themselves',async()=>{
  const bucket=new MemoryBucket();let first,last;
  for(let i=0;i<45;i++) {
    const head=await readHead(bucket,season);
    const v=await stageImport(bucket,season,{raw:'original-'+i,summary:JSON.stringify({pitches:[],games:[]}),spin:'[]'},
      {fileName:`game-${i}.csv`,pitchCount:i+1,gameCount:i+1,report:{warnings:[]},baseEtag:head.etag});
    await commitStage(bucket,v.id);first||=v.id;last=v.id;
  }
  assert.equal((await readHead(bucket,season)).versions.length,40);
  assert.equal((await findSnapshot(bucket,season,first)).id,first);
  const history=await historyPage(bucket,season);assert.ok(history.versions.some(v=>v.id===first));
  await restoreSnapshot(bucket,season,first,last);
  const head=await readHead(bucket,season);assert.equal(head.active,first);assert.equal(head.versions.length,40);
  assert.equal((await listSeasons(bucket)).latest,season);
  const keys=[...bucket.items.keys()];assert.ok(keys.some(k=>k.includes('/heads/')));
  assert.ok(await findSnapshot(bucket,season,last));
});

test('verification resumes in bounded requests and does not publish an incomplete snapshot',async()=>{
  const bucket=new MemoryBucket(),pitches=Array.from({length:8300},(_,i)=>({id:String(i),gameId:'g'+Math.floor(i/100),x:'measurement'.repeat(40)}));
  const staged=await stageImport(bucket,season,{raw:'source',summary:JSON.stringify({pitches}),spin:'[]'},
    {pitchCount:pitches.length,gameCount:83,report:{warnings:[]},baseEtag:null});
  let proof=await advanceStageVerification(bucket,staged.id);assert.equal(proof.complete,false);assert.equal((await readHead(bucket,season)).active,null);
  const offset=proof.offset;proof=await advanceStageVerification(bucket,staged.id);assert.ok(proof.offset>offset);assert.equal(proof.complete,true);
  await commitStage(bucket,staged.id);assert.equal((await readHead(bucket,season)).active,staged.id);
});

test('future-year input exceeds the former 25,000-pitch ceiling without special season code',async()=>{
  const source=csvRows(await fs.readFile(new URL('../../data/raw/season-2026-spring.csv',import.meta.url),'utf8'));
  const seed=source.rows.find(r=>r.Date);
  const rows=Array.from({length:30001},(_,i)=>({...seed,Date:'2042-09-20',PitchUID:'future-'+i,GameUID:'future-game-'+Math.floor(i/300),PitchNo:String(i%300+1)}));
  const result=mergeImport('',encodeCsv(source.headers,rows));assert.equal(result.season,season);assert.equal(result.rows.length,30001);
  const duplicate=mergeImport(result.csv,encodeCsv(source.headers,rows.slice(-1)));assert.equal(duplicate.report.addedRows,0);
});
