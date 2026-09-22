import assert from "node:assert/strict";
import test from "node:test";
import { annotatePlateAppearances } from "../lib/scouting-analytics.ts";
import {
  buildBatterProfile,
  buildStrongContactThresholds,
  calculateProfileMetrics,
  catcherViewZoneOrder,
  confidenceFor,
  filterBatterProfilePitches,
  movementDirection,
  pitchGroup,
  sprayDirection,
} from "../lib/batter-profile.ts";

function pitch(overrides: Record<string, unknown> = {}) {
  return { id: crypto.randomUUID(), gameId:"g1", inning:1, half:"表", year:2026, season:"春", batterId:"b1", batterSide:"右", pitcherThrows:"右", pitchType:"ストレート", balls:0, strikes:0, result:"ボール", plateX:0, plateZ:.75, hb:0, velocity:145, exitVelocity:null, hitType:"Undefined", playResult:"", ...overrides };
}

test("球種表記を7つの正式グループへ正規化する",()=>{
  assert.equal(pitchGroup("Fastball"),"直球系");
  assert.equal(pitchGroup("Two-Seam"),"動く速球系");
  assert.equal(pitchGroup("Sweeper"),"横変化系");
  assert.equal(pitchGroup("ChangeUp"),"チェンジ系");
  assert.equal(pitchGroup("Undefined"),"その他");
});

test("強い打球基準は各シーズンの有効打球75パーセンタイルで再計算する",()=>{
  const rows=[100,110,120,130,200].map((ev,index)=>pitch({year:index===4?2025:2026,season:index===4?"秋":"春",result:"インプレー",exitVelocity:ev,hitType:"LineDrive"}));
  const thresholds=buildStrongContactThresholds(rows);
  assert.equal(thresholds.find(row=>row.season==="2026年春")?.value,122.5);
  assert.equal(thresholds.find(row=>row.season==="2025年秋")?.value,200);
});

test("Swing・Contact・Whiff・Zone・Chaseの分子分母が共通定義と一致する",()=>{
  const rows=annotatePlateAppearances([
    pitch({result:"空振り",plateX:0,plateZ:.75}),
    pitch({balls:0,strikes:1,result:"ファウル",plateX:0,plateZ:.75}),
    pitch({balls:0,strikes:2,result:"インプレー",plateX:.5,plateZ:.75,exitVelocity:140,hitType:"LineDrive",playResult:"単打"}),
    pitch({balls:0,strikes:0,result:"見逃しストライク",plateX:.5,plateZ:.75}),
    pitch({balls:0,strikes:1,result:"ボール",plateX:.5,plateZ:.75}),
  ]);
  const metrics=calculateProfileMetrics(rows,buildStrongContactThresholds(rows));
  assert.deepEqual([metrics.swing.numerator,metrics.swing.denominator],[3,5]);
  assert.deepEqual([metrics.contact.numerator,metrics.contact.denominator],[2,3]);
  assert.deepEqual([metrics.whiff.numerator,metrics.whiff.denominator],[1,3]);
  assert.deepEqual([metrics.zoneSwing.numerator,metrics.zoneSwing.denominator],[2,2]);
  assert.deepEqual([metrics.chase.numerator,metrics.chase.denominator],[1,3]);
});

test("外角と引っ張り、入る／逃げる方向を打者左右で反転する",()=>{
  assert.equal(sprayDirection(pitch({direction:-25}),"右"),"引っ張り");
  assert.equal(sprayDirection(pitch({direction:-25}),"左"),"逆方向");
  assert.equal(movementDirection(pitch({batterSide:"右",hb:20})),"打者へ入る");
  assert.equal(movementDirection(pitch({batterSide:"左",hb:20})),"打者から逃げる");
});

test("コースマップは左右打者とも捕手視点の左右順で表示する",()=>{
  const zones=Array.from({length:9},(_,index)=>({index}));
  assert.deepEqual(catcherViewZoneOrder(zones,"右").map((zone)=>zone.index),[0,1,2,3,4,5,6,7,8]);
  assert.deepEqual(catcherViewZoneOrder(zones,"左").map((zone)=>zone.index),[2,1,0,5,4,3,8,7,6]);
});

test("詳細条件で145km/h以上の直球と外角ゾーン外を抽出する",()=>{
  const rows=[pitch({velocity:146,plateX:-.4}),pitch({velocity:144,plateX:-.4}),pitch({velocity:148,pitchType:"スライダー",plateX:-.4}),pitch({velocity:149,plateX:.1}),pitch({pitchType:"カーブ"}),pitch({pitchType:"フォーク"}),pitch({pitchType:"チェンジアップ"})];
  const fast=filterBatterProfilePitches(rows,{pitchGroup:"直球系",velocityMin:145},rows);
  assert.equal(fast.length,2);
  const outer=filterBatterProfilePitches(rows,{pitchGroup:"直球系",horizontal:"外角",zone:"ゾーン外"},rows);
  assert.equal(outer.length,2);
  const breaking=filterBatterProfilePitches(rows,{pitchGroup:"変化球系"},rows);
  assert.equal(breaking.length,4);
});

test("詳細条件で横変化量の固定帯を抽出する",()=>{
  const rows=[pitch({hb:8}),pitch({hb:-14}),pitch({hb:22}),pitch({hb:-34})];
  assert.equal(filterBatterProfilePitches(rows,{movementBand:"10cm未満"},rows).length,1);
  assert.equal(filterBatterProfilePitches(rows,{movementBand:"10～20cm"},rows).length,1);
  assert.equal(filterBatterProfilePitches(rows,{movementBand:"20～30cm"},rows).length,1);
  assert.equal(filterBatterProfilePitches(rows,{movementBand:"30cm以上"},rows).length,1);
});

test("球速帯別の打率と長打率は三振を打数に含める",()=>{
  const rows=[
    pitch({result:"インプレー",playResult:"本塁打",exitVelocity:160,hitType:"FlyBall"}),
    pitch({strikes:2,result:"空振り",korbb:"Strikeout"}),
  ];
  const metrics=calculateProfileMetrics(rows,buildStrongContactThresholds(rows));
  assert.equal(metrics.battingAverage.value,.5);
  assert.equal(metrics.sluggingPercentage.value,2);
});

test("犠打・犠飛は打率と長打率の打数から除外する",()=>{
  const rows=[
    pitch({result:"インプレー",playResult:"単打",exitVelocity:140,hitType:"LineDrive"}),
    pitch({result:"インプレー",playResult:"犠打・犠飛",exitVelocity:90,hitType:"Bunt"}),
  ];
  const metrics=calculateProfileMetrics(rows,buildStrongContactThresholds(rows));
  assert.equal(metrics.battingAverage.denominator,1);
  assert.equal(metrics.battingAverage.value,1);
  assert.equal(metrics.sluggingPercentage.value,1);
});

test("球種グループの合計は全投球数と一致し、少数では判定しない",()=>{
  const rows=annotatePlateAppearances([pitch(),pitch({pitchType:"スライダー"}),pitch({pitchType:"フォーク"}),pitch({pitchType:"ChangeUp"})]);
  const profile=buildBatterProfile(rows,rows);
  assert.equal(profile.pitchGroups.reduce((sum,row)=>sum+row.pitches,0),rows.length);
  assert.equal(confidenceFor(14,"pitch"),"判定しない");
  assert.equal(confidenceFor(60,"pitch"),"高");
  assert.ok(profile.pitchGroups.every(row=>row.rating==="データ不足"));
});

test('速球の説明は実際に比較した球速帯を明記する', () => {
  const player = [...Array.from({length:60}, () => pitch({velocity:146,result:'ファウル'})), ...Array.from({length:12}, () => pitch({velocity:152,result:'空振り'}))];
  const league = Array.from({length:120}, (_,i) => pitch({batterId:'league', velocity:146,result:i%2?'空振り':'ファウル'}));
  const profile = buildBatterProfile(player, league);
  const description = profile.summaries.find(text => text.includes('直球系ではContact%'));
  assert.ok(description);
  assert.match(description, /145～149km\/h/);
  assert.doesNotMatch(description, /145km\/h以上/);
});
