import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = resolve(import.meta.dirname, '..');
let temp, app, spin, pdf, sideReport, barrel, seasons;
const render = (Component, props) => renderToStaticMarkup(createElement(Component, props));
const circles = html => [...html.matchAll(/<circle\b[^>]*cx="([^"]+)"[^>]*cy="([^"]+)"/g)].map(m => [Number(m[1]), Number(m[2])]);
async function load(file, names) {
  const contents = await readFile(resolve(root, file), 'utf8');
  const output = await build({ stdin: { contents: `${contents}\nexport { ${names.join(', ')} };`, loader: 'tsx', resolveDir: resolve(root, 'app') }, bundle:true, write:false, format:'esm', platform:'node', packages:'external', jsx:'automatic', loader:{'.css':'empty'}, logLevel:'silent' });
  const target = resolve(temp, `${file.split('/').pop()}.mjs`);
  await writeFile(target, output.outputFiles[0].text);
  return import(pathToFileURL(target).href);
}
before(async () => {
  temp = await mkdtemp(resolve(root, '.catcher-test-'));
  [app,spin,pdf,sideReport,barrel,seasons] = await Promise.all([
    load('app/savant-app.tsx',['SearchPitchLocationPlot','SearchPitchShapeLegend','MovementChart','ReleasePlot','ZoneHeatmap','CatcherFramingHeatmap']),
    load('app/pitch-spin-profile.tsx',['PitchLocationChart','MovementCrossChart','SpinScene','clockFromAxis']),
    load('app/batter-pdf-report.tsx',['NineMap']),
    load('app/batter-side-report.tsx',['EVMap']),
    load('app/barrel-zone.tsx',['Heatmap']),
    Promise.all(['2025-fall','2026-spring','2026-fall'].map(async season => JSON.parse(await readFile(resolve(root,`public/data/season-${season}.json`),'utf8')))),
  ]);
});
after(async () => { if(temp) await rm(temp,{recursive:true,force:true}); });

test('actual hit-by-pitches anchor catcher-left/right independently of the chart code in all seasons', () => {
  for(const data of seasons) for(const hand of ['右','左']) {
    const rows=data.pitches.filter(p=>p.result==='死球'&&p.batterSide===hand&&Number.isFinite(p.plateX));
    assert.ok(rows.length>0);
    assert.ok(rows.filter(p=>hand==='右'?p.plateX>0:p.plateX<0).length/rows.length>.95);
    const pitch=rows.find(p=>p.pitchType==='ストレート'); assert.ok(pitch);
    const html=render(app.SearchPitchLocationPlot,{pitches:[pitch],showLegend:false});
    const [[x]]=circles(html);
    assert.ok(hand==='右'?x<210:x>210,`${data.metadata.season} ${hand}打者の死球が打席と同じ側`);
  }
});

test('real right/left sliders keep catcher-view pitch locations and pitcher-view movement',()=>{
  for(const hand of ['右','左']) {
    const p=seasons[1].pitches.find(p=>p.pitchType==='スライダー'&&p.pitcherThrows===hand&&Number.isFinite(p.plateX)&&(hand==='右'?p.hb< -10:p.hb>10));
    assert.ok(p);
    const html=render(app.SearchPitchLocationPlot,{pitches:[p],showLegend:false});
    const vertices=html.match(/<polygon points="([^"]+)"/)[1].split(' ').map(v=>v.split(',').map(Number));
    assert.ok(hand==='右'?vertices[1][0]>vertices[0][0]:vertices[1][0]<vertices[0][0]);
    const [[movementX]]=circles(render(app.MovementChart,{pitches:[p]}));
    assert.ok(hand==='右'?movementX<281:movementX>281);
    const [[crossX]]=circles(render(spin.MovementCrossChart,{pitch:p,color:'blue'}));
    assert.ok(hand==='右'?crossX<65:crossX>65);
    assert.match(render(app.MovementChart,{pitches:[p]}),/投手後方から見た球種別変化量散布図/);
    const legend=render(app.SearchPitchShapeLegend,{pitches:[p]});
    assert.ok(legend.includes(`スライダー（${hand}投手）`));
    assert.ok(!legend.includes(`スライダー（${hand==='右'?'左':'右'}投手）`));
  }
});

test('spin animation and clock use the pitcher view while its location inset stays in catcher view',()=>{
  const profile={label:'スライダー',rotationDirection:-1,seamPlacement:'display'};
  const scene=render(spin.SpinScene,{profile,speed:.05,paused:true});
  assert.match(scene,/data-view="pitcher"/);
  assert.match(scene,/data-rotation-direction="clockwise"/);
  assert.match(scene,/投手後方視点・推定3D回転アニメーション/);
  assert.equal(spin.clockFromAxis(270),'3:00');
  assert.match(render(spin.PitchLocationChart,{pitch:{plateLocSide:.2,plateLocHeight:.9},color:'red'}),/捕手視点/);
});

test('real releases use the same camera: right arm on catcher-left, left arm on catcher-right',()=>{
  for(const hand of ['右','左']) {
    const p=seasons[1].pitches.find(p=>p.pitcherThrows===hand&&Number.isFinite(p.releaseHeight)&&(hand==='右'?p.releaseSide>30:p.releaseSide< -30));
    const [[x]]=circles(render(app.ReleasePlot,{pitches:[p]}));
    assert.ok(hand==='右'?x<215:x>215);
  }
});

test('spin location keeps the same left/right and equal zone scale without clipping wide pitches',()=>{
  for(const side of [-.8,.2]) {
    const html=render(spin.PitchLocationChart,{pitch:{plateLocSide:side,plateLocHeight:.9},color:'red'});
    const [[x]]=circles(html); assert.ok(side>0?x<65:x>65); assert.ok(x>=8&&x<=122);
    const rect=html.match(/<rect x="[^"]+" y="[^"]+" width="([^"]+)" height="([^"]+)"/);
    assert.ok(Math.abs(Number(rect[1])/Number(rect[2])-.508/.6)<1e-10);
  }
});

test('printed nine-area and detailed course maps put positive source locations on the left',()=>{
  const p={plateX:.2,plateZ:.9,result:'インプレー',playResult:'単打',exitVelocity:150};
  const nine=render(pdf.NineMap,{rows:[p],frequency:true});
  assert.match(nine,/<text x="40" y="34"[^>]*>1<\/text>/);
  const detail=render(sideReport.EVMap,{rows:[p]});
  assert.match(detail,/<text x="75" y="82\.055118"[^>]*>150\.0<\/text>/);
});

test('barrel and framing grids keep values and hover targets in the same mirrored cells',()=>{
  const html=render(barrel.Heatmap,{pitches:[{plateX:.2,plateZ:.9,result:'インプレー',exitVelocity:150,launchAngle:20}],metric:'bip',minimum:1,title:'確認'});
  const counts=[...html.matchAll(/<small>(?:n=0|1\/1)<\/small>/g)].map(m=>m[0]);
  assert.equal(counts[6],'<small>1/1</small>');
  const cells=Array.from({length:25},(_,i)=>({pitches:i===8?20:0,extraStrikeRate:.1,actualStrikeRate:.6,expectedStrikeRate:.5}));
  const framing=render(app.CatcherFramingHeatmap,{player:{framingHeatmaps:{右:cells}}});
  assert.match(framing,/<rect[^>]*x="90" y="100"[^>]*aria-label="高め・内角、期待との差プラス10\.0パーセント、20球"/);
});
