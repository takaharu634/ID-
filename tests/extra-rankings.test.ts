import test from "node:test";
import assert from "node:assert/strict";
import { batterExtraRows, circularMeanDegrees, pitcherExtraRows, pitchTypeExtraRows, platoonRows } from "../lib/extra-rankings.ts";

const close = (actual: number | null, expected: number) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

test("extension max, effective velocity gap and spin efficiency by pitcher and pitch type", () => {
  const pitchTypes = [{ pitcherId: "p1", pitchType: "ストレート", pitches: 3 }, { pitcherId: "p1", pitchType: "カーブ", pitches: 1 }, { pitcherId: "p2", pitchType: "ストレート", pitches: 0 }];
  const pitches = [
    { pitcherId: "p1", pitchType: "ストレート", extension: 200, velocity: 140, effectiveVelocity: 142, spinAxis: 350 },
    { pitcherId: "p1", pitchType: "ストレート", extension: 215.5, velocity: 144, effectiveVelocity: 144, spinAxis: 10 },
    { pitcherId: "p1", pitchType: "ストレート", extension: null, velocity: null, effectiveVelocity: 150, spinAxis: null },
    { pitcherId: "p1", pitchType: "カーブ", extension: 190, velocity: 110, effectiveVelocity: null },
  ];
  const spin = [
    { pitcherId: "2026-fall:p1", normalizedPitchType: "ストレート", spinEfficiency: 90 },
    { pitcherId: "2026-fall:p1", normalizedPitchType: "ストレート", spinEfficiency: 80 },
    { pitcherId: "2026-fall:p1", normalizedPitchType: "ストレート", spinEfficiency: null },
  ];
  const [fastball, curve, missing] = pitchTypeExtraRows(pitchTypes, pitches, spin, "2026-fall");
  assert.equal(fastball.maxExtension, 215.5);
  close(fastball.avgEffectiveVelocity, (142 + 144 + 150) / 3);
  close(fastball.effectiveVelocityGain, 1); // only pitches with both values
  close(fastball.avgSpinAxis, 0); // 350° and 10° average to 0°, not 180°
  assert.equal(fastball.avgSpinEfficiency, 85);
  assert.equal(curve.avgEffectiveVelocity, null);
  assert.equal(curve.avgSpinEfficiency, null);
  assert.equal(missing.maxExtension, null);
  assert.equal(pitchTypeExtraRows(pitchTypes, pitches)[0].avgSpinEfficiency, null, "spin feed not loaded is unknown, not zero");
  assert.equal("maxExtension" in pitchTypes[0], false, "stored rows are not mutated");
});

test("circular mean ignores invalid values and returns null for opposing axes", () => {
  close(circularMeanDegrees([170, 190, NaN]), 180);
  assert.equal(circularMeanDegrees([]), null);
  assert.equal(circularMeanDegrees([0, 180]), null);
});

test("pitcher zone, walk and batted-ball shares exclude unlocated pitches and bunts", () => {
  const pitchers = [{ id: "p1", pa: 4, walks: 1, strikeouts: 1 }, { id: "p2", pa: 0, walks: 0 }];
  const pitches = [
    { pitcherId: "p1", plateX: 0, plateZ: 0.7, result: "見逃しストライク" },
    { pitcherId: "p1", plateX: 0.5, plateZ: 0.7, result: "空振り", korbb: "Strikeout" },
    { pitcherId: "p1", plateX: null, plateZ: null, result: "ボール", korbb: "Walk" },
    { pitcherId: "p1", plateX: 0.1, plateZ: 0.6, result: "インプレー", hitType: "GroundBall", batterSide: "右", sprayAngle: -30 },
    { pitcherId: "p1", plateX: 0.1, plateZ: 0.6, result: "インプレー", hitType: "Bunt", batterSide: "右", sprayAngle: 0 },
  ];
  const [p1, p2] = pitcherExtraRows(pitchers, pitches);
  close(p1.zoneRate, 3 / 4);
  close(p1.walkRate, 1 / 4);
  close(p1.strikeoutRate, 1 / 4);
  assert.equal(p1.battedBalls, 1);
  assert.equal(p1.groundBallRate, 1);
  assert.equal(p1.pullRate, 1);
  assert.equal(p2.zoneRate, null);
  assert.equal(p2.walkRate, null);
});

test("batter zone swing, direction shares and K%/BB% use completed PAs", () => {
  const batters = [{ id: "b1", pa: 3, walks: 1, strikeouts: 0 }];
  const pitches = [
    { batterId: "b1", plateX: 0, plateZ: 0.7, result: "ファウル" },
    { batterId: "b1", plateX: 0, plateZ: 0.8, result: "見逃しストライク" },
    { batterId: "b1", plateX: 0, plateZ: 0.9, result: "インプレー", hitType: "LineDrive", batterSide: "左", sprayAngle: 30 },
    { batterId: "b1", plateX: 0, plateZ: 0.9, result: "インプレー", hitType: "FlyBall", batterSide: "左", sprayAngle: -20 },
    { batterId: "b1", plateX: 0, plateZ: 0.9, result: "インプレー", hitType: "Popup", batterSide: "左", sprayAngle: 80 },
  ];
  const [b1] = batterExtraRows(batters, pitches);
  close(b1.zoneSwingRate, 4 / 5);
  close(b1.walkRate, 1 / 3);
  assert.equal(b1.strikeoutRate, 0);
  assert.equal(b1.battedBalls, 3);
  close(b1.lineDriveRate, 1 / 3);
  assert.equal(b1.directedBalls, 2, "spray beyond ±45° is not classified");
  assert.equal(b1.pullRate, 0.5);
  assert.equal(b1.oppositeRate, 0.5);
});

test("platoon splits count AB without walks, HBP and sacrifices", () => {
  const pitchers = [{ id: "p1", name: "Pitcher", kanji: "投手 甲", team: "A" }];
  const base = { pitcherId: "p1", pitcherTeam: "A" };
  const rows = platoonRows(pitchers, [
    { ...base, batterSide: "左", result: "インプレー", playResult: "二塁打" },
    { ...base, batterSide: "左", result: "空振り", korbb: "Strikeout" },
    { ...base, batterSide: "左", result: "ボール", korbb: "Walk" },
    { ...base, batterSide: "左", result: "インプレー", playResult: "犠打・犠飛" },
    { ...base, batterSide: "左", result: "ファウル" },
    { ...base, batterSide: "右", result: "死球" },
    { ...base, batterSide: "", result: "インプレー", playResult: "単打" },
  ], "pitcher");
  assert.equal(rows.length, 2);
  const left = rows.find((row) => row.side === "左")!;
  assert.equal(left.split, "対左打者");
  assert.equal(left.kanji, "投手 甲");
  assert.equal(left.pa, 4);
  assert.equal(left.ab, 2);
  assert.equal(left.battingAverage, 0.5);
  assert.equal(left.sluggingPercentage, 1);
  assert.equal(left.strikeoutRate, 0.25);
  assert.equal(left.walkRate, 0.25);
  const right = rows.find((row) => row.side === "右")!;
  assert.equal(right.ab, 0);
  assert.equal(right.battingAverage, null);
});
