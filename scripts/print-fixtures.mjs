import fs from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const loadFromProject = createRequire(import.meta.url);
import path from 'node:path';
const repo = process.argv[2] || process.cwd();
const savant = JSON.parse(fs.readFileSync(path.join(repo,'package.json'),'utf8')).name === 'tohto-baseball-savant';
const out = path.join(repo,'public/print-qa');
fs.mkdirSync(out,{recursive:true});
const esbuild = loadFromProject(path.join(repo,'node_modules/esbuild'));
const entry = `
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, writeFileSync } from 'node:fs';
import { SearchCountAnalysis, ${savant?'BatterProfileWorkspace, SearchSideAnalysis, BatterApproachCard,':''} } from './app/savant-app';
${savant?"import { DEFAULT_ZONE, annotatePlateAppearances } from './lib/scouting-analytics';":""}
const data=JSON.parse(readFileSync('public/data/season-2026-spring.json','utf8'));
${savant?'data.pitches=annotatePlateAppearances(data.pitches);':''}
const rows=data.pitches.filter(p=>p.pitcherTeam==='青山学院大学');
const ids=[...new Set(rows.map(p=>p.pitcherId))];
const filters={team:'青山学院大学',season:'2026年春季',batterSide:'左右合算',opponent:'全対戦',game:'全試合',count:'全カウント',outs:'全アウト',pitchType:'全球種',period:'全期間'};
const cases=[];
for(const count of [1,2,5,7]) {
 const pitches=rows.filter(p=>ids.slice(0,count).includes(p.pitcherId));
 cases.push({id:'count-'+count,label:count+'投手',kind:'count',mode:count===1?'single':'team',html:renderToStaticMarkup(<SearchCountAnalysis pitches={pitches} filters={filters} ${savant?'minimumSample={5}':''}/>)});
}
const low=rows.slice(0,2).map(p=>({...p,pitcherKanji:'長い投手名の確認用 サンプル投手',pitcher:'Long Name',pitcherId:'long'}));
cases.push({id:'low',label:'少数・長い名前',kind:'count',mode:'single',html:renderToStaticMarkup(<SearchCountAnalysis pitches={low} filters={filters} ${savant?'minimumSample={5}':''}/>)});
${savant?`
for (const side of ['右','左']) {
 const player=data.batters.find(p=>p.team==='青山学院大学' && data.pitches.some(r=>r.batterId===p.id&&r.batterSide===side));
 const pitches=data.pitches.filter(p=>p.batterId===player.id);
 cases.push({id:'profile-'+side,label:side+'打者',kind:'batter-profile',mode:'single',html:renderToStaticMarkup(<BatterProfileWorkspace player={player} pitches={pitches} leaguePitches={data.pitches} thresholdLeaguePitches={data.pitches} seasonLabel='2026年春季'/>)});
}
cases.push({id:'side',label:'左右別',kind:'side',mode:'single',html:renderToStaticMarkup(<SearchSideAnalysis pitches={rows.filter(p=>p.pitcherId===ids[0])} filters={{...filters,player:'青山学院投手'}} minimumSample={5} zone={DEFAULT_ZONE}/>)});
const batter=data.batters.find(p=>p.team==='青山学院大学');
cases.push({id:'approach',label:'打者アプローチ',kind:'approach',mode:'single',html:renderToStaticMarkup(<BatterApproachCard pitches={data.pitches.filter(p=>p.batterId===batter.id)} leaguePitches={data.pitches} batter={batter} filters={filters} minimumSample={5} zone={DEFAULT_ZONE}/>)});
`:''}
const all=cases.map(c=>'<section id="'+c.id+'"><h2>'+c.label+'</h2><button data-case="'+c.id+'" data-kind="'+c.kind+'" data-mode="'+c.mode+'">'+c.label+'のプレビュー</button><div class="fixture-report">'+c.html+'</div></section>').join('');
writeFileSync('public/print-qa/index.html','<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="./style.css"><style>body{padding:20px}.fixture-report{display:none}body>section{margin:10px}button{padding:12px;font-size:16px}</style><body><h1>印刷回帰の確認専用</h1>'+all+'<section id="oversize"><button data-case="oversize" data-kind="count" data-mode="single">はみ出し検出</button><div class="fixture-report"><div class="count-print-root"><div class="count-single-print-content"><div style="height:250mm">用紙より大きい資料</div></div></div></div></section><section id="empty"><button data-case="empty" data-kind="count" data-mode="single">白紙検出</button><div class="fixture-report"><div class="count-print-root"><div class="count-single-print-content"></div></div></div></section><script type="module" src="./preview.js"></script></body></html>');
`;
esbuild.build({stdin:{contents:entry,resolveDir:repo,sourcefile:'fixture-entry.tsx',loader:'tsx'},define:{'process.env.NODE_ENV':'"production"'},bundle:true,platform:'node',format:'cjs',outfile:path.join(out,'render.cjs'),jsx:'automatic',plugins:[{name:'test-exports',setup(b){b.onLoad({filter:/app\/savant-app\.tsx$/},args=>({contents:fs.readFileSync(args.path,'utf8')+'\nexport { SearchCountAnalysis'+(savant?', BatterProfileWorkspace, SearchSideAnalysis, BatterApproachCard':'')+' };',loader:'tsx'}));}}]}).then(()=>{
 execFileSync(process.execPath,[path.join(out,'render.cjs')],{cwd:repo,stdio:'inherit'});
 fs.unlinkSync(path.join(out,'render.cjs'));
 fs.writeFileSync(path.join(out,'style.css'),fs.readFileSync(path.join(repo,'app/globals.css'),'utf8')+'\n'+fs.readFileSync(path.join(repo,'app/report-print.css'),'utf8')+'\n'+fs.readFileSync(path.join(repo,'app/print-preview.css'),'utf8'));
 esbuild.buildSync({stdin:{contents:`import {printReport} from './app/print-report';document.querySelectorAll('[data-case]').forEach(b=>b.addEventListener('click',()=>printReport('#'+b.dataset.case+' .'+(b.dataset.kind==='count'?'count-print-root':b.dataset.kind==='side'?'side-report-root':b.dataset.kind==='approach'?'approach-card-root':'batter-profile-print-root'),b.dataset.kind,b.dataset.mode)));`,resolveDir:repo,loader:'ts'},bundle:true,platform:'browser',format:'esm',outfile:path.join(out,'preview.js')});
 console.log('Print fixtures ready');
});
