import test from 'node:test';
import assert from 'node:assert/strict';
import {proportion,thresholdRows,thresholdStudy,isOuterBreaking,chaseStability,pearson,mixDistance,repeatMatchupStudy,droppingStudy,researchPitchType} from '../lib/tohto-research.ts';
import type {Dataset,Row} from '../lib/dataset-types.ts';
const pitch=(more:Row={}):Row=>({pitcherId:'p',batterId:'b',pitcher:'Pitcher',batter:'Batter',pitcherTeam:'A',batterTeam:'B',pitchType:'ストレート',result:'空振り',plateX:0,plateZ:.9,ivb:50,gameId:'g1',...more});
const dataset=(pitches:Row[],games:Row[]=[],teams:Row[]=[]):Dataset=>({pitches,games,teams,metadata:{},league:{},players:[],batters:[],pitchers:[],catchers:[],pitchTypes:[],highlights:{}});
test('zero samples are missing, not zero performance, and interval covers observed rate',()=>{assert.equal(proportion(0,0).rate,null);const r=proportion(5,10);assert.ok(r.low!<.5&&r.high!>.5);assert.equal(proportion(0,10).rate,0);});
test('high fastball denominator contains only valid swings in exact upper zone',()=>{const rows=[pitch(),pitch({result:'ボール'}),pitch({plateZ:null}),pitch({plateX:.255}),pitch({pitchType:'スライダー'}),pitch({result:'ファウル',plateX:.254,plateZ:.85})];assert.equal(thresholdRows(rows,'ivb').length,2);});
test('groundballs exclude missing EV, flyballs and bunts',()=>{const p=pitch({result:'インプレー',hitType:'GroundBall',exitVelocity:140});assert.equal(thresholdRows([p,{...p,exitVelocity:null},{...p,hitType:'Bunt'},{...p,hitType:'FlyBall'}],'ground').length,1);});
test('threshold choice is frozen on training data even if validation direction reverses',()=>{
  const training=Array.from({length:200},(_,i)=>pitch({pitcherId:`p${i%5}`,ivb:i<100?40:55,result:i<100?'ファウル':'空振り'}));
  const validation=training.map(p=>({...p,result:p.result==='空振り'?'ファウル':'空振り'}));const a=thresholdStudy(training,training,'ivb'),b=thresholdStudy(training,validation,'ivb');assert.equal(a.selected?.boundary,b.selected?.boundary);assert.ok(b.validation!.difference!<0);
});
test('outer breaking location reverses by handedness, missing side excluded',()=>{assert.equal(isOuterBreaking(pitch({pitchType:'スライダー',batterSide:'右',plateX:-.26})),true);assert.equal(isOuterBreaking(pitch({pitchType:'スライダー',batterSide:'左',plateX:.26})),true);assert.equal(isOuterBreaking(pitch({pitchType:'スライダー',batterSide:'左',plateX:-.26})),false);assert.equal(isOuterBreaking(pitch({pitchType:'スライダー',plateX:.8})),false);});
test('same team/name matches changed ID across seasons, ambiguity and different team do not merge',()=>{
 const before=Array.from({length:20},()=>pitch({batter:'Player, Name',pitchType:'スライダー',batterSide:'右',plateX:-.4}));const after=before.map(p=>({...p,batterId:'new'}));assert.equal(chaseStability(before,after).qualified,1);assert.equal(chaseStability(before,after).r,null);assert.equal(chaseStability(before,after.map(p=>({...p,batterTeam:'C'}))).pairs.length,0);assert.equal(chaseStability([...before,{...before[0],batterId:'ambiguous'}],after).ambiguous,1);
});
test('zero variance has no correlation and mixed pitch distance is bounded',()=>{assert.equal(pearson([{x:.2,y:.3},{x:.2,y:.6}]),null);assert.equal(mixDistance([pitch()],[pitch({pitchType:'スライダー'})]),1);});
test('rematch compares different games in same series, not repeated PA or months later',()=>{
 const games=[{id:'g1',date:'2026-04-01',homeTeam:'A',awayTeam:'B'},{id:'g2',date:'2026-04-02',homeTeam:'B',awayTeam:'A'},{id:'g3',date:'2026-05-02',homeTeam:'A',awayTeam:'B'}];
 const rows=games.flatMap(g=>Array.from({length:5},()=>pitch({gameId:g.id,pitchType:g.id==='g1'?'ストレート':'スライダー'})));const out=repeatMatchupStudy(dataset(rows,games));assert.equal(out.comparisons.length,1);assert.equal(out.comparisons[0].order,2);assert.equal(out.comparisons[0].distance,1);
});
test('win rate excludes draws, dropping denominator excludes unknown pitch types',()=>{const d=dataset([pitch({pitchType:'フォーク'}),pitch({pitchType:'不明'})],[{homeTeam:'A',awayTeam:'B',homeRuns:1,awayRuns:0},{homeTeam:'A',awayTeam:'B',homeRuns:0,awayRuns:0}],[{name:'A'}]);const r=droppingStudy(d).rows[0];assert.equal(r.winRate,1);assert.equal(r.ties,1);assert.equal(r.usage.n,1);assert.equal(r.unknown,1);});
test('specific pitcher rules are team-scoped and preserve input',()=>{const p=pitch({pitcher:'Nita, Haruto',pitcherTeam:'立正大学',velocity:144.9});assert.equal(researchPitchType(p),'シンカー');assert.equal(p.pitchType,'ストレート');assert.equal(researchPitchType({...p,pitcherTeam:'A'}),'ストレート');});

test('raw precision and already corrected pitches cannot be reversed by rounded display speed',()=>{const p=pitch({pitcher:'Nita, Haruto',pitcherTeam:'立正大学',velocity:145,rawVelocity:144.98});assert.equal(researchPitchType(p),'シンカー');assert.equal(researchPitchType({...p,pitchType:'シンカー',playerRulesApplied:true}),'シンカー');assert.equal(mixDistance([pitch({pitchType:'スライダー'})],[pitch({pitchType:'カーブ'})]),1);});
test('later first meeting and recoverable game date remain eligible',()=>{const games=[{id:'g1',date:'2026-04-01',homeTeam:'A',awayTeam:'B'},{id:'g2',date:'',homeTeam:'B',awayTeam:'A'},{id:'g3',date:'2026-04-03',homeTeam:'A',awayTeam:'B'}];const rows=['g2','g3'].flatMap((gameId,i)=>Array.from({length:5},()=>pitch({gameId,date:`2026-04-0${i+2}`})));const r=repeatMatchupStudy(dataset(rows,games));assert.equal(r.comparisons.length,1);assert.equal(r.excludedGames,0);});
