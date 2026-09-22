import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pitchProjection, sprayPoint, fieldFence, ANALYSIS_ZONE } from '../lib/chart-geometry.ts';
const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
test('pitch coordinates use equal scales with symmetric horizontal centre at all report sizes',()=>{
 for(const [width,height] of [[420,350],[420,360],[500,470],[390,500]]) {
  for(const bounds of [{left:-.65,right:.65,bottom:.15,top:1.4},{left:-1.2,right:1.2,bottom:-.4,top:2}]) {
   const p=pitchProjection(width,height,bounds);
   near(p.x(0),width/2);near(p.x(.1)-p.x(0),p.y(0)-p.y(.1));
   near((p.x(ANALYSIS_ZONE.right)-p.x(ANALYSIS_ZONE.left))/(p.y(ANALYSIS_ZONE.bottom)-p.y(ANALYSIS_ZONE.top)),.508/.6);
   assert.ok(p.left>=0 && p.top>=0 && p.left+p.width<=width && p.top+p.height<=height);
  }
 }
});
test('spray centre, foul lines, zero distance and long distances preserve actual geometry',()=>{
 const home=[280,350],scale=2;
 near(sprayPoint(0,100,...home as [number,number],scale).x,280);
 near(sprayPoint(0,100,...home as [number,number],scale).y,150);
 for(const d of [0,5,100,180])for(const a of [-45,0,45]){
  const p=sprayPoint(a,d,280,350,scale);near(Math.hypot(p.x-280,p.y-350),d*scale);
  if(a!==0)near(Math.abs(p.x-280),350-p.y);
 }
 const left=sprayPoint(-45,100,280,350,scale),right=sprayPoint(45,100,280,350,scale);
 near(left.x+right.x,560);near(left.y,right.y);
});
test('reference fence matches 98 m foul poles and 120 m centre',()=>{
 const d=fieldFence(280,350,2),matches=[...d.matchAll(/L([^ ]+) ([^ ]+)/g)].map(m=>[Number(m[1]),Number(m[2])]);
 for(const i of [0,45,90])near(Math.hypot(matches[i][0]-280,matches[i][1]-350),i===45?240:196);
});
