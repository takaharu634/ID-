import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gameScoreboard } from '../lib/game-scoreboard.ts';
const game={id:'g',awayTeam:'A',homeTeam:'B',awayRuns:2,homeRuns:0};
test('counts terminal hits and walks once, includes HBP, and does not invent fielding errors or unplayed innings',()=>{
 const base={gameId:'g',batterTeam:'A',inning:1,runsScored:0};
 const hit={...base,id:'hit',playResult:'二塁打',runsScored:2};
 const b=gameScoreboard(game,[hit,hit,{...base,id:'b1',result:'ボール',balls:2},{...base,id:'bb',korbb:'Walk'},{...base,id:'hbp',result:'死球'},{...base,id:'e',playResult:'失策'},{...base,id:'other',gameId:'other',playResult:'単打'}]);
 assert.equal(b.teams[0].hits,1);assert.equal(b.teams[0].freePasses,2);assert.equal(b.teams[0].reachedOnError,1);assert.equal(b.teams[0].errors,null);assert.equal(b.teams[0].innings[0],2);assert.equal(b.teams[1].innings[8],null);
});
test('extra innings and missing runs remain distinct from zero',()=>{
 const b=gameScoreboard(game,[{gameId:'g',batterTeam:'B',inning:10,runsScored:null}]);assert.equal(b.innings.length,10);assert.equal(b.teams[1].innings[9],null);
});
test('all recorded season game inning sums match existing totals',()=>{
 for(const season of ['2026-fall','2026-spring','2025-fall']){
 const d=JSON.parse(readFileSync(`public/data/season-${season}.json`,'utf8'));
 for(const game of d.games)for(const t of gameScoreboard(game,d.pitches).teams)assert.equal(t.innings.reduce<number>((sum,n)=>sum+(n??0),0),t.runs,`${season} ${game.id} ${t.team}`);
 }
});
