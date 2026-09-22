import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { OFFICIAL_BATTING_2026_SPRING } from "../lib/official-batting-2026-spring.js";

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders development preview metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  assert.match(await response.text(), developmentPreviewMeta);
});

test("official 2026 spring batting records override TrackMan outcomes", async () => {
  const dataset = JSON.parse(await readFile(new URL("../public/data/initial-data.json", import.meta.url), "utf8"));
  assert.equal(dataset.metadata.officialBatting.matched, OFFICIAL_BATTING_2026_SPRING.length);
  assert.ok(dataset.metadata.officialBatting.changed >= 0, "changed is an import audit count, not a fixed data invariant");
  for (const official of OFFICIAL_BATTING_2026_SPRING) {
    const batter = dataset.batters.find((row) => row.team === official.team && row.kanji === official.kanji);
    assert.ok(batter, `${official.team} ${official.kanji} should be matched`);
    for (const field of ["games", "pa", "ab", "runs", "hits", "doubles", "triples", "homeRuns", "totalBases", "rbi", "stolenBases", "sacrifices", "walksHbp", "strikeouts", "passedBalls", "interference", "errors", "leftOnBase", "battingAverage"]) {
      assert.equal(batter[field], official[field], `${official.kanji} ${field}`);
    }
    assert.equal(batter.officialRecord, true);
  }
});

test("pitch search exposes inferred runner-state filters and CSV output", async () => {
  const source = await readFile(new URL("../app/savant-app.tsx", import.meta.url), "utf8");
  const runnerModule = await readFile(new URL("../lib/runner-state.js", import.meta.url), "utf8");
  assert.match(source, /走者状況（推定）/);
  assert.match(source, /得点圏に走者あり/);
  assert.match(source, /matchesRunnerState\(row, runnerState\)/);
  assert.match(source, /"走者状況"/);
  for (const label of ["走者なし", "一塁", "二塁", "三塁", "一・二塁", "一・三塁", "二・三塁", "満塁"]) assert.match(runnerModule, new RegExp(label));
});

test("count analysis print stylesheet excludes location charts and their legend", async () => {
  const css = await readFile(new URL("../app/report-print.css", import.meta.url), "utf8");
  const printStart = css.indexOf("@media print {");
  assert.ok(printStart >= 0, "print stylesheet should exist");
  const printCss = css.slice(printStart);
  assert.match(printCss, /\.count-plot-grid, \.count-single-print-content > \.search-analysis-legend \{ display: none !important; \}/);
  assert.doesNotMatch(printCss, /\.count-plot-grid \{[^}]*break-before: page/);
});

test("selected count analysis print uses one page per pitcher", async () => {
  const source = await readFile(new URL("../app/savant-app.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/report-print.css", import.meta.url), "utf8");
  assert.match(source, /選択した選手を印刷/);
  assert.match(source, /if \(row\.pitcherTeam !== filters\.team\) continue/);
  assert.match(css, /body\[data-count-print-mode="team"\] \.count-bulk-print-root \{ display: block !important; \}/);
  assert.match(css, /\.count-print-sheet \{[^}]*break-inside: avoid-page[^}]*break-after: auto/);
  assert.match(css, /\.count-print-sheet \+ \.count-print-sheet \{[^}]*break-before: page[^}]*page-break-before: always/);
  assert.doesNotMatch(css, /\.count-print-sheet:last-child \{[^}]*page-break-after: always/);
});

test("count analysis omits the added count and situation summary cards", async () => {
  const source = await readFile(new URL("../app/savant-app.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /function CountScoutingSummary/);
  assert.doesNotMatch(source, /count-scout-grid|count-group-grid/);
  assert.doesNotMatch(source, /各カウントの上位2球種/);
});

test("single count analysis print removes hidden screen layout and trailing page space", async () => {
  const css = await readFile(new URL("../app/report-print.css", import.meta.url), "utf8");
  assert.match(css, /body\[data-scouting-print="count"\] \.site-shell > :not\(\.page-wrap\),\s*body\[data-scouting-print="count"\] \.page-section > :not\(\.count-print-root\) \{ display: none !important; \}/);
  assert.match(css, /body\[data-scouting-print="count"\] \.page-wrap \{[^}]*min-height: 0 !important[^}]*padding: 0/);
  assert.match(css, /body\[data-scouting-print="count"\] \.page-wrap > \*,\s*body\[data-scouting-print="count"\] \.page-section \{[^}]*animation: none !important[^}]*transform: none !important/);
  assert.match(css, /\.count-single-print-content \{[^}]*height: auto !important[^}]*min-height: 0 !important[^}]*overflow: visible !important/);
  assert.match(css, /\.count-bulk-print-root \{ display: none !important; \}/);
});

test("four scouting reports share A4 landscape print isolation and color retention", async () => {
  const source = await readFile(new URL("../app/savant-app.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/report-print.css", import.meta.url), "utf8");
  assert.match(css, /@page \{ size: A4 landscape; margin: 7mm; \}/);
  assert.match(css, /print-color-adjust: exact !important/);
  for (const mode of ["count", "side", "approach", "batter-profile"]) assert.match(css, new RegExp(`data-scouting-print=\\"${mode}\\"|data-scouting-print="${mode}"`));
  assert.match(source, /右打者と左打者への攻め方を1枚で比較/);
  assert.match(source, /First Strike Swing%/);
  assert.match(source, /2S Expansion Δ/);
  assert.match(source, /最終的なプレート通過位置だけから/);
});

test("side and approach printing removes hidden screen layout and trailing page space", async () => {
  const css = await readFile(new URL("../app/report-print.css", import.meta.url), "utf8");
  assert.match(css, /body\[data-scouting-print="side"\] \.site-shell>:not\(\.page-wrap\),body\[data-scouting-print="side"\] \.page-section>:not\(\.side-report-root\),body\[data-scouting-print="approach"\] \.site-shell>:not\(\.page-wrap\),body\[data-scouting-print="approach"\] \.page-section>:not\(\.approach-card-root\)\{display:none!important\}/);
  assert.match(css, /body\[data-scouting-print="side"\] \.page-wrap,body\[data-scouting-print="approach"\] \.page-wrap\{[^}]*min-height:0!important[^}]*padding:0!important\}/);
  assert.match(css, /body\[data-scouting-print="side"\] \.side-report-root,body\[data-scouting-print="approach"\] \.approach-card-root\{[^}]*position:static!important[^}]*height:auto!important[^}]*min-height:0!important[^}]*overflow:visible!important\}/);
  assert.match(css, /body\[data-scouting-print="side"\] \.side-print-sheet,body\[data-scouting-print="approach"\] \.approach-print-sheet\{[^}]*break-inside:avoid-page[^}]*break-after:auto[^}]*page-break-after:auto\}/);
});

test("batter profile exposes overview, detail filters, dynamic threshold and no recommendation copy", async () => {
  const source = await readFile(new URL("../app/savant-app.tsx", import.meta.url), "utf8");
  const profileModule = await readFile(new URL("../lib/batter-profile.ts", import.meta.url), "utf8");
  assert.match(source, /打者プロファイル/);
  assert.match(source, /概要シート/);
  assert.match(source, /詳細分析/);
  assert.match(source, /145km\/h以上のストレート/);
  assert.match(source, /スイング \{\(detailMetrics\.swing\.numerator\?\?0\)\.toLocaleString/);
  // The chart-copy cleanup intentionally removed this explanatory note.
  assert.doesNotMatch(source, /推奨配球・攻め方は生成しません/);
  assert.match(profileModule, /quantile\(values, \.75\)/);
  assert.match(profileModule, /選択シーズンの東都リーグ全有効打球速度の75パーセンタイル/);
  assert.doesNotMatch(profileModule, /投げるべき|おすすめコース|推奨配球/);
});

test("batter profile print uses a dedicated single-page A4 landscape layout", async () => {
  const source = await readFile(new URL("../app/savant-app.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../app/report-print.css", import.meta.url), "utf8");
  const screenCss = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(source, /function BatterProfilePrintPage/);
  assert.match(source, /profile\.summaries\.slice\(0,3\)/);
  assert.match(source, /PITCH_GROUP_ORDER\.slice\(0, 6\)/);
  assert.match(source, /上方向成分が大きい/);
  assert.match(source, /batter-profile-screen-sheet/);
  assert.match(source, /batter-profile-print-page/);
  assert.match(css, /@page batter-profile \{ size: A4 landscape; margin: 6mm; \}/);
  assert.match(screenCss, /\.batter-profile-print-page\{display:none\}/);
  assert.match(css, /body\[data-scouting-print="batter-profile"\] \.batter-profile-print-root > :not\(\.batter-profile-print-page\) \{ display:none!important; \}/);
  const documentSource = await readFile(new URL("../app/print-document.ts", import.meta.url), "utf8");
  assert.match(documentSource, /@page \{ size:A4 landscape; margin:7mm;/);
  assert.match(documentSource, /\.print-document-page \{[^}]*width:283mm[^}]*height:195mm[^}]*break-after:page/);
  assert.match(documentSource, /\.print-document-page:last-child \{[^}]*break-after:auto/);
  assert.match(css, /body\[data-scouting-print="batter-profile"\] \.batter-profile-print-page \{[^}]*height:auto[^}]*overflow:visible/);
  // Preserve the analysis zone's 0.508m width / 0.6m height in print.
  const zoneRule = css.match(/\.batter-profile-print-zone>div\s*\{([^}]+)\}/)?.[1];
  assert.ok(zoneRule, "printed profile zone must have a layout rule");
  const width = Number(zoneRule.match(/\bwidth:\s*([\d.]+)mm/)?.[1]);
  const height = Number(zoneRule.match(/\bheight:\s*([\d.]+)mm/)?.[1]);
  const ratio = zoneRule.match(/\baspect-ratio:\s*([\d.]+)\s*\/\s*([\d.]+)/);
  assert.ok(width > 0 && height > 0, "printed zone dimensions must be positive");
  assert.ok(Math.abs(width / height - 0.508 / 0.6) < 0.000001, "printed zone must preserve the analysis coordinate ratio");
  assert.ok(ratio, "printed zone must declare its coordinate ratio");
  assert.ok(Math.abs(Number(ratio[1]) / Number(ratio[2]) - width / height) < 0.000001, "aspect-ratio must agree with printed dimensions");
  assert.doesNotMatch(css, /body\[data-scouting-print="batter-profile"\] \.batter-profile-print-page \{[^}]*break-after:page/);
});

test("plate-location charts consistently declare catcher view", async () => {
  const source = await readFile(new URL("../app/savant-app.tsx", import.meta.url), "utf8");
  const barrel = await readFile(new URL("../app/barrel-zone.tsx", import.meta.url), "utf8");
  const spin = await readFile(new URL("../app/pitch-spin-profile.tsx", import.meta.url), "utf8");
  const profileModule = await readFile(new URL("../lib/batter-profile.ts", import.meta.url), "utf8");
  assert.match(source, /function CatcherViewAxis/);
  assert.match(source, /捕手側から見た図/);
  assert.match(source, /catcherViewZoneOrder\(zones, batterSide\)/);
  assert.doesNotMatch(source, /打者側から見た最終通過位置ではありません/);
  assert.match(barrel, /捕手側から見た図/);
  assert.match(spin, /捕手側から見た9分割ストライクゾーン/);
  assert.match(profileModule, /export function catcherViewZoneOrder/);
});
