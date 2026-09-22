import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
test('actual autumn React screen exposes all 8 umpires, map, breakdowns and honest adjustment labels',async()=>{
 const dir=await mkdtemp(resolve('.umpire-render-'));
 try{
 const out=await build({entryPoints:['app/umpire-analysis.tsx'],bundle:true,write:false,platform:'node',format:'esm',packages:'external',jsx:'automatic'});
 const entry=resolve(dir,'view.mjs');await writeFile(entry,out.outputFiles[0].text);const {default:View}=await import(pathToFileURL(entry));
 const data=JSON.parse(await readFile('public/data/season-2026-fall.json','utf8'));const html=renderToStaticMarkup(createElement(View,{data}));
 for(const name of ['岩崎','吉田','大槻','福壽','寺尾','川合','石丸','熊倉','審判 × 捕手','50%判定境界','参考フレーミング','カウント別','左右打者別','球種別','試合別','件数区分'])assert.ok(html.includes(name),name);
 assert.match(html,/<svg/);assert.match(html,/球審登録 8試合/);assert.match(html,/aria-label="領域1/);assert.doesNotMatch(html,/NaN|Infinity/);
 const spring=JSON.parse(await readFile('public/data/season-2026-spring.json','utf8'));const empty=renderToStaticMarkup(createElement(View,{data:spring}));assert.match(empty,/球審情報は未登録/);assert.doesNotMatch(empty,/<svg/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
