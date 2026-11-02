import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { repairLegacyOutcomes } from '../lib/repair-legacy-outcomes.mjs';
import { buildDatasetFromCsv } from '../lib/csv-analytics.js';
import { csvRows, encodeCsv } from '../lib/import-validation.mjs';
import { mergeAutumnSources } from '../lib/trackman-folder-import.mjs';

test('CSV ingestion classifies conflicting Walk/HBP exactly once in both player roles', () => {
  const raw=csvRows(readFileSync('data/raw/season-2026-spring.csv','utf8'));
  const row={...raw.rows[0],PitchCall:'HitByPitch',KorBB:'Walk',PlayResult:'Undefined',PAofInning:'1'};
  const d=buildDatasetFromCsv(encodeCsv(raw.headers,[row]),{season:'2035年春季'});
  for(const p of [d.batters[0],d.pitchers[0]]) { assert.equal(p.walks,0);assert.equal(p.hbp,1);assert.equal(p.pa,1); }
});

for (const season of ['2025-fall','2026-spring','2026-fall']) test(`${season}: exact raw-derived repair preserves all unrelated fields`, () => {
  const source=JSON.parse(readFileSync(`public/data/season-${season}.json`,'utf8'));
  const before=JSON.stringify(source), repaired=repairLegacyOutcomes(source);
  let csv;
  if(season==='2026-fall') {
    const manifest=JSON.parse(readFileSync('data/trackman/2026-fall/manifest.json','utf8'));
    csv=mergeAutumnSources(manifest.files.slice().sort((a:{id:string},b:{id:string})=>a.id.localeCompare(b.id)).map((f:{id:string,name:string})=>({name:f.name,bytes:readFileSync(`data/trackman/2026-fall/${f.id}.csv`)}))).csv;
  } else csv=readFileSync(`data/raw/season-${season}.csv`,'utf8');
  const raw=buildDatasetFromCsv(csv,{season:source.metadata.season,applyPlayerRules:season==='2026-fall'});
  const changes=JSON.parse(readFileSync('lib/generated/outcome-repairs.json','utf8')).find((p:{key:string})=>p.key===season).changes;
  const get=(value:any,path:string[])=>path.reduce((value,key)=>value[key],value);
  const expected=structuredClone(source);
  for(const change of changes) {
    const path=change.path;
    assert.equal(get(source,path),change.before);
    const fromRaw=change.collection ? get((raw as any)[change.collection].find((p:{id:string})=>p.id===change.id),change.field) : get(raw,path);
    assert.equal(get(repaired,path),fromRaw,JSON.stringify(path));
    const parent=get(expected,path.slice(0,-1));parent[path.at(-1)!]=change.after;
  }
  expected.metadata.resultAggregationVersion=1;
  expected.metadata.resultAggregationRepair=`raw-verified-${season}-outcomes-v1`;
  assert.deepEqual(repaired,expected);assert.equal(JSON.stringify(source),before);
  assert.strictEqual(repaired.pitches,source.pitches);
  assert.strictEqual(repairLegacyOutcomes(repaired),repaired);
});

test('running outs and wild-pitch runs count once without completing a plate appearance', () => {
  const raw=csvRows(readFileSync('data/raw/season-2026-spring.csv','utf8'));
  const base={...raw.rows[0],GameUID:'running',PAofInning:'1',PitchCall:'BallCalled',KorBB:'Undefined',PlayResult:'Undefined',OutsOnPlay:'0',RunsScored:'0'};
  const rows=[{...base,PitchUID:'cs',PitchNo:'1',PlayResult:'CaughtStealing',OutsOnPlay:'1'},
    {...base,PitchUID:'wp',PitchNo:'2',PitchCall:'BallinDirt',RunsScored:'1'},
    {...base,PitchUID:'k',PitchNo:'3',PitchCall:'StrikeSwinging',KorBB:'Strikeout'},
    {...base,PitchUID:'out',PitchNo:'4',PAofInning:'2',PitchCall:'InPlay',PlayResult:'Out',OutsOnPlay:'1'}];
  const d=buildDatasetFromCsv(encodeCsv(raw.headers,[...rows,rows[0]]),{season:'2035年春季'});
  const p=d.pitchers[0];assert.equal(p.pa,2);assert.equal(p.innings,'1.0');assert.equal(p.runs,1);assert.equal(p.strikeouts,1);
});

test('different inputs and manually changed aggregate values are never patched as the known legacy snapshot', () => {
  const source=JSON.parse(readFileSync('public/data/season-2025-fall.json','utf8'));
  const edited=structuredClone(source);edited.pitches[0].korbb='Walk';
  assert.strictEqual(repairLegacyOutcomes(edited),edited);
  const changed=structuredClone(source);changed.league.xwoba=.4;
  assert.strictEqual(repairLegacyOutcomes(changed),changed);
  const denominator=structuredClone(source);denominator.pitchers.find((p:{walks:number})=>p.walks>0).pa*=10;
  assert.strictEqual(repairLegacyOutcomes(denominator),denominator);
});
