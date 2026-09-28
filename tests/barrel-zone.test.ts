import assert from "node:assert/strict";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canonicalPlayerKey, hasKanjiName, isBarrelEquivalent, isBipPitch, isSwingPitch, summarizeBarrelZones } from "../app/barrel-zone-engine.ts";

async function season(name: string) {
  return JSON.parse(await readFile(new URL(`../public/data/${name}`, import.meta.url), "utf8"));
}

test("漢字未登録選手は既存IDで分離し、大学をまたいで混同しない", () => {
  assert.equal(canonicalPlayerKey('新大学', '', 'player-1'), '新大学|id:player-1');
  assert.notEqual(canonicalPlayerKey('新大学', '', 'player-1'), canonicalPlayerKey('新大学', '', 'player-2'));
  assert.notEqual(canonicalPlayerKey('新大学', '', 'player-1'), canonicalPlayerKey('別大学', '', 'player-1'));
  assert.equal(canonicalPlayerKey('中央大学', '鈴木 泰成', 'old'), canonicalPlayerKey('中央大学', '鈴木　泰成', 'new'));
});

test("コース欠損を中央へ置かず、実測の横位置0は集計する", () => {
  const valid = { result: 'インプレー', plateX: 0, plateZ: .7, exitVelocity: 150, launchAngle: 20 };
  const cells = summarizeBarrelZones([valid, { ...valid, plateX: null }, { ...valid, plateZ: null }, { ...valid, plateX: '' }], 'bip');
  assert.equal(cells.reduce((sum, cell) => sum + cell.denominator, 0), 1);
  assert.equal(cells.reduce((sum, cell) => sum + cell.numerator, 0), 1);
});

test("既存のBarrel相当境界とスイング・BIP定義を維持する", () => {
  assert.equal(isBarrelEquivalent({ exitVelocity: 145, launchAngle: 10 }), true);
  assert.equal(isBarrelEquivalent({ exitVelocity: 145, launchAngle: 35 }), true);
  assert.equal(isBarrelEquivalent({ exitVelocity: 144.9, launchAngle: 20 }), false);
  assert.equal(isBarrelEquivalent({ exitVelocity: 150, launchAngle: 9.9 }), false);
  assert.equal(isBarrelEquivalent({ exitVelocity: 150, launchAngle: 35.1 }), false);
  assert.equal(isSwingPitch({ result: "ファウル" }), true);
  assert.equal(isSwingPitch({ result: "見逃しストライク" }), false);
  assert.equal(isBipPitch({ result: "インプレー" }), true);
  assert.equal(isBipPitch({ result: "ファウル" }), false);
  assert.equal(hasKanjiName("鈴木 泰成"), true);
  assert.equal(hasKanjiName("Suzuki, Taisei"), false);
  assert.equal(hasKanjiName(""), false);
  assert.equal(canonicalPlayerKey("中央大学", "鈴木 泰成"), canonicalPlayerKey("中央大学", "鈴木　泰成"));
  assert.equal(canonicalPlayerKey("中央大学", "Suzuki, Taisei"), "");
});

test("青山学院大学・中央大学の両シーズンでゾーン集計の分子分母が元投球と一致する", async () => {
  for (const file of ["season-2025-fall.json", "season-2026-spring.json"]) {
    const data = await season(file);
    for (const team of ["青山学院大学", "中央大学"]) {
      const pitches = data.pitches.filter((pitch: any) => pitch.batterTeam === team && pitch.plateX >= -0.55 && pitch.plateX < 0.55 && pitch.plateZ >= 0.18 && pitch.plateZ < 1.32);
      for (const metric of ["swings", "bip"] as const) {
        const cells = summarizeBarrelZones(pitches, metric);
        const qualified = pitches.filter(metric === "swings" ? isSwingPitch : isBipPitch);
        assert.equal(cells.reduce((sum, cell) => sum + cell.denominator, 0), qualified.length, `${file} ${team} ${metric} denominator`);
        assert.equal(cells.reduce((sum, cell) => sum + cell.numerator, 0), qualified.filter(isBarrelEquivalent).length, `${file} ${team} ${metric} numerator`);
      }
    }
  }
});

test("2シーズン合算は各シーズンの分子・分母の合計と一致する", async () => {
  const [fall, spring] = await Promise.all([season("season-2025-fall.json"), season("season-2026-spring.json")]);
  for (const team of ["青山学院大学", "中央大学"]) {
    const select = (data: any) => data.pitches.filter((pitch: any) => pitch.batterTeam === team);
    for (const metric of ["swings", "bip"] as const) {
      const fallCells = summarizeBarrelZones(select(fall), metric);
      const springCells = summarizeBarrelZones(select(spring), metric);
      const combined = summarizeBarrelZones([...select(fall), ...select(spring)], metric);
      combined.forEach((cell, index) => {
        assert.equal(cell.numerator, fallCells[index].numerator + springCells[index].numerator);
        assert.equal(cell.denominator, fallCells[index].denominator + springCells[index].denominator);
      });
    }
  }
});
