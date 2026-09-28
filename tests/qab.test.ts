import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fenceDistance, contactQuality, buildQabAppearances, summarizeQab, qabRankingRows } from '../lib/qab.ts';
import { csvRows, encodeCsv } from '../lib/import-validation.mjs';
import { buildDatasetFromCsv } from '../lib/csv-analytics.js';

const ball = (overrides: Record<string, unknown> = {}) => ({ id: 'p1', gameId: 'g1', batterId: 'b1', batterTeam: '中央大学', pitcherTeam: '東洋大学', inning: 1, half: '表', date: '2026-09-01', pitchNo: 1, balls: 0, strikes: 0, result: 'インプレー', playResult: 'アウト', stadium: 'JinguStadium', exitVelocity: 151, distance: 65, launchAngle: 15, sprayAngle: 0, hitType: 'LineDrive', ...overrides });

test('A changes by direction, uses a 3m margin, includes fence-clearing balls and exact boundaries', () => {
  for (const [bearing, fence] of [[-45,97.5],[-22.5,112.3],[0,120],[22.5,112.3],[45,97.5]]) {
    assert.equal(fenceDistance('JinguStadium', bearing), fence);
    assert.equal(contactQuality(ball({ sprayAngle: bearing, distance: fence - 3 })).grade, 'A');
    assert.notEqual(contactQuality(ball({ sprayAngle: bearing, distance: fence - 3 - .001 })).grade, 'A');
    assert.equal(contactQuality(ball({ sprayAngle: bearing, distance: fence + 8 })).grade, 'A');
  }
  assert.equal(contactQuality(ball({distance:100,sprayAngle:45})).grade,'A');
  assert.notEqual(contactQuality(ball({distance:100,sprayAngle:0})).grade,'A');
  assert.equal(fenceDistance('unknown',0),null);
  assert.equal(fenceDistance('JinguStadium',null),null);
  assert.equal(fenceDistance('JinguStadium',45.01),null);
});

test('B includes fast grounders and liners, rejects weak hits, high flies, fouls and bunts', () => {
  assert.equal(contactQuality(ball({ exitVelocity:150, distance:2, launchAngle:-5, hitType:'GroundBall' })).grade,'B');
  assert.equal(contactQuality(ball({ exitVelocity:150, distance:40, launchAngle:11 })).grade,'B');
  assert.equal(contactQuality(ball({ exitVelocity:149.999 })).grade,null);
  assert.equal(contactQuality(ball({ distance:39.99 })).grade,null);
  assert.equal(contactQuality(ball({ distance:90, launchAngle:42 })).grade,null);
  assert.equal(contactQuality(ball({ result:'ファウル',distance:130 })).grade,null);
  assert.equal(contactQuality(ball({ sprayAngle:50,distance:130 })).grade,null);
  assert.equal(contactQuality(ball({ hitType:'Bunt' })).grade,null);
  const out = contactQuality(ball());
  assert.deepEqual(contactQuality(ball({playResult:'単打'})),out);
});

test('missing and invalid values are never zero measurements or an assumed stadium', () => {
  for (const patch of [{distance:null},{distance:''},{distance:Infinity},{distance:-1},{exitVelocity:NaN,distance:50},{launchAngle:null,distance:50}]) assert.equal(contactQuality(ball(patch)).grade,null);
  assert.equal(contactQuality(ball({ stadium:'unknown',distance:118,launchAngle:40 })).grade,null);
  assert.equal(contactQuality(ball({sprayAngle:null,distance:118,launchAngle:40})).grade,null);
  assert.equal(contactQuality(ball({qabMeasurements:{ev:149.999,angle:15,distance:65,bearing:0}})).grade,null);
});

test('eight actual pitches qualify despite a strikeout; duplicates, events and overlapping reasons do not inflate QAB', () => {
  const pitches = Array.from({length:8},(_,i)=>ball({id:`p${i}`,pitchNo:i+1,balls:0,strikes:i<2?i:2,result:i===7?'空振り':'ファウル',playResult:'',korbb:i===7?'Strikeout':'Undefined'}));
  const rows=buildQabAppearances([...pitches,pitches[4]]);
  assert.equal(rows.length,1);assert.deepEqual(rows[0].reasons,['8球以上']);assert.equal(rows[0].pitchCount,8);
  assert.equal(summarizeQab(rows).qabRate,1);
  const multiple=buildQabAppearances([ball({playResult:'単打'})]);
  assert.deepEqual(multiple[0].reasons,['安打','B打球']);assert.equal(summarizeQab(multiple).qab,1);
  assert.equal(buildQabAppearances([ball({result:'ボール',playResult:'盗塁'})]).length,0);
});

test('same batter in later PAs, innings and games stays separate; incomplete endings stay out of denominator', () => {
  const rows=buildQabAppearances([ball(),ball({id:'p2',pitchNo:2}),ball({id:'p3',inning:2,pitchNo:3}),ball({id:'p4',gameId:'g2'}),ball({id:'p5',gameId:'g2',pitchNo:2,result:'ボール',playResult:''})]);
  assert.equal(rows.length,4);assert.equal(new Set(rows.map(r=>r.id)).size,4);
  assert.equal(summarizeQab([]).qabRate,null);
  const missing=buildQabAppearances([ball({balls:2,distance:null})]);
  assert.equal(missing[0].incompletePitchSequence,true);assert.equal(missing[0].measurementMissing,true);
});

test('explicit PA identity retains an inherited count; intentional ball alone is not a walk', () => {
  const pitches=Array.from({length:8},(_,i)=>ball({id:`p${i}`,pitchNo:i+1,paOfInning:1,batterId:i<6?'b1':'b2',result:i===7?'インプレー':'ファウル',playResult:i===7?'アウト':''}));
  const rows=buildQabAppearances(pitches);assert.equal(rows.length,1);assert.equal(rows[0].batterId,'b2');assert.equal(rows[0].pitchCount,8);
  assert.equal(buildQabAppearances([ball({result:'敬遠',playResult:'',balls:1})]).length,0);
  assert.deepEqual(buildQabAppearances([ball({result:'敬遠',playResult:'',balls:3})])[0].reasons,['四球']);
});

test('all recorded non-contact QAB reasons match Lab; unrecorded advancement is not inferred', () => {
  for (const [patch,reason] of [[{result:'ボール',playResult:'',korbb:'Walk'},'四球'],[{result:'死球',playResult:''},'死球'],[{playResult:'犠打・犠飛'},'犠打・犠飛'],[{playResult:'進塁打'},'進塁打']] as const) {
    assert.ok(buildQabAppearances([ball({...patch,exitVelocity:null,distance:null})])[0].reasons.includes(reason));
  }
  const row=buildQabAppearances([ball({result:'インプレー',playResult:'アウト',runsScored:1,exitVelocity:80})])[0];
  assert.equal(row.reasons.includes('進塁打'),false);
});

test('CSV imports preserve stadium and unrounded batted-ball data for boundary classification', () => {
  const original=csvRows(readFileSync('data/raw/season-2026-spring.csv','utf8'));
  const source={...original.rows.find((p: Record<string,string>)=>p.PitchCall==='InPlay'),Stadium:'TestPark',ExitSpeed:'149.999',Distance:'116.999',Bearing:'0',Angle:'20'};
  const dataset=buildDatasetFromCsv(encodeCsv(original.headers,[source]));
  const p=dataset.pitches[0];assert.equal(p.stadium,'TestPark');
  assert.deepEqual(p.qabMeasurements,{ev:149.999,angle:20,distance:116.999,bearing:0});
});

test('real seasons reconcile player rankings, game totals and raw terminal counts without mutating data', () => {
  for (const season of ['2025-fall','2026-spring','2026-fall']) {
    const d=JSON.parse(readFileSync(`public/data/season-${season}.json`,'utf8'));
    const before=JSON.stringify(d);const rows=buildQabAppearances(d.pitches);const summary=summarizeQab(rows);
    const ranked=qabRankingRows(d.batters,d.pitches);
    assert.equal(ranked.reduce((s,r)=>s+r.qab,0),summary.qab);
    assert.equal(ranked.reduce((s,r)=>s+r.pa,0),summary.pa);
    assert.equal(d.games.reduce((s: number,g: {id:string})=>s+summarizeQab(rows.filter(r=>r.gameId===g.id)).qab,0),summary.qab);
    assert.ok(rows.every(r=>r.reasons.filter(x=>x==='A打球'||x==='B打球').length<=1));
    assert.equal(JSON.stringify(d),before);
    // Independent source-result count, not the QAB aggregation path.
    if(season==='2026-spring'){
      const raw=csvRows(readFileSync('data/raw/season-2026-spring.csv','utf8')).rows;
      const complete=raw.filter((p:Record<string,string>)=>['Single','Double','Triple','HomeRun','Out','Error','FieldersChoice','Filderschoice','Sacrifice'].includes(p.PlayResult)||['Walk','Waik','Strikeout'].includes(p.KorBB)||p.PitchCall==='HitByPitch'||(p.Strikes==='2'&&['StrikeSwinging','StrikeCalled'].includes(p.PitchCall)));
      assert.equal(summary.pa,complete.length);
    }
  }
});
