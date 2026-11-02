import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
let temp, pages, Picker, pitches, games;
before(async()=>{
  temp=await mkdtemp(resolve('.analysis-print-test-'));
  for(const [name,entry] of [['pages','app/search-table-print.tsx'],['picker','app/analysis-print-selection.tsx']]) {
    const outfile=resolve(temp,`${name}.mjs`);
    await build({entryPoints:[entry],outfile,bundle:true,platform:'node',format:'esm',packages:'external',jsx:'automatic'});
    const mod=await import(pathToFileURL(outfile).href);
    if(name==='pages')pages=mod;else Picker=mod.default;
  }
  ({pitches,games}=JSON.parse(await readFile('public/data/season-2026-fall.json','utf8')));
});
after(async()=>{await rm(temp,{recursive:true,force:true});});
test('pitch list print includes every filtered pitch beyond the screen pagination and no other pitcher',()=>{
  const id=pitches.find(p=>p.pitcherTeam==='中央大学').pitcherId;
  const rows=pitches.filter(p=>p.pitcherId===id);
  assert.ok(rows.length>250);
  const html=renderToStaticMarkup(h(pages.PitchListPrintPages,{rows,label:'秋・検索条件'}));
  assert.equal((html.match(/class="analysis-print-page"/g)||[]).length,Math.ceil(rows.length/20));
  assert.equal((html.match(/<tbody>/g)||[]).length,Math.ceil(rows.length/20));
  assert.equal((html.match(/<tr>/g)||[]).length,rows.length+Math.ceil(rows.length/20));
  assert.ok(html.includes('秋・検索条件'));
});
test('game print generates a separate report for each selected pitcher appearance',()=>{
  const id=pitches.find(p=>p.pitcherTeam==='中央大学').pitcherId;
  const rows=pitches.filter(p=>p.pitcherId===id), first=rows[0];
  const html=renderToStaticMarkup(h(pages.GameLogPrintPages,{rows,allPitches:pitches,games,pitcher:{id,name:first.pitcher,team:first.pitcherTeam},label:'条件'}));
  assert.equal((html.match(/class="analysis-print-page"/g)||[]).length,new Set(rows.map(p=>p.gameId)).size);
  assert.ok(html.includes('平均回転数'));
  assert.ok(html.includes('最高球速の投球'));
});
test('empty candidates disable printing; collapsed picker does not pre-render reports',()=>{
  let calls=0;
  const html=renderToStaticMarkup(h(Picker,{pitches:[],kind:'side',renderPages:()=>{calls++;return 'report';}}));
  assert.match(html,/対象選手がいません/);
  assert.match(html,/disabled=""/);
  assert.equal(calls,0);
  assert.doesNotMatch(html,/analysis-selected-print-source/);
});
