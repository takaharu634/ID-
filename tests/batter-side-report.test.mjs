import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
let temp, analytics, Report, PdfReport, SearchView, DirectionReport, OpponentPacket;
before(async()=>{
  temp=await mkdtemp(resolve('.batter-side-test-'));
  for (const [name,entry] of [['analytics','lib/batter-side-report.ts'],['report','app/batter-side-report.tsx'],['directions','app/opponent-report.tsx']]) {
    const output=resolve(temp,`${name}.mjs`);
    await build({entryPoints:[entry],outfile:output,bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic'});
    const mod=await import(pathToFileURL(output).href);
    if(name==='analytics')analytics=mod;else if(name==='directions'){DirectionReport=mod.BatterDirectionReport;OpponentPacket=mod.OpponentPacket;}else { Report=mod.BatterSideDetail; PdfReport=mod.default; }
  }
  const source=await readFile('app/savant-app.tsx','utf8');
  const searchOutput=resolve(temp,'search.mjs');
  await build({stdin:{contents:source+'\nexport { SearchView };',loader:'tsx',resolveDir:resolve('app')},outfile:searchOutput,bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic',loader:{'.css':'empty'}});
  SearchView=(await import(pathToFileURL(searchOutput).href)).SearchView;
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

test('pitcher report pools different batters and splits by batting side, including switch hitters',()=>{
  const pitch=(changes)=>({pitcherId:'p1',pitcher:'投手一',pitcherTeam:'中央大学',pitcherThrows:'右',batterId:'b1',batter:'打者一',batterTeam:'立正大学',batterSide:'右',pitchType:'ストレート',result:'インプレー',playResult:'アウト',date:'2026-09-24',plateX:0,plateZ:.75,...changes});
  const rows=[
    pitch({playResult:'単打'}),
    pitch({batterId:'b2',batter:'打者二',result:'空振り',strikes:2}),
    pitch({batterSide:'左',playResult:'二塁打'}),
    pitch({batterId:'b3',batter:'打者三',batterSide:'左'}),
    pitch({batterId:'b4',batterSide:'不明',playResult:'本塁打'}),
    pitch({pitcherId:'p2',pitcher:'投手二',pitcherThrows:'左',playResult:'本塁打'}),
  ];
  const groups=analytics.reportPlayerGroups(rows,'pitcher');
  assert.equal(groups.length,2);
  const group=groups.find(g=>g[0].pitcherId==='p1');
  assert.equal(group.length,5);
  const seen=[];
  const html=renderToStaticMarkup(createElement(PdfReport,{pitches:group,perspective:'pitcher',label:'通算',locationPlot:(subset)=>{seen.push(subset);return createElement('svg');},legend:'凡例'}));
  assert.deepEqual(seen.map(g=>g.length),[2,2]);
  assert.deepEqual(seen.map(g=>analytics.reportAverage(g)),['.500（2–1）','.500（2–1）']);
  assert.match(html,/表示する投手/); assert.match(html,/対右打者/); assert.match(html,/対左打者/);
  assert.match(html,/打者左右不明：1球/);
  assert.doesNotMatch(html,/対右投手|対左投手|NaN|Infinity/);
  assert.equal((html.match(/class="bs-sheet bp-sheet"/g)||[]).length,1);
});

test('real spring and autumn right- and left-handed pitchers include every opponent in each side',async()=>{
  for(const season of ['2026-spring','2026-fall']) {
    const data=JSON.parse(await readFile(`public/data/season-${season}.json`,'utf8'));
    for(const throwing of ['右','左']) {
      const pitcher=data.pitchers.find(p=>{
        const rows=data.pitches.filter(r=>r.pitcherId===p.id);
        return rows[0]?.pitcherThrows===throwing && ['右','左'].every(side=>rows.filter(r=>r.batterSide===side).length>20);
      });
      assert.ok(pitcher,`${season} ${throwing}`);
      const pitches=data.pitches.filter(p=>p.pitcherId===pitcher.id);
      const captured=[];
      const props={pitches,perspective:'pitcher',label:season,locationPlot:rows=>{captured.push(rows);return createElement('svg');},legend:'凡例'};
      const html=renderToStaticMarkup(createElement(PdfReport,props));
      for(const [index,side] of ['右','左'].entries()) {
        const expected=pitches.filter(p=>p.batterSide===side);
        assert.deepEqual(captured[index].map(p=>p.id),expected.map(p=>p.id));
        assert.ok(new Set(expected.map(p=>p.batterId)).size>1);
      }
      const detail=renderToStaticMarkup(createElement(Report,props));
      assert.equal((detail.match(/class="bs-family"/g)||[]).length,6);
      assert.equal((detail.match(/class="bs-sheet"/g)||[]).length,1);
      for(const side of ['右','左'])for(const family of analytics.BATTER_FAMILIES) {
        const subset=pitches.filter(p=>p.batterSide===side&&analytics.batterFamily(p.pitchType)===family);
        assert.ok(detail.includes(analytics.reportAverage(subset)));
      }
      assert.match(html,/対右打者/);assert.match(html,/対左打者/);
      assert.doesNotMatch(html+detail,/NaN|Infinity/);
    }
  }
});

test('pitcher report handles an empty selection and a side with no opponents',()=>{
  const props={perspective:'pitcher',label:'対象期間',locationPlot:()=>createElement('svg'),legend:'凡例'};
  const empty=renderToStaticMarkup(createElement(PdfReport,{...props,pitches:[]}));
  assert.match(empty,/対象データがありません/);
  const pitches=[{pitcherId:'p',pitcher:'投手',pitcherTeam:'中央大学',pitcherThrows:'左',batterId:'b',batterSide:'右',pitchType:'スライダー',result:'見逃しストライク',strikes:2,date:'2026-09-24'}];
  const html=renderToStaticMarkup(createElement(PdfReport,{...props,pitches}));
  assert.match(html,/対左打者/);assert.match(html,/—（0–0）/);
  assert.doesNotMatch(html,/NaN|Infinity/);
});


test('search pitcher tab overrides stale batter filters while preserving opponent, count and date',async()=>{
  const data=JSON.parse(await readFile('public/data/season-2026-fall.json','utf8'));
  const sample=data.pitches.find(p=>p.pitcherTeam==='中央大学'&&p.balls===0&&p.strikes===0);
  const state={analysisMode:'pitcherBatterSides',pitcher:sample.pitcherId,team:sample.pitcherTeam,opponent:sample.batterTeam,batter:'stale-batter-id',batterSide:'左',count:'0-0',fromDate:sample.date,toDate:sample.date};
  const scope=`search|${data.metadata.season}`;
  const search='?'+new URLSearchParams({'条件先':scope,'条件':JSON.stringify(state)});
  const previous=globalThis.window;
  globalThis.window={location:{search},sessionStorage:{getItem:()=>null}};
  try {
    const html=renderToStaticMarkup(createElement(SearchView,{data,navigate:()=>{}}));
    const expected=data.pitches.filter(p=>p.pitcherId===sample.pitcherId&&p.pitcherTeam===sample.pitcherTeam&&p.batterTeam===sample.batterTeam&&p.balls===0&&p.strikes===0&&p.date===sample.date);
    assert.ok(expected.length>1);
    assert.match(html,new RegExp(`<div class="result-head"><div><strong>${expected.length}</strong>`));
    assert.match(html,/対右打者/);assert.match(html,/対左打者/);
    assert.match(html,/<label>打者<select disabled=""/);
    assert.match(html,/<label>打者の左右<select disabled=""/);
    assert.doesNotMatch(html,/対象データがありません/);
    assert.equal((html.match(/class="bs-sheet bp-sheet"/g)||[]).length,1);
  } finally { if(previous===undefined)delete globalThis.window;else globalThis.window=previous; }
});

test('direction report combines different hitters by batting side rather than throwing side',()=>{
  const base={pitcherId:'p',pitcherThrows:'左',batterTeam:'B',result:'インプレー',hitType:'GroundBall',distance:50,sprayAngle:-20,pitchType:'ストレート',playResult:'アウト'};
  const pitches=[
    {...base,id:'r1',batterId:'r1',batterSide:'右'},
    {...base,id:'r2',batterId:'r2',batterSide:'右',pitcherThrows:'右'},
    {...base,id:'l1',batterId:'l1',batterSide:'左'},
    {...base,id:'rb',batterId:'r3',batterSide:'右',pitchType:'スライダー',hitType:'LineDrive',playResult:'単打'},
    {...base,id:'lb',batterId:'l2',batterSide:'左',pitchType:'フォーク',hitType:'FlyBall'},
    {...base,id:'unknown',batterSide:'不明'},
    {...base,id:'missing-distance',batterSide:'左',distance:null},
    {...base,id:'foul',batterSide:'右',result:'ファウル'},
    {...base,id:'bunt',batterSide:'右',hitType:'Bunt'},
  ];
  const html=renderToStaticMarkup(createElement(DirectionReport,{pitches,label:'対象期間'}));
  assert.match(html,/右打者・左打者の通算/);
  assert.doesNotMatch(html,/表示する選手|<select|対右投手|対左投手/);
  for(const [side,group,count] of [['右','ストレート',2],['左','ストレート',1],['右','変化球',1],['左','変化球',1]]) {
    assert.match(html,new RegExp(`<h3>対${side}打者・${group}</h3>[\\s\\S]*?<text[^>]*>${count}打球</text>`));
  }
  assert.equal((html.match(/class="batted-direction-chart"/g)||[]).length,4);
  assert.match(html,/stroke-dasharray="1 3"/);assert.match(html,/stroke-dasharray="9 5"/);assert.match(html,/#cf202f/);
  const empty=renderToStaticMarkup(createElement(DirectionReport,{pitches:[],label:'全期間'}));
  assert.match(empty,/対象データがありません/);assert.match(empty,/<button[^>]*disabled=""/);
  assert.doesNotMatch(html+empty,/NaN|Infinity/);
});

test('search direction totals ignore stale hitter and batting-side selections but preserve pitcher, team, opponent, count and period',async()=>{
  const data=JSON.parse(await readFile('public/data/season-2026-fall.json','utf8'));
  const sample=data.pitches.find(p=>p.pitcherTeam==='中央大学'&&p.balls===0&&p.strikes===0);
  const state={analysisMode:'batterDirections',pitcher:sample.pitcherId,team:sample.pitcherTeam,opponent:sample.batterTeam,batter:'stale-batter-id',batterSide:'左',count:'0-0',fromDate:sample.date,toDate:sample.date};
  const scope=`search|${data.metadata.season}`;
  const previous=globalThis.window;
  globalThis.window={location:{search:'?'+new URLSearchParams({'条件先':scope,'条件':JSON.stringify(state)})},sessionStorage:{getItem:()=>null}};
  try {
    const html=renderToStaticMarkup(createElement(SearchView,{data,navigate:()=>{}}));
    const expected=data.pitches.filter(p=>p.pitcherId===sample.pitcherId&&p.pitcherTeam===sample.pitcherTeam&&p.batterTeam===sample.batterTeam&&p.balls===0&&p.strikes===0&&p.date===sample.date);
    assert.ok(new Set(expected.map(p=>p.batterId)).size>1);
    assert.match(html,new RegExp(`<div class="result-head"><div><strong>${expected.length}</strong>`));
    assert.match(html,/右打者・左打者の通算/);assert.match(html,/投手大学:中央大学/);
    assert.match(html,/<label>打者<select disabled=""/);assert.match(html,/<label>打者の左右<select disabled=""/);
    assert.doesNotMatch(html,/表示する選手|対象データがありません/);
    const directionSection=html.slice(html.indexOf('class="direction-report"'));
    for(const side of ['右','左'])for(const group of ['ストレート','変化球']) {
      const drawable=expected.filter(p=>p.batterSide===side&&(group==='ストレート'?p.pitchType==='ストレート':['カットボール','シンカー','ツーシーム','スライダー','カーブ','ナックル','特殊球','フォーク','スプリット','チェンジアップ'].includes(p.pitchType))&&p.result==='インプレー'&&p.hitType!=='Bunt'&&Number.isFinite(p.sprayAngle??p.direction)&&Math.abs(p.sprayAngle??p.direction)<=45&&Number.isFinite(p.distance)&&p.distance>=0);
      assert.match(directionSection,new RegExp(`<h3>対${side}打者・${group}</h3>[\\s\\S]*?<text[^>]*>${drawable.length?`${drawable.length}打球`:'打球データなし'}</text>`));
    }
  } finally {if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});

test('walk-tagged hit-by-pitches count as one reach in the OBP denominator',()=>{
  const rows=[{result:'インプレー',playResult:'単打'},...Array.from({length:3},()=>({result:'インプレー',playResult:'アウト'})),{result:'死球',korbb:'Walk',balls:3}];
  assert.equal(analytics.reportStats(rows).obp,.4);
});

test('report periods sort calendar dates and exclude missing or invalid values',()=>{
  const rows=['2025/10/7','2025-10-24','2025/9/2','','bad','2025-02-30'].map(date=>({date}));
  assert.equal(analytics.reportPeriod(rows),'2025-09-02〜2025-10-24');
  assert.equal(analytics.reportPeriod([{date:null},{date:''}]),'不明');
});

 test('opponent packet independently includes pitcher side analysis and omits movement from count sheets',async()=>{
  const {pitches}=JSON.parse(await readFile('public/data/season-2026-fall.json','utf8'));
  const first=pitches.find(p=>p.pitcherTeam==='中央大学');
  const rows=pitches.filter(p=>p.pitcherId===first.pitcherId&&p.pitcherTeam===first.pitcherTeam);
  const player={id:first.pitcherId,name:first.pitcherKanji||first.pitcher,team:first.pitcherTeam,pitches:rows};
  const props={team:first.pitcherTeam,label:'2026秋',pitchers:[player],batters:[],teamBatting:[],countMatrix:()=>createElement('p',null,'カウント表'),locationPlot:()=>null,legend:null,pitchColors:{}};
  const render=include=>renderToStaticMarkup(createElement(OpponentPacket,{...props,include}));
  const counts=render({pitchers:true});
  assert.equal((counts.match(/class="opponent-print-page/g)||[]).length,2);
  assert.match(counts,/球種別球速/);
  assert.match(counts,/平均/);assert.match(counts,/最高/);
  assert.doesNotMatch(counts,/変化|左右別打者分析（投手）/);
  const sides=render({pitcherBatterSides:true});
  assert.equal((sides.match(/class="opponent-print-page/g)||[]).length,1);
  assert.match(sides,/左右別打者分析（投手）/);
  assert.match(sides,/対右打者/);assert.match(sides,/対左打者/);
  assert.match(sides,new RegExp(player.name));
  assert.doesNotMatch(sides,/カウント別投球分析/);
  assert.equal((render({pitchers:true,pitcherBatterSides:true}).match(/class="opponent-print-page/g)||[]).length,3);
  assert.equal(render({}), '');
 });
