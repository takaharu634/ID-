import test from 'node:test';
import assert from 'node:assert/strict';
import {csvRows,encodeCsv,mergeImport,detectSeason,decodeUtf8} from '../lib/import-validation.mjs';
import {prepareImport} from '../server/import-service.mjs';
import {readHead,commitStage,restoreSnapshot,stageImport,sha256} from '../server/import-store.mjs';
import {buildDatasetFromCsv} from '../lib/csv-analytics.js';
export const sample=(overrides={})=>({PitchNo:'1',Date:'2026-09-01',Pitcher:'Test, Pitcher',PitcherId:'1',PitcherTeam:'CHU_UNI',PitcherThrows:'Right',Batter:'Test, Batter',BatterId:'2',BatterTeam:'TOY_UNI',BatterSide:'Right',TaggedPitchType:'Fastball',AutoPitchType:'Fastball',RelSpeed:'145',PitchCall:'StrikeSwinging',PitchUID:'p1',GameUID:'g1',HomeTeam:'CHU_UNI',AwayTeam:'TOY_UNI',Inning:'1','Top/Bottom':'Top',PlayResult:'Undefined',...overrides});
const csv=(rows)=>encodeCsv(Object.keys(rows[0]),rows);
class Bucket {
  map=new Map(); failure=''; seq=0;
  async get(key){const v=this.map.get(key);return !v?null:{etag:v.etag,text:async()=>v.text,json:async()=>JSON.parse(v.text)};}
  async put(key,text,options={}) {
    if(key.includes(this.failure)&&this.failure)throw new Error('storage failure');
    const old=this.map.get(key),cond=options.onlyIf;
    if(cond?.etagMatches && old?.etag!==cond.etagMatches)return null;
    if(cond instanceof Headers && cond.get('if-none-match')==='*'&&old)return null;
    if(options.sha256)assert.equal(await sha256(text),options.sha256);
    const v={text,etag:`e${++this.seq}`};this.map.set(key,v);return v;
  }
}
const base=()=>{const raw=csv([sample()]);return{raw,summary:JSON.stringify(buildDatasetFromCsv(raw,{season:'2026年秋季'})),spin:'[]'};};
test('quoted fields, BOM, newlines and escaped quotes round trip',()=>{
  const row=sample({Batter:'"Example",\n Person'});assert.deepEqual(csvRows('\uFEFF'+csv([row])).rows,[row]);
  assert.throws(()=>csvRows('Date,Date\n1,2'),/列名/);assert.throws(()=>csvRows(csv([row])+'"broken'),/途中/);
});
test('same upload is idempotent, input bytes are not modified',()=>{
  const text=csv([sample()]);const out=mergeImport(text,text);assert.equal(out.report.addedRows,0);assert.equal(out.report.duplicates,1);assert.equal(out.rows.length,1);assert.equal(text,csv([sample()]));
});
test('conflicting UID or game pitch number never silently overwrites',()=>{
  const text=csv([sample()]);assert.throws(()=>mergeImport(text,csv([sample({RelSpeed:'146'})])),/内容が違います/);
  assert.throws(()=>mergeImport(text,csv([sample({PitchUID:'p2'})])),/異なる投球ID/);
});
test('season inference recovers date only from same game, rejects mixed or invalid seasons',()=>{
  assert.equal(detectSeason([sample({Date:'2027-04-01'})]).season,'2027-spring');
  const rows=[sample({Date:'2026/9/1'}),sample({Date:'',PitchNo:'2',PitchUID:'p2'})];assert.deepEqual(detectSeason(rows),{season:'2026-fall',recoveredDates:1});assert.equal(rows[1].Date,'2026-09-01');
  for(const rows of [[sample({Date:''})],[sample({Date:'2026-02-30'})],[sample(),sample({Date:'2026-04-01',GameUID:'g2'})]])assert.throws(()=>detectSeason(rows));
});
test('missing structural columns and invalid measurements stop processing; unmeasured is warning',()=>{
  const row=sample();delete row.HomeTeam;assert.throws(()=>csvRows(csv([row])),/HomeTeam/);
  for(const patch of [{RelSpeed:'NaN'},{RelSpeed:'250'},{PitchCall:'surprise'},{Inning:''}])assert.throws(()=>mergeImport('',csv([sample(patch)])));
  assert.ok(mergeImport('',csv([sample({RelSpeed:''})])).report.warnings.some(w=>w.message.includes('未計測')));
});
test('pitcher exceptions preserve raw type and have exact boundaries',()=>{
  const rows=[144.99,145].map((v,i)=>sample({Pitcher:'Nita, Haruto',PitcherTeam:'RIS_UNI',RelSpeed:String(v),PitchNo:String(i+1),PitchUID:`n${i}`}));
  const d=buildDatasetFromCsv(csv(rows),{applyPlayerRules:true});assert.deepEqual(d.pitches.map(p=>p.pitchType),['シンカー','ストレート']);assert.ok(d.pitches.every(p=>p.rawPitchType==='Fastball'));
  const f=buildDatasetFromCsv(csv([sample({Pitcher:'Fujimoto, Shisei',PitcherTeam:'KOK_UNI',RelSpeed:'120',TaggedPitchType:'Curveball'})]),{applyPlayerRules:true});assert.equal(f.pitches[0].pitchType,'チェンジアップ');
});
test('prepare, acknowledge, commit, restore and idempotent commit retain every saved version',async()=>{
  const bucket=new Bucket(),baseline=base();const incoming=csv([sample({PitchNo:'2',PitchUID:'p2',RelSpeed:''})]);
  const result=await prepareImport(bucket,incoming,'new.csv',async()=>baseline);assert.equal(result.report.addedRows,1);assert.equal((await readHead(bucket,'2026-fall')).active,null);
  await assert.rejects(commitStage(bucket,result.id),/確認/);const v=await commitStage(bucket,result.id,true);assert.equal(v.pitchCount,2);
  assert.equal((await commitStage(bucket,result.id,true)).id,v.id);
  const head=await readHead(bucket,'2026-fall');assert.equal(head.versions.length,2);
  await restoreSnapshot(bucket,'2026-fall',head.versions[0].id,head.active);assert.equal((await readHead(bucket,'2026-fall')).versions.length,2);
  await assert.rejects(restoreSnapshot(bucket,'2026-fall',head.active,head.active),/別の更新/);
  const summary=JSON.parse(bucket.map.get(v.objects.summary.key).text);assert.equal(summary.metadata.title,'東都大学野球 2026年秋季リーグ戦');
});
test('storage failure, checksum damage and stale stage do not switch current data',async()=>{
  const bucket=new Bucket(),baseline=base(),incoming=csv([sample({PitchNo:'2',PitchUID:'p2'})]);
  bucket.failure='/spin.json';await assert.rejects(prepareImport(bucket,incoming,'new.csv',async()=>baseline));assert.equal((await readHead(bucket,'2026-fall')).active,null);bucket.failure='';
  const a=await prepareImport(bucket,incoming,'a.csv',async()=>baseline),b=await prepareImport(bucket,incoming,'b.csv',async()=>baseline);await commitStage(bucket,a.id,true);await assert.rejects(commitStage(bucket,b.id,true),/更新/);
  const h=await readHead(bucket,'2026-fall'),previous=h.versions[0];bucket.map.get(previous.objects.raw.key).text+='damage';await assert.rejects(restoreSnapshot(bucket,'2026-fall',previous.id,h.active),/破損/);assert.equal((await readHead(bucket,'2026-fall')).active,a.id);
});
test('concurrent commits use compare-and-swap and keep only one winner',async()=>{
  const b=new Bucket(),bl=base();const payload={raw:bl.raw,summary:bl.summary,spin:'[]'};const meta={baseEtag:null,report:{warnings:[]},pitchCount:1};
  const [a,c]=await Promise.all([stageImport(b,'2026-fall',payload,meta),stageImport(b,'2026-fall',payload,meta)]);
  const results=await Promise.allSettled([commitStage(b,a.id),commitStage(b,c.id)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});

test('UTF-8 BOM and all original bytes survive decode and archival checksums',async()=>{const input='\uFEFFDate,Name\r\n2026-09-01,"例"\r\n';const bytes=new TextEncoder().encode(input);assert.equal(decodeUtf8(bytes),input);assert.deepEqual(new TextEncoder().encode(decodeUtf8(bytes)),bytes);assert.equal(await sha256(decodeUtf8(bytes)),await sha256(input));});
test('previously present missing measurements remain reported without blocking a clean addition',()=>{const base=csv([sample({RelSpeed:''})]);const added=csv([sample({PitchUID:'p2',PitchNo:'2'})]);const result=mergeImport(base,added);assert.equal(result.report.warnings.length,0);assert.equal(result.report.existingWarnings.length,1);});
