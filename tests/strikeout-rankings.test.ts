import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pitcherStrikeoutRows, pitchStrikeoutRows } from "../lib/strikeout-rankings.ts";
import type { Row } from "../lib/dataset-types.ts";

test("K% uses completed opponent PAs and keeps zero distinct from missing", () => {
  const pitchers = [{ id: "p1", pa: 27, pitches: 110, strikeouts: 13 }, { id: "p2", pa: 2, strikeouts: 0 }, { id: "p3", pa: 0, strikeouts: 0 }, { id: "p4", pa: 2 }];
  const rows = pitcherStrikeoutRows(pitchers);
  assert.equal(rows[0].strikeoutRate, 13 / 27);
  assert.equal(rows[0].battersFaced, 27);
  assert.equal(rows[1].strikeoutRate, 0);
  assert.equal(rows[2].strikeoutRate, null);
  assert.equal(rows[3].strikeoutRate, null);
  assert.equal("strikeoutRate" in pitchers[0], false);
});

test("recorded strikeouts retain corrected and unknown pitch types regardless of count or pitch call", () => {
  const base = { pitcherId: "p1", pitcherTeam: "A" };
  const rows = pitchStrikeoutRows([{ id: "p1", name: "Pitcher", kanji: "投手 甲", team: "A" }], [
    { ...base, pitchType: "ストレート", rawPitchType: "スライダー", result: "空振り", strikes: 0, korbb: "Strikeout" },
    { ...base, pitchType: "カーブ", result: "ファウル", strikes: 3, korbb: "Strikeout" },
    { ...base, pitchType: null, result: "見逃しストライク", korbb: "Strikeout" },
    { ...base, pitchType: "ストレート", result: "空振り", strikes: 2, korbb: "Undefined" },
    { ...base, pitchType: "ストレート", playResult: "盗塁", korbb: "Undefined" },
    { ...base, pitcherId: "p2", pitchType: "ストレート", result: "空振り", korbb: "Undefined" },
  ]);
  assert.equal(rows.length, 4);
  const fastball = rows.find((row) => row.pitcherId === "p1" && row.pitchType === "ストレート")!;
  assert.equal(fastball.pitches, 3);
  assert.equal(fastball.strikeouts, 1);
  assert.equal(fastball.pitcherKanji, "投手 甲");
  assert.equal(fastball.pitchStrikeoutShare, 1 / 3);
  assert.equal(rows.find((row) => row.pitchType === "不明")?.strikeouts, 1);
  assert.equal(rows.find((row) => row.pitcherId === "p2")?.pitchStrikeoutShare, null);
});

for (const [season, expectedK, expectedPA] of [["2026-fall", 219, 1076], ["2026-spring", 657, 3080], ["2025-fall", 449, 2183]] as const) {
  test(`${season}: pitch-type totals match every existing pitcher and retain the deduplicated PA denominator`, () => {
    const data = JSON.parse(readFileSync(`public/data/season-${season}.json`, "utf8"));
    const pitches = pitchStrikeoutRows(data.pitchers, data.pitches);
    const pitchers = pitcherStrikeoutRows(data.pitchers);
    assert.equal(pitches.reduce((sum, row) => sum + row.strikeouts, 0), expectedK);
    assert.equal(pitchers.reduce((sum, row) => sum + row.battersFaced, 0), expectedPA);
    for (const pitcher of pitchers) {
      const arsenal = pitches.filter((row) => row.pitcherId === pitcher.id);
      assert.equal(arsenal.reduce((sum, row) => sum + row.strikeouts, 0), pitcher.strikeouts, pitcher.id);
      assert.equal(arsenal.reduce((sum, row) => sum + row.pitches, 0), pitcher.pitches, pitcher.id);
      if (pitcher.strikeouts) assert.ok(Math.abs(arsenal.reduce((sum, row) => sum + row.pitchStrikeoutShare, 0) - 1) < 1e-12);
    }
    if (season !== "2026-fall") assert.equal(pitches.filter((row: Row) => row.pitchType === "不明").reduce((sum, row) => sum + row.strikeouts, 0), 1);
  });
}
