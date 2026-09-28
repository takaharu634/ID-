import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { adjustedCatcher, buildUmpireAnalysis, displayX, edgeCrossing, heatCells, isTaken, localProbability, region, sampleLabel, summarize, UMPIRE_ASSIGNMENTS, type Take } from '../lib/umpire-analytics.ts';
const data=JSON.parse(readFileSync(new URL('../public/data/season-2026-fall.json',import.meta.url),'utf8'));
const pitch=(overrides:Partial<Take>={}):Take=>({id:'p',gameId:'g',plateX:.1,plateZ:.7,batterSide:'右',balls:0,strikes:0,result:'ボール',actual:0,expected:.5,umpire:'A',...overrides});
test('all fourteen imported games match the supplied umpire memos by ID, date and teams',()=>{
 const a=buildUmpireAnalysis(data);assert.equal(a.assignments.size,14);assert.equal(a.mismatches.length,0);assert.equal(a.unknownGames.length,0);
 for(const [id,,,,name] of UMPIRE_ASSIGNMENTS)assert.equal(a.assignments.get(id),name);
 const changed=structuredClone(data); changed.games[0].date='2026-10-01';changed.games.push({id:'future',date:'2026-09-18',homeTeam:'中央大学',awayTeam:'青山学院大学'});
 const b=buildUmpireAnalysis(changed);assert.equal(b.assignments.size,13);assert.equal(b.unknownGames.length,2);
 const spring=JSON.parse(readFileSync(new URL('../public/data/season-2026-spring.json',import.meta.url),'utf8'));assert.equal(buildUmpireAnalysis(spring).assignments.size,0);
});
test('September 18 and 24 memos follow the three CSV game slots',()=>{
 const a=buildUmpireAnalysis(data);
 for(const [date,home,away,name] of [
  ['2026-09-18','東洋大学','青山学院大学','吉田'],
  ['2026-09-18','立正大学','亜細亜大学','湯田'],
  ['2026-09-18','中央大学','國學院大學','石丸'],
  ['2026-09-24','青山学院大学','東洋大学','熊倉'],
  ['2026-09-24','亜細亜大学','立正大学','菅原'],
  ['2026-09-24','國學院大學','中央大学','吉田'],
 ]) {
  const g=data.games.find((g:Record<string,string>)=>g.date===date&&g.homeTeam===home&&g.awayTeam===away);
  assert.ok(g,`${date} ${home} ${away}`);assert.equal(a.assignments.get(g.id),name);
 }
});
test('third-game memo waits for one exact match and refuses other dates, reversed teams and duplicates',()=>{
 const clone=structuredClone(data);clone.pitches=[];
 const game={id:'third-game',date:'2026-09-25',homeTeam:'國學院大學',awayTeam:'中央大学'};
 assert.equal(buildUmpireAnalysis(clone).assignments.size,14);
 clone.games.push(game);
 const matched=buildUmpireAnalysis(clone);assert.equal(matched.assignments.get(game.id),'福壽');assert.equal(matched.assignments.size,15);
 game.date='2026-09-26';assert.equal(buildUmpireAnalysis(clone).assignments.has(game.id),false);
 game.date='2026-09-25';game.homeTeam='中央大学';game.awayTeam='國學院大學';assert.equal(buildUmpireAnalysis(clone).assignments.has(game.id),false);
 game.homeTeam='國學院大學';game.awayTeam='中央大学';clone.games.push({...game,id:'duplicate'});
 const ambiguous=buildUmpireAnalysis(clone);assert.equal(ambiguous.assignments.has(game.id),false);assert.equal(ambiguous.assignments.has('duplicate'),false);assert.deepEqual(ambiguous.mismatches,['福壽']);
});
test('real take counts match original; input remains immutable; every valid comparison finite',()=>{
 const before=JSON.stringify(data),a=buildUmpireAnalysis(data);
 assert.equal(a.takes.length,data.pitches.filter((p:Take)=>isTaken(p)&&typeof p.plateX==='number'&&typeof p.plateZ==='number').length);
 assert.equal(JSON.stringify(data),before);assert.ok(a.takes.filter(p=>p.expected!==null).length>100);
 for(const p of a.takes)if(p.expected!==null)assert.ok(p.expected>=0&&p.expected<=1);
 const all=summarize(a.takes);const groups=[...new Set(a.assignments.values())].map(n=>summarize(a.takes.filter(p=>p.umpire===n)));
 assert.equal(groups.reduce((s,g)=>s+g.n,0),all.n);assert.ok(Math.abs(groups.reduce((s,g)=>s+(g.extra??0),0)-all.extra!)<1e-8);
});
test('own game outcomes cannot affect its expected probability',()=>{
 const first=UMPIRE_ASSIGNMENTS[0][0],a=buildUmpireAnalysis(data),changed=structuredClone(data);
 for(const p of changed.pitches)if(p.gameId===first&&isTaken(p))p.result=p.result==='ボール'?'見逃しストライク':'ボール';
 const b=buildUmpireAnalysis(changed);assert.deepEqual(a.takes.filter(p=>p.gameId===first).map(p=>p.expected),b.takes.filter(p=>p.gameId===first).map(p=>p.expected));
});
test('exclude swings, dirt, HBP, intentional balls and missing location; unknown side has no estimate',()=>{
 const rows=['ボール','見逃しストライク','空振り','ファウル','インプレー','ワンバウンド','死球','敬遠'].map((result,i)=>pitch({id:String(i),result}));
 assert.deepEqual(rows.filter(isTaken).map(p=>p.result),['ボール','見逃しストライク']);
 const clone=structuredClone(data);clone.pitches=[...clone.pitches,pitch({id:'missing',plateX:null as unknown as number}),pitch({id:'unknown',gameId:UMPIRE_ASSIGNMENTS[0][0],batterSide:''})];
 const a=buildUmpireAnalysis(clone);assert.ok(a.missingLocation>=1);assert.equal(a.takes.find(p=>p.id==='unknown')!.expected,null);
});
test('catcher left is RHB inside and LHB outside; batter-view normalizes inside left',()=>{
 assert.equal(displayX(pitch({plateX:.3}), 'umpire'),-.3);assert.equal(displayX(pitch({plateX:.3}), 'batter'),-.3);
 assert.equal(displayX(pitch({plateX:.3,batterSide:'左'}), 'batter'),.3);
 assert.equal(region(pitch({plateX:.3,plateZ:.75}),'batter'),'左');
 assert.equal(region(pitch({plateX:-.3,plateZ:.43}),'umpire'),'右下');
});
test('summary uses only matched subset for delta; zero remains valid and empty is null',()=>{
 const s=summarize([pitch({actual:1,expected:.25}),pitch({actual:0,expected:null})]);
 assert.equal(s.n,2);assert.equal(s.rate,.5);assert.equal(s.compared,1);assert.equal(s.delta,.75);
 assert.equal(summarize([]).delta,null);assert.equal(summarize([pitch({expected:0})]).delta,0);
 assert.equal(heatCells([pitch({plateX:0,plateZ:.8})],'umpire').reduce((n,c)=>n+c.n,0),1);
 assert.deepEqual([0,29,30,79,80,149,150].map(sampleLabel),['参考','参考','低','低','中','中','高']);
});
test('unsupported local model and centimetre contour stay null; known crossing recovered',()=>{
 assert.equal(localProbability([pitch()],.1,.7).probability,null);assert.equal(edgeCrossing([pitch()],'右'),null);
 const rows:Take[]=[];for(let i=0;i<101;i++)for(let j=0;j<4;j++){const x=i*.005;rows.push(pitch({id:`${i}-${j}`,plateX:x,plateZ:.75,actual:x<.30?1:0}));}
 const edge=edgeCrossing(rows,'右');assert.ok(edge!==null&&Math.abs(edge-.30)<.02);
});
test('reference framing uses other catchers and refuses insufficient peer samples',()=>{
 const target=Array.from({length:30},(_,i)=>pitch({id:`a${i}`,catcherId:'one',actual:1}));
 const peers=Array.from({length:30},(_,i)=>pitch({id:`b${i}`,catcherId:'two',actual:0}));
 assert.equal(adjustedCatcher(target,target).extra,null);
 const result=adjustedCatcher(target,[...target,...peers]);assert.equal(result.n,30);assert.equal(result.raw,15);assert.ok(Math.abs(result.extra!-20.625)<1e-10);
});
