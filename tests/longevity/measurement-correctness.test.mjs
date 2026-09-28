import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDatasetFromRows, buildDatasetFromCsv } from '../../lib/csv-analytics.js';
import { encodeCsv, mergeImport, mergeParsedImport, csvRows, detectSeason } from '../../lib/import-validation.mjs';
import { annotateRunnerStates } from '../../lib/runner-state.js';
const row=(patch={})=>({PitchNo:'1',Date:'2042-09-01',Pitcher:'Test, Pitcher',PitcherId:'1',PitcherTeam:'CHU_UNI',PitcherThrows:'Right',Batter:'Test, Batter',BatterId:'2',BatterTeam:'TOY_UNI',BatterSide:'Right',TaggedPitchType:'Fastball',AutoPitchType:'Fastball',RelSpeed:'145',PitchCall:'StrikeSwinging',PitchUID:'p1',GameUID:'g1',HomeTeam:'CHU_UNI',AwayTeam:'TOY_UNI',Inning:'1','Top/Bottom':'Top',PlayResult:'Undefined',PlateLocSide:'0',PlateLocHeight:'.75',...patch});
const options={season:'2042年秋季',generatedAt:'2042-09-01T00:00:00Z'};
test('Zone Contact counts only misses inside the measured strike zone',()=>{
 const data=buildDatasetFromRows([row({PitchCall:'FoulBallNotFieldable'}),row({PitchNo:'2',PitchUID:'p2',PlateLocSide:'1'}),row({PitchNo:'3',PitchUID:'p3',PlateLocSide:'1'})],options);
 assert.equal(data.batters[0].zoneContactRate,1);assert.equal(data.batters[0].chaseRate,1);assert.equal(data.batters[0].whiffRate,.667);
 assert.equal(data.metadata.measurementAggregationVersion,1);
});
test('missing or partially missing location is excluded from Chase and Zone Contact',()=>{
 const missing=buildDatasetFromRows([row({PlateLocSide:''}),row({PitchNo:'2',PitchUID:'p2',PlateLocHeight:''})],options);
 assert.equal(missing.batters[0].chaseRate,null);assert.equal(missing.pitchers[0].chaseRate,null);assert.equal(missing.batters[0].zoneContactRate,null);
 const mixed=buildDatasetFromRows([row({PlateLocSide:'',PitchCall:'StrikeSwinging'}),row({PitchNo:'2',PitchUID:'p2',PlateLocSide:'1',PitchCall:'BallCalled'})],options);
 assert.equal(mixed.batters[0].chaseRate,0);
});
test('missing extension and release measurements stay null; measured zero remains zero',()=>{
 for(const value of ['', '0', '1.5']) {
  const data=buildDatasetFromRows([row({Extension:value,RelHeight:value,RelSide:value})],options),expected=value===''?null:Number(value)*100;
  assert.equal(data.pitchers[0].avgExtension,expected);
  for(const key of ['avgExtension','avgReleaseHeight','avgReleaseSide']) assert.equal(data.pitchTypes[0][key],expected,key);
 }
});
test('parsed import rows preserve CSV aggregates and recovered-date report',()=>{
 const rows=[row(),row({PitchUID:'p2',PitchNo:'2',Date:''})],text=encodeCsv(Object.keys(rows[0]),rows);
 const full=mergeImport('',text),parsed=csvRows(text),detected=detectSeason(parsed.rows);
 assert.equal(detected.recoveredDates,1);
 const reused=mergeParsedImport({headers:[],rows:[]},parsed,detected);
 assert.deepEqual(reused,full);assert.deepEqual(buildDatasetFromRows(reused.rows,options),buildDatasetFromCsv(full.csv,options));
});
test('runner annotation is non-mutating by default, and opt-in ownership produces identical values',()=>{
 const input=[{id:'p1',gameId:'g',inning:1,half:'表',pitchNo:1,result:'ボール',korbb:'Walk'}];
 const before=structuredClone(input),copied=annotateRunnerStates(input);assert.deepEqual(input,before);assert.notEqual(copied[0],input[0]);
 assert.equal(annotateRunnerStates(input,{inPlace:true}),input);assert.deepEqual(input,copied);
});
