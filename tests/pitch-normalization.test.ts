import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
type NormalizedPitch = {pitchType:string; normalizedPitchType:string; rawPitchType:string; rawPitchTypeDisplay:string; pitcherId:string; pitchTypeChanged:boolean; pitchNo:number; date:string; velocity:number};
import {
  buildDatasetFromCsv,
  normalizeFastballSinkerPitchType,
} from "../lib/csv-analytics.js";

test("Fastball平均150.0km/hの4%境界を元精度で判定する", () => {
  const expected = new Map([
    [150, "ストレート"],
    [149, "ストレート"],
    [148, "ストレート"],
    [145, "ストレート"],
    [144.01, "ストレート"],
    [144, "シンカー"],
    [143.99, "シンカー"],
    [140, "シンカー"],
  ]);
  for (const [velocity, pitchType] of expected) {
    assert.equal(normalizeFastballSinkerPitchType("Fastball", velocity, 150), pitchType, `${velocity} km/h`);
  }
});

test("対象はRaw Fastball/Sinkerのみで、基準がなければ元分類を維持する", () => {
  assert.equal(normalizeFastballSinkerPitchType("Sinker", 148.5, 150), "ストレート");
  assert.equal(normalizeFastballSinkerPitchType("Sinker", 142.5, 150), "シンカー");
  assert.equal(normalizeFastballSinkerPitchType("Slider", 135, 150), "スライダー");
  assert.equal(normalizeFastballSinkerPitchType("Changeup", 127.5, 150), "チェンジアップ");
  assert.equal(normalizeFastballSinkerPitchType("Sinker", 149, null), "シンカー");
});

const headers = [
  "PitchNo", "Date", "Pitcher", "PitcherId", "PitcherTeam", "PitcherThrows",
  "Batter", "BatterId", "BatterTeam", "BatterSide", "TaggedPitchType",
  "AutoPitchType", "RelSpeed", "PitchCall", "PitchUID", "GameUID",
];

function csvFor(velocities: Array<[string, number]>) {
  const rows = velocities.map(([pitchType, velocity], index) => [
    index + 1, "2026-04-01", "TestPitcher", "9001", "CHU_UNI", "Right",
    "TestBatter", "8001", "TOY_UNI", "Right", pitchType, pitchType,
    velocity, "BallCalled", `pitch-${index + 1}`, "game-1",
  ]);
  return [headers, ...rows].map((row) => row.join(",")).join("\n");
}

test("共通CSV集計でRawを保持し、正規化球種で集計する", () => {
  const dataset = buildDatasetFromCsv(csvFor([
    ["Fastball", 149],
    ["Fastball", 151],
    ["Sinker", 148.5],
    ["Sinker", 142.5],
    ["Slider", 135],
  ]), { season: "2026年春季", generatedAt: "test" });

  const pitches = dataset.pitches as NormalizedPitch[];
  assert.deepEqual(pitches.map((pitch) => pitch.pitchType), ["ストレート", "ストレート", "ストレート", "シンカー", "スライダー"]);
  assert.equal(pitches[2].rawPitchType, "Sinker");
  assert.equal(pitches[2].normalizedPitchType, "ストレート");
  assert.equal(pitches[2].pitchTypeChanged, true);
  assert.equal(pitches[0].pitchNo, 1);

  const report = dataset.metadata.pitchTypeNormalization;
  assert.equal(report.rawSinkerPitches, 2);
  assert.equal(report.rawSinkerToFastball, 1);
  assert.equal(report.rawSinkerRetained, 1);
  assert.equal(report.pitchers[0].fastballAvgVelocity, 150);
  assert.equal(report.pitchers[0].sinkerThreshold, 144);
  assert.equal(dataset.pitchTypes.reduce((sum, row) => sum + row.pitches, 0), pitches.length);
});

test("同じ投手でもシーズンごとにFastball平均を独立計算する", () => {
  const spring = buildDatasetFromCsv(csvFor([["Fastball", 149], ["Fastball", 151], ["Sinker", 145]]), {
    season: "2026年春季", generatedAt: "test",
  });
  const fall = buildDatasetFromCsv(csvFor([["Fastball", 139], ["Fastball", 141], ["Sinker", 135]]), {
    season: "2025年秋季", generatedAt: "test",
  });
  assert.equal(spring.metadata.pitchTypeNormalization.pitchers[0].fastballAvgVelocity, 150);
  assert.equal(spring.metadata.pitchTypeNormalization.pitchers[0].sinkerThreshold, 144);
  assert.equal(fall.metadata.pitchTypeNormalization.pitchers[0].fastballAvgVelocity, 140);
  assert.equal(fall.metadata.pitchTypeNormalization.pitchers[0].sinkerThreshold, 134.4);
  assert.equal(spring.metadata.pitchTypeNormalization.season, "2026年春季");
  assert.equal(fall.metadata.pitchTypeNormalization.season, "2025年秋季");
});

test("配布用シーズンJSONは正規化球種で一貫し、Raw分類を保持する", () => {
  for (const filename of ["season-2026-spring.json", "season-2025-fall.json"]) {
    const dataset = JSON.parse(readFileSync(new URL(`../public/data/${filename}`, import.meta.url), "utf8"));
    assert.equal(dataset.schemaVersion, 7);
    assert.ok(dataset.pitches.every((pitch: NormalizedPitch) => Object.hasOwn(pitch, "rawPitchType")));
    assert.ok(dataset.pitches.every((pitch: NormalizedPitch) => pitch.pitchType === pitch.normalizedPitchType));

    const pitchCounts = new Map<string, number>();
    for (const pitch of dataset.pitches) {
      const key = `${pitch.pitcherId}|${pitch.pitchType}`;
      pitchCounts.set(key, (pitchCounts.get(key) ?? 0) + 1);
    }
    assert.equal(dataset.pitchTypes.length, pitchCounts.size);
    for (const row of dataset.pitchTypes) {
      assert.equal(row.pitches, pitchCounts.get(`${row.pitcherId}|${row.pitchType}`));
    }

    const report = dataset.metadata.pitchTypeNormalization;
    const rawSinkers = dataset.pitches.filter((pitch: NormalizedPitch) => pitch.rawPitchTypeDisplay === "シンカー");
    assert.equal(report.rawSinkerPitches, rawSinkers.length);
    assert.equal(report.rawSinkerToFastball + report.rawSinkerRetained, report.rawSinkerPitches);
  }
});

test("回転分析JSONも正規化分類とRaw分類を分離して保持する", () => {
  for (const season of ["2026-spring", "2025-fall"]) {
    const pitches = JSON.parse(readFileSync(new URL(`../public/data/spin-${season}.json`, import.meta.url), "utf8"));
    const dataset = JSON.parse(readFileSync(new URL(`../public/data/season-${season}.json`, import.meta.url), "utf8"));
    assert.ok(pitches.every((pitch: NormalizedPitch) => Object.hasOwn(pitch, "rawPitchType")));
    assert.ok(pitches.every((pitch: NormalizedPitch) => pitch.pitchType === pitch.normalizedPitchType));

    const typeIds = new Map([["ストレート", "fastball"], ["シンカー", "sinker"]]);
    const normalizedMain = new Map<string, string>();
    for (const pitch of dataset.pitches) {
      const normalized = typeIds.get(pitch.pitchType);
      if (!normalized) continue;
      normalizedMain.set(`${pitch.pitcherId}|${pitch.date}|${pitch.pitchNo}|${pitch.velocity}`, normalized);
    }
    for (const pitch of pitches.filter((row: NormalizedPitch) => ["fastball", "sinker"].includes(row.rawPitchType))) {
      const pitcherId = pitch.pitcherId.replace(/^\d{4}-(?:spring|fall):/, "");
      assert.equal(pitch.pitchType, normalizedMain.get(`${pitcherId}|${pitch.date}|${pitch.pitchNo}|${pitch.velocity}`));
    }
  }
});
