import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildShiftProfile, depthProfile, fieldSectorOf, validDepthBall, shiftHitType } from '../lib/defensive-shift.ts';
const ball=(extra={})=>({result:'インプレー',hitType:'LineDrive',exitVelocity:120,launchAngle:20,distance:60,sprayAngle:-25,batterSide:'右',pitcherThrows:'右',batterId:'b',...extra});
const repeat=(n:number,extra={})=>Array.from({length:n},()=>ball(extra));
test('missing and invalid geometry never supplies a valid depth observation',()=>{
 for(const extra of [{sprayAngle:null,direction:null},{exitVelocity:null},{launchAngle:null},{distance:null},{sprayAngle:46},{hitType:'Bunt'},{launchAngle:51}]) assert.equal(validDepthBall(ball(extra)),false);
 assert.equal(fieldSectorOf(ball({sprayAngle:0})),'中堅');
 assert.equal(shiftHitType(ball({hitType:'GroundBall',launchAngle:20})),'AirBall');
});
test('sample thresholds and long-ball guard prevent unsupported front positioning',()=>{
 const peers=repeat(30,{distance:100,batterId:'peer'});
 assert.equal(depthProfile(repeat(4),peers).decision,'維持');
 assert.equal(depthProfile(repeat(6),peers.slice(0,19)).decision,'維持');
 assert.equal(depthProfile(repeat(6),peers).decision,'前進');
 assert.equal(depthProfile(repeat(6,{exitVelocity:160}),peers).decision,'標準');
 assert.equal(depthProfile(repeat(10,{distance:140,exitVelocity:180}),peers).decision,'後退');
});
test('pitcher hand changes both direction and depth without moving empty sectors',()=>{
 const rows=[...repeat(10),...repeat(10,{pitcherThrows:'左',sprayAngle:25,distance:140,exitVelocity:180})];
 const peers=[...repeat(30,{batterId:'peer',distance:100}),...repeat(30,{batterId:'peer',pitcherThrows:'左',sprayAngle:25,distance:100})];
 const player={id:'b',side:'右'};
 const right=buildShiftProfile(player,rows,peers,'右'),left=buildShiftProfile(player,rows,peers,'左');
 assert.equal(right.outfieldTarget,'pull'); assert.equal(left.outfieldTarget,'opposite');
 assert.deepEqual(right.outfielders.map(f=>f.depth.decision),['前進','維持','維持']);
 assert.deepEqual(left.outfielders.map(f=>f.depth.decision),['維持','維持','後退']);
 assert.equal(right.outfieldConditional,true);
});
test('Ohkido spring supports left-field front candidate; autumn does not',()=>{
 for(const season of ['spring','fall']) {
  const d=JSON.parse(readFileSync(new URL(`../public/data/season-2026-${season}.json`,import.meta.url),'utf8'));
  const p=d.batters.find((b:any)=>b.kanji?.includes('大城戸'));
  const rows=d.pitches.filter((r:any)=>r.batterId===p.id);
  const profile=buildShiftProfile(p,rows,d.pitches);
  assert.deepEqual(profile.outfielders.map(f=>f.depth.decision),season==='spring'?['前進','維持','維持']:['維持','維持','維持']);
  if(season==='spring') {
   assert.equal(buildShiftProfile(p,rows,d.pitches,'右').outfielders[0].depth.decision,'維持');
   assert.equal(buildShiftProfile(p,rows,d.pitches,'左').outfielders[0].depth.decision,'前進');
  }
 }
});
