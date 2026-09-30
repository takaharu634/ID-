import test from 'node:test';
import assert from 'node:assert/strict';
import { isInsideFastball, insideFastballCount, teamBattingSummary, reportPitchGroup, reportLineDash, reportHit, drawableBattedBall, groupReportPlayers } from '../lib/opponent-report.ts';
import { annotatePlateAppearances } from '../lib/scouting-analytics.ts';
import { getPrintLayout } from '../app/print-document.ts';

test('inside straight uses batter handedness, includes inside balls, keeps all pitches as denominator',()=>{
 const pitches=[{pitchType:'ストレート',batterSide:'右',plateX:.3},{pitchType:'ストレート',batterSide:'左',plateX:-.1},{pitchType:'ストレート',batterSide:'右',plateX:-.3},{pitchType:'スライダー',batterSide:'右',plateX:.3},{pitchType:'ストレート',batterSide:'右',plateX:null}];
 assert.deepEqual(pitches.map(isInsideFastball),[true,true,false,false,false]);
 assert.deepEqual(insideFastballCount(pitches),{n:2,total:5,missing:1});
 assert.equal(isInsideFastball({pitchType:'ストレート',batterSide:'右',plateX:.254/3}),true);
 assert.equal(isInsideFastball({pitchType:'ストレート',batterSide:'不明',plateX:.4}),false);
});
test('FS is first strike in full plate appearance; outer breaking whiff denominator is swings',()=>{
 const rows=annotatePlateAppearances([
 {gameId:'g',inning:1,half:'表',batterId:'b',balls:0,strikes:0,pitchType:'ストレート',result:'ボール',batterSide:'右',plateX:-.4},
 {gameId:'g',inning:1,half:'表',batterId:'b',balls:1,strikes:0,pitchType:'スライダー',result:'空振り',batterSide:'右',plateX:-.3},
 {gameId:'g',inning:1,half:'表',batterId:'b',balls:1,strikes:1,pitchType:'スライダー',result:'ファウル',batterSide:'右',plateX:-.3},
 {gameId:'g',inning:1,half:'表',batterId:'b',balls:1,strikes:2,pitchType:'チェンジアップ',result:'ボール',batterSide:'右',plateX:-.4},
 ]);
 const s=teamBattingSummary(rows);assert.deepEqual(s.fsStraight,{n:0,total:0,value:null});assert.deepEqual(s.fsBreaking,{n:1,total:1,value:1});
 assert.equal(s.outsideSwing.total,3);assert.equal(s.outsideSwing.n,2);assert.equal(s.outsideWhiff.total,2);assert.equal(s.outsideWhiff.n,1);
 assert.equal(teamBattingSummary(rows.filter(r=>r.strikes===1)).fsBreaking.total,0);
});
test('direction summary reverses pull side, excludes bunt/invalid bearings and retains missing distance only in proportions',()=>{
 const base={result:'インプレー',hitType:'GroundBall',distance:40,batterSide:'右'};
 const rows=[{...base,sprayAngle:-20},{...base,batterSide:'左',sprayAngle:20},{...base,sprayAngle:0,distance:null},{...base,sprayAngle:25},{...base,sprayAngle:0,hitType:'Bunt'},{...base,sprayAngle:180}];
 const s=teamBattingSummary(rows);assert.deepEqual(s.directions,{pull:2,center:1,opposite:1});assert.equal(s.batted,4);assert.equal(rows.filter(drawableBattedBall).length,3);
 assert.equal(reportPitchGroup({pitchType:'シンカー'}),'変化球');assert.equal(reportPitchGroup({pitchType:'不明'}),null);
 assert.equal(reportLineDash('ゴロ'),'1 3');assert.equal(reportLineDash('フライ'),'9 5');assert.equal(reportLineDash('ライナー'),undefined);assert.equal(reportHit({playResult:'本塁打'}),true);
});
test('packet team and role groups cannot include opposing pitchers or batters',()=>{
 const rows=[{pitcherId:'p',pitcher:'P',pitcherTeam:'A',batterId:'b',batter:'B',batterTeam:'B'},{pitcherId:'q',pitcherTeam:'B',batterId:'a',batterTeam:'A'}];
 assert.deepEqual(groupReportPlayers(rows,'A','pitcher').map(p=>p.id),['p']);assert.deepEqual(groupReportPlayers(rows,'A','batter').map(p=>p.id),['a']);
 assert.match(getPrintLayout('opponent').css,/@page opponent-portrait/);assert.match(getPrintLayout('opponent').css,/@page opponent-landscape/);
});
