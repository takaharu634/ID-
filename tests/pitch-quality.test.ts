import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyPitchQuality, pitchScore, PITCH_QUALITY_VERSION } from '../lib/pitch-quality.mjs';
import { meanOf, sdOf } from '../lib/numeric-summary.ts';
import { createDatasetLoader } from '../lib/dataset-loader.ts';
import { packDataset } from '../lib/dataset-transport.js';
import { buildDatasetFromCsv } from '../lib/csv-analytics.js';

test('missing measurements do not become zero in averages, SD, or scoring', () => {
  const values = [{v:140},{v:150},{v:null},{v:''},{v:' '},{v:undefined},{v:NaN}];
  assert.equal(meanOf(values,'v'),145); assert.equal(sdOf(values,'v'),5);
  assert.equal(meanOf([{v:null}],'v'),null); assert.equal(sdOf([{v:1},{v:null}],'v'),null);
  assert.equal(meanOf([{v:0},{v:10}],'v'),5);
});

test('score scale centers on 50, permits exceptional scores, and shrinks small samples', () => {
  assert.equal(pitchScore(0,100),50);
  assert.equal(pitchScore(-10,100),0);
  assert.ok(pitchScore(4,1000)! > 100);
  assert.ok(pitchScore(2,10)! < pitchScore(2,100)!);
  assert.equal(pitchScore(null,100),null);
});

test('all seasons have meaningful spread and consistent score projections, preserving unrelated data', async () => {
  for (const season of ['2025-fall','2026-spring','2026-fall']) {
    const source = JSON.parse(readFileSync(new URL(`../public/data/season-${season}.json`,import.meta.url),'utf8'));
    delete source.metadata.pitchQuality; // Emulate a legacy persisted snapshot.
    const bytes = JSON.stringify(source), next = applyPitchQuality(source);
    assert.equal(JSON.stringify(source),bytes,'input is immutable');
    assert.equal(applyPitchQuality(next),next,'read projection is idempotent');
    assert.equal(next.metadata.pitchQuality.version,PITCH_QUALITY_VERSION);
    for (const field of ['pitches','games','batters','catchers','league']) assert.equal(next[field],source[field]);
    const qualified = next.pitchers.filter((p:any)=>p.pitches>=100 && Number.isFinite(p.pitchingPlus));
    assert.ok(Math.max(...qualified.map((p:any)=>p.pitchingPlus))-Math.min(...qualified.map((p:any)=>p.pitchingPlus)) > 50);
    for (const p of next.pitchers) {
      assert.deepEqual(next.players.find((r:any)=>r.id===p.id).pitching,p);
      const old=source.pitchers.find((r:any)=>r.id===p.id);
      for (const key of ['pitchValue','pitchValuePer100','era','xera','avgVelocity']) assert.equal(p[key],old[key]);
    }
    assert.equal(next.highlights.pitchingPlus.pitchingPlus,Math.max(...qualified.map((p:any)=>p.pitchingPlus)));
    const current = createDatasetLoader(async()=>Response.json(source),true);
    const compact = createDatasetLoader(async()=>Response.json(packDataset(source)));
    assert.deepEqual(await current(`/data/season-${season}.json`), next);
    assert.deepEqual(await compact(`/data/season-${season}.json`), next);
  }
});

test('CSV ingestion and legacy read projection use the same scores', () => {
  const csv=readFileSync(new URL('../data/raw/season-2026-spring.csv',import.meta.url),'utf8');
  const built=buildDatasetFromCsv(csv,{season:'2026年春季'});
  const old=structuredClone(built); delete (old.metadata as any).pitchQuality;
  assert.deepEqual(applyPitchQuality(old).pitchers,built.pitchers);
});

test('rare types are unrated; identical measured populations are neutral', () => {
  const pitches=Array.from({length:300},(_,i)=>({pitcherId:String(i%3),pitchType:'ストレート',velocity:145,spin:2400,extension:180,ivb:40,hb:20,vaa:-5,plateX:.22,plateZ:.8,result:'見逃しストライク'}));
  const pitchers=[0,1,2].map(i=>({id:String(i),pitches:100}));
  const source:any={metadata:{},pitchers,pitchTypes:pitchers.map(p=>({pitcherId:p.id,pitchType:'ストレート',pitches:100})),pitches,players:[],teams:[]};
  const next=applyPitchQuality(source);
  assert.deepEqual(next.pitchers.map((p:any)=>p.pitchingPlus),[50,50,50]);
  const incomplete=structuredClone(source); incomplete.pitches[0].velocity=null;
  assert.equal(applyPitchQuality(incomplete).pitchTypes[0].qualitySample,99);
  const rare={...source,pitchTypes:source.pitchTypes.slice(0,2),pitchers:source.pitchers.slice(0,2),pitches:pitches.filter(p=>p.pitcherId!=='2')};
  assert.ok(applyPitchQuality(rare).pitchTypes.every((p:any)=>p.pitchingPlus===null));
});
