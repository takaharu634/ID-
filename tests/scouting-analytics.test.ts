/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  annotatePlateAppearances,
  buildBatterApproachReport,
  calculateApproachMetrics,
  DEFAULT_ZONE,
  isStrikeEquivalent,
  isSwing,
} from "../lib/scouting-analytics.ts";

const base = { gameId: "g1", inning: 1, half: "表", batterId: "b1", batterSide: "右", pitcherThrows: "右", pitchType: "ストレート" };
const synthetic = annotatePlateAppearances([
  { ...base, id: "1", balls: 0, strikes: 0, result: "ボール", plateX: .4, plateZ: .7 },
  { ...base, id: "2", balls: 1, strikes: 0, result: "見逃しストライク", plateX: 0, plateZ: .7 },
  { ...base, id: "3", balls: 1, strikes: 1, result: "ファウル", plateX: 0, plateZ: .8 },
  { ...base, id: "4", balls: 1, strikes: 2, result: "空振り", korbb: "Strikeout", plateX: .4, plateZ: .3 },
  { ...base, id: "5", balls: 0, strikes: 0, result: "インプレー", playResult: "アウト", plateX: 0, plateZ: .7 },
  { ...base, id: "6", balls: 0, strikes: 0, result: "ボール", plateX: -.4, plateZ: .7 },
  { ...base, id: "7", balls: 1, strikes: 0, result: "空振り", plateX: -.4, plateZ: .3 },
  { ...base, id: "8", balls: 1, strikes: 1, result: "見逃しストライク", plateX: 0, plateZ: .8 },
  { ...base, id: "9", balls: 1, strikes: 2, result: "ボール", plateX: .4, plateZ: .2 },
  { ...base, id: "10", balls: 2, strikes: 2, result: "ファウル", plateX: -.4, plateZ: .2 },
]);

test("初球とファーストストライクを別の投球として判定する", () => {
  const metrics = calculateApproachMetrics(synthetic, 1, DEFAULT_ZONE);
  assert.deepEqual([metrics.firstPitchSwing.numerator, metrics.firstPitchSwing.denominator, metrics.firstPitchSwing.value], [1, 3, 1 / 3]);
  assert.deepEqual([metrics.firstStrikeSwing.numerator, metrics.firstStrikeSwing.denominator, metrics.firstStrikeSwing.value], [2, 3, 2 / 3]);
  assert.notEqual(metrics.firstPitchSwing.value, metrics.firstStrikeSwing.value);
});

test("投球前2ストライクとゾーン外だけでChaseとExpansionを計算する", () => {
  const metrics = calculateApproachMetrics(synthetic, 1, DEFAULT_ZONE);
  assert.deepEqual([metrics.preTwoStrikeChase.numerator, metrics.preTwoStrikeChase.denominator], [1, 3]);
  assert.deepEqual([metrics.twoStrikeChase.numerator, metrics.twoStrikeChase.denominator], [2, 3]);
  assert.equal(metrics.twoStrikeExpansion.value, 1 / 3);
  assert.deepEqual([metrics.zoneSwing.numerator, metrics.zoneSwing.denominator], [2, 4]);
});

test("Swing・Contact・Whiffの定義を一か所から使用し、母数0はnullにする", () => {
  const metrics = calculateApproachMetrics(synthetic, 1, DEFAULT_ZONE);
  assert.deepEqual([metrics.contact.numerator, metrics.contact.denominator], [3, 5]);
  assert.deepEqual([metrics.whiff.numerator, metrics.whiff.denominator], [2, 5]);
  assert.equal(isSwing({ result: "ファウル" }), true);
  assert.equal(isStrikeEquivalent({ result: "見逃しストライク" }), true);
  const empty = calculateApproachMetrics([], 5, DEFAULT_ZONE);
  assert.equal(empty.firstPitchSwing.value, null);
  assert.equal(empty.firstPitchSwing.denominator, 0);
  assert.equal(empty.firstPitchSwing.sampleStatus, "none");
});

function manualMetrics(rawPitches: Array<Record<string, any>>, batterId: string) {
  let firstPitchNumerator = 0, firstPitchDenominator = 0, firstStrikeNumerator = 0, firstStrikeDenominator = 0;
  let waitingForFirstStrike = false;
  const batterRows: Array<Record<string, any>> = [];
  rawPitches.forEach((pitch) => {
    if (pitch.batterId !== batterId) return;
    batterRows.push(pitch);
    if (Number(pitch.balls) === 0 && Number(pitch.strikes) === 0) {
      firstPitchDenominator += 1;
      if (isSwing(pitch)) firstPitchNumerator += 1;
      waitingForFirstStrike = true;
    }
    if (waitingForFirstStrike && isStrikeEquivalent(pitch)) {
      firstStrikeDenominator += 1;
      if (isSwing(pitch)) firstStrikeNumerator += 1;
      waitingForFirstStrike = false;
    }
  });
  const outside = (pitch: Record<string, any>) => Number.isFinite(pitch.plateX) && Number.isFinite(pitch.plateZ) && !(pitch.plateX >= DEFAULT_ZONE.left && pitch.plateX <= DEFAULT_ZONE.right && pitch.plateZ >= DEFAULT_ZONE.bottom && pitch.plateZ <= DEFAULT_ZONE.top);
  const pre = batterRows.filter((pitch) => Number(pitch.strikes) < 2 && outside(pitch));
  const two = batterRows.filter((pitch) => Number(pitch.strikes) === 2 && outside(pitch));
  return {
    firstPitch: [firstPitchNumerator, firstPitchDenominator],
    firstStrike: [firstStrikeNumerator, firstStrikeDenominator],
    pre: [pre.filter(isSwing).length, pre.length],
    two: [two.filter(isSwing).length, two.length],
  };
}

test("実在打者3名を元Pitch列から独立集計した値と一致する", async () => {
  const dataset = JSON.parse(await readFile(new URL("../public/data/season-2026-spring.json", import.meta.url), "utf8"));
  const annotated = annotatePlateAppearances(dataset.pitches);
  const batterIds = [...new Set(dataset.pitches.map((pitch: Record<string, any>) => pitch.batterId))].slice(0, 3) as string[];
  for (const batterId of batterIds) {
    const playerRows = annotated.filter((pitch) => pitch.batterId === batterId);
    const report = buildBatterApproachReport(playerRows, annotated, 5, dataset.league.zone);
    const manual = manualMetrics(dataset.pitches, batterId);
    assert.deepEqual([report.metrics.firstPitchSwing.numerator, report.metrics.firstPitchSwing.denominator], manual.firstPitch);
    assert.deepEqual([report.metrics.firstStrikeSwing.numerator, report.metrics.firstStrikeSwing.denominator], manual.firstStrike);
    assert.deepEqual([report.metrics.preTwoStrikeChase.numerator, report.metrics.preTwoStrikeChase.denominator], manual.pre);
    assert.deepEqual([report.metrics.twoStrikeChase.numerator, report.metrics.twoStrikeChase.denominator], manual.two);
    const expectedExpansion = manual.pre[1] && manual.two[1] ? manual.two[0] / manual.two[1] - manual.pre[0] / manual.pre[1] : null;
    assert.equal(report.metrics.twoStrikeExpansion.value, expectedExpansion);
  }
});
