import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const baseline=process.argv[2];
if(!/^[0-9a-f]{40}$/.test(baseline??''))throw new Error('Pass the full baseline commit SHA.');
const directory=await mkdtemp(resolve('.performance-check-'));
try {
  const sources=[execFileSync('git',['show',`${baseline}:app/savant-app.tsx`],{encoding:'utf8'}),await readFile('app/savant-app.tsx','utf8')];
  const modules=[];
  for(const [i,source] of sources.entries()){
    const bundle=await build({stdin:{contents:source+'\nexport {batterPitchTypeRows, PlayerView, LeaderboardsView, ShiftView};',resolveDir:resolve('app'),loader:'tsx'},bundle:true,write:false,platform:'node',format:'esm',packages:'external',jsx:'automatic'});
    const file=resolve(directory,`${i}.mjs`);await writeFile(file,bundle.outputFiles[0].text);modules.push(await import(pathToFileURL(file).href));
  }
  const checksum=data=>createHash('sha256').update(JSON.stringify(data)).digest('hex');
  for(const season of ['2026-spring','2026-fall','2025-fall']){
    const data=JSON.parse(await readFile(`public/data/season-${season}.json`,'utf8'));
    const original=checksum(data);
    assert.deepEqual(modules[1].batterPitchTypeRows(data),modules[0].batterPitchTypeRows(data),'Every batter/pitch-type result must be unchanged.');
    let renders=0;
    const compare=(view,props)=>{
      const html=modules.map(m=>renderToStaticMarkup(createElement(m[view],{data,season,navigate:()=>{},news:[],...props})));
      assert.equal(html[1],html[0],`${season}: ${view} markup and numbers changed`);renders++;
    };
    compare('ShiftView',{});
    for(const board of ['batting_pitch_types','batting_profile','pitching_profile'])compare('LeaderboardsView',{board});
    for(const role of ['投手','打者','捕手']){
      const player=data.players.find(p=>p.roles?.includes(role));
      if(player)compare('PlayerView',{player:{...player,roles:[role]}});
    }
    assert.equal(checksum(data),original,'Analysis must not mutate source data.');
    const functions=modules.map(m=>()=>m.batterPitchTypeRows(data));
    for(let i=0;i<15;i++)for(const fn of functions)fn();
    const times=[[],[]];
    for(let i=0;i<50;i++)for(const n of (i%2?[1,0]:[0,1])){const start=performance.now();functions[n]();times[n].push(performance.now()-start);}
    const stats=times.map(a=>{a.sort((a,b)=>a-b);return {medianMs:+a[25].toFixed(3),p95Ms:+a[47].toFixed(3)};});
    console.log(JSON.stringify({season,pitches:data.pitches.length,equalRenderedViews:renders,allResultsEqual:true,sourceDataUnchanged:true,cpuOnly:true,before:stats[0],after:stats[1]}));
  }
} finally {await rm(directory,{recursive:true,force:true});}
