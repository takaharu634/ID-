import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
let temp, analytics, Report, PdfReport;
before(async()=>{
  temp=await mkdtemp(resolve('.batter-side-test-'));
  for (const [name,entry] of [['analytics','lib/batter-side-report.ts'],['report','app/batter-side-report.tsx']]) {
    const output=resolve(temp,`${name}.mjs`);
    await build({entryPoints:[entry],outfile:output,bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic'});
    const mod=await import(pathToFileURL(output).href);
    if(name==='analytics')analytics=mod;else { Report=mod.BatterSideDetail; PdfReport=mod.default; }
  }
});
after(async()=>{await rm(temp,{recursive:true,force:true});});
test('terminal pitch average excludes sacrifices and intermediate strikes, counts errors and strikeouts',()=>{
  const rows=[
    ...['単打','二塁打','本塁打','アウト','失策','野選','アウト'].map(playResult=>({result:'インプレー',playResult})),
    {result:'空振り',strikes:2},{result:'見逃しストライク',strikes:2},{result:'ファウル',strikes:2,korbb:'Strikeout'},
    {result:'ファウル',strikes:2},{result:'空振り',strikes:1},{result:'見逃しストライク',strikes:0},
    {result:'ボール',balls:3},{result:'死球'},
    ...['犠打','犠飛','犠打・犠飛'].map(playResult=>({result:'インプレー',playResult}))
  ];
  assert.equal(analytics.reportAverage(rows),'.300（10–3）');
  assert.equal(analytics.reportAverage([]),'—（0–0）');
});
test('group and direction rules, missing EV and location remain missing',()=>{
  assert.equal(analytics.batterFamily('ツーシーム'),'ストレート系');
  assert.equal(analytics.batterFamily('スライダー'),'曲がる系');
  assert.equal(analytics.batterFamily('フォーク'),'落ちる系');
  assert.equal(analytics.reportDirection({sprayAngle:-30,batterSide:'右'}),'引張');
  assert.equal(analytics.reportDirection({sprayAngle:-30,batterSide:'左'}),'逆方向');
  assert.equal(analytics.reportDirection({sprayAngle:null,batterSide:'右'}),null);
  assert.equal(analytics.reportZone({plateX:null,plateZ:null}),null);
  assert.deepEqual(analytics.reportEV([{result:'インプレー',exitVelocity:null},{result:'ファウル',exitVelocity:170}]),{n:0,avg:null,max:null});
});
test('real spring and autumn hitter renders six families and independent terminal averages',async()=>{
  for(const season of ['2026-spring','2026-fall']){
    const data=JSON.parse(await readFile(`public/data/season-${season}.json`,'utf8'));
    const batter=data.batters.find(b=>data.pitches.filter(p=>p.batterId===b.id).length>20);
    const pitches=data.pitches.filter(p=>p.batterId===batter.id);
    const html=renderToStaticMarkup(createElement(Report,{pitches,label:season,locationPlot:()=>createElement('svg',{'aria-label':'投球結果'}),legend:'凡例'}));
    assert.equal((html.match(/class="bs-family"/g)||[]).length,6);
    assert.match(html,/対右投手/);assert.match(html,/対左投手/);
    assert.match(html,/平均打球速度/);assert.match(html,/打球方向/);
    assert.doesNotMatch(html,/計算式|参考値|まっすぐ|真っすぐ/);
    for(const side of ['右','左'])for(const family of analytics.BATTER_FAMILIES){
      const rows=pitches.filter(p=>p.pitcherThrows===side&&analytics.batterFamily(p.pitchType)===family);
      const terminal=rows.filter(p=>!['犠打','犠飛','犠打・犠飛'].includes(p.playResult)&&(p.result==='インプレー'||p.korbb==='Strikeout'||(p.strikes===2&&['空振り','見逃しストライク'].includes(p.result))));
      const h=terminal.filter(p=>['単打','二塁打','三塁打','本塁打'].includes(p.playResult)).length;
      const expected=`${terminal.length?(h/terminal.length).toFixed(3).replace(/^0/,''):'—'}（${terminal.length}–${h}）`;
      assert.ok(html.includes(expected));
    }
  }
});

test('PDF statistics preserve missing RBI and distinguish sacrifice fly denominators',()=>{
  const rows=[{result:'インプレー',playResult:'本塁打',runsScored:3,runnerStateCode:'3'}, {result:'インプレー',playResult:'失策'}, {korbb:'Walk',result:'ボール',balls:3}, {result:'死球'}, {result:'インプレー',playResult:'犠打'}, {result:'インプレー',playResult:'犠飛'}];
  const s=analytics.reportStats(rows);
  assert.equal(s.ab,2); assert.equal(s.hits,1); assert.equal(s.hr,1);
  assert.equal(s.slg,2); assert.equal(s.obp,3/5); assert.equal(s.rbi,null);
  assert.equal(analytics.reportStats([...rows,{result:'インプレー',playResult:'犠打・犠飛'}]).obp,null);
  assert.equal(analytics.reportRisp(rows).length,1);
  assert.equal(analytics.reportRisp([{runnerStateCode:'unknown'},{runnerStateCode:null},{runnerStateCode:'1'}]).length,0);
  assert.equal(analytics.reportNineZone({plateX:null,plateZ:null}),null);
  assert.equal(analytics.reportNineZone({plateX:-1,plateZ:2}),0);
  assert.equal(analytics.reportNineZone({plateX:0,plateZ:.75}),4);
  assert.equal(analytics.reportNineZone({plateX:1,plateZ:.1}),8);
});
test('PDF layout shows one selected player with nine-area charts, mix, counts and paired stats',async()=>{
  const data=JSON.parse(await readFile('public/data/season-2026-fall.json','utf8'));
  const pitches=data.pitches.filter(p=>p.batterTeam==='國學院大學');
  assert.ok(pitches.length);
  const html=renderToStaticMarkup(createElement(PdfReport,{pitches,label:'2026年秋・全期間',locationPlot:()=>createElement('svg',null,createElement('circle',{r:1})),legend:'凡例'}));
  assert.equal((html.match(/class="bs-sheet bp-sheet"/g)||[]).length,1);
  assert.equal((html.match(/class="bp-stats"/g)||[]).length,2);
  for(const text of ['表示する選手','PDF形式','9エリア別打率','9エリア別投球割合','カウント別球種','この選手をA4横で印刷','得点圏（推定）']) {
    assert.ok(html.includes(text),text);
  }
  assert.doesNotMatch(html,/NaN|Infinity/);
});
