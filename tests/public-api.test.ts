/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { GET as getPlayers } from "../app/api/public/players/route.ts";
import { GET as getArsenal } from "../app/api/public/arsenal/route.ts";
import { GET as getRankings } from "../app/api/public/rankings/pitchers/route.ts";
import { GET as getPitcherScouting } from "../app/api/public/scouting/pitcher/route.ts";
import { GET as getBatterScouting } from "../app/api/public/scouting/batter/route.ts";
import { GET as getBatterProfile } from "../app/api/public/scouting/batter-profile/route.ts";
import { GET as getMetadata } from "../app/api/public/metadata/route.ts";
import { numberParam } from "../app/api/public/_lib.ts";

const dataset = await readFile(new URL("../public/data/initial-data.json", import.meta.url), "utf8");
globalThis.fetch = async () => new Response(dataset, { headers: { "content-type": "application/json" } });

test("省略した件数・最低球数はAPI既定値を使う", async () => {
  const players = await (await getPlayers(new Request('https://example.test/api/public/players'))).json();
  assert.equal(players.query.limit, 50);
  assert.equal(players.count, 50);
  const ranking = await (await getRankings(new Request('https://example.test/api/public/rankings/pitchers'))).json();
  assert.equal(ranking.query.minPitches, 20);
  assert.equal(ranking.query.limit, 20);
  assert.equal(ranking.count, 20);
  assert.ok(ranking.rankings.every((row: any) => row.pitches >= 20));
  assert.equal(numberParam('', 50, 1, 200), 50);
  assert.equal(numberParam('0', 50, 1, 200), 1);
});

test("公開メタデータで球種正規化ルールと実データ監査値を確認できる", async () => {
  const response = await getMetadata(new Request("https://example.test/api/public/metadata"));
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.pitchTypeNormalization.version, "tohto-fastball-sinker-v1");
  assert.equal(body.pitchTypeNormalization.rawSinkerPitches, 723);
  assert.equal(body.pitchTypeNormalization.rawSinkerToFastball, 441);
});

test("ひらがなの通称から鈴木泰成を検索できる", async () => {
  const response = await getPlayers(new Request("https://example.test/api/public/players?q=鈴木たいせい&role=投手"));
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.count, 1);
  assert.equal(body.players[0].nameJa, "鈴木 泰成");
});

test("鈴木泰成の球種別平均を読み取り専用JSONで返す", async () => {
  const response = await getArsenal(new Request("https://example.test/api/public/arsenal?player=鈴木泰成&team=青山学院大学&minPitches=5"));
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.player.nameJa, "鈴木 泰成");
  const fastball = body.arsenal.find((row: any) => row.pitchType === "ストレート");
  assert.deepEqual({ velocity: fastball.avgVelocity, ivb: fastball.avgIvb, hb: fastball.avgHb }, { velocity: 149.3, ivb: 45.5, hb: 37.1 });
  assert.equal(body.units.avgIvb, "cm");
  const original = JSON.parse(dataset);
  const pitches = original.pitches.filter((pitch: any) => pitch.pitcherId === body.player.id && pitch.pitchType === 'ストレート');
  assert.ok(pitches.length > 0);
  assert.equal(fastball.maxIvb, pitches.map((pitch: any) => pitch.ivb).filter(Number.isFinite).sort((a: number, b: number) => Math.abs(b) - Math.abs(a) || b - a)[0]);
  assert.equal(fastball.maxVaa, Math.max(...pitches.map((pitch: any) => pitch.vaa).filter(Number.isFinite)));
  assert.equal(body.units.maxHb, 'cm');
  assert.equal(body.units.maxVaa, 'degrees');
});

test('最大横変化ランキングは符号を残して絶対値順に並ぶ', async () => {
  const response = await getRankings(new Request('https://example.test/api/public/rankings/pitchers?metric=maxHb&minPitches=20&limit=100'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.rankings.some((row: any) => row.value < 0));
  for (let index = 1; index < body.rankings.length; index++) {
    assert.ok(Math.abs(body.rankings[index - 1].value) >= Math.abs(body.rankings[index].value));
  }
});

test("大学・球種・最低球数を指定したIVBランキングを降順で返す", async () => {
  const response = await getRankings(new Request("https://example.test/api/public/rankings/pitchers?team=中央大&pitchType=フォーシーム&metric=avgIvb&minPitches=20"));
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.query.team, "中央大学");
  assert.equal(body.query.pitchType, "ストレート");
  assert.ok(body.rankings.length > 0);
  for (let index = 1; index < body.rankings.length; index += 1) {
    assert.ok(body.rankings[index - 1].value >= body.rankings[index].value);
  }
});

test("投手スカウティングAPIがカウント別・左右別を分子分母付きで返す", async () => {
  const response = await getPitcherScouting(new Request("https://example.test/api/public/scouting/pitcher?player=鈴木泰成&team=青山学院大学&minSample=5"));
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.player.nameJa, "鈴木 泰成");
  assert.equal(body.definitionVersion, "tohto-scouting-2026-09-v1");
  assert.equal(body.countAnalysis.counts.length, 12);
  assert.equal(body.sideAnalysis.sides.length, 2);
  assert.equal(typeof body.sideAnalysis.sides[0].summary.zone.numerator, "number");
  assert.equal(typeof body.sideAnalysis.sides[0].summary.zone.denominator, "number");
});

test("打者アプローチAPIが初球とFirst Strikeを区別して返す", async () => {
  const response = await getBatterScouting(new Request("https://example.test/api/public/scouting/batter?player=渡部海&team=青山学院大学&minSample=5"));
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.player.nameJa, "渡部 海");
  assert.equal(body.metrics.firstPitchSwing.definitionVersion, "tohto-scouting-2026-09-v1");
  assert.ok(body.metrics.firstPitchSwing.denominator > 0);
  assert.ok(body.metrics.firstStrikeSwing.denominator > 0);
  assert.equal(body.metrics.twoStrikeExpansion.unit, "percentage-point");
  assert.deepEqual(Object.keys(body.metrics.twoStrikeExpansion.comparisonDenominators), ["before", "twoStrike"]);
  assert.equal(body.filters.minimumSample, 5);
});

test("打者プロファイルAPIが動的強打基準と分子分母を返す", async () => {
  const response = await getBatterProfile(new Request("https://example.test/api/public/scouting/batter-profile?player=渡部海&team=青山学院大学"));
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(body.player.nameJa, "渡部 海");
  assert.equal(body.definitionVersion, "tohto-batter-profile-2026-09-v1");
  assert.ok(body.profile.thresholds[0].value > 0);
  assert.equal(body.profile.pitchGroups.reduce((sum: number,row: any)=>sum+row.pitches,0),body.profile.counts.pitches);
  assert.equal(typeof body.profile.metrics.swing.numerator,"number");
  assert.equal(typeof body.profile.metrics.swing.denominator,"number");
  assert.equal(body.readOnly,true);
});
