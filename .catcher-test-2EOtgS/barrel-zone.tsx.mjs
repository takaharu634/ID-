"use client";

// app/player-options.tsx
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
var comparePlayerNames = (a, b) => String(a.team || "\u5927\u5B66\u4E0D\u660E").localeCompare(String(b.team || "\u5927\u5B66\u4E0D\u660E"), "ja") || String(a.kanji || a.name).localeCompare(String(b.kanji || b.name), "ja") || String(a.id ?? a.key).localeCompare(String(b.id ?? b.key));
function PlayerOptions({ players, valueKey = "id" }) {
  const sorted = [...players].sort(comparePlayerNames);
  const teams = [...new Set(sorted.map((row) => row.team || "\u5927\u5B66\u4E0D\u660E"))];
  return /* @__PURE__ */ jsx(Fragment, { children: teams.map((team) => /* @__PURE__ */ jsx("optgroup", { label: team, children: sorted.filter((row) => (row.team || "\u5927\u5B66\u4E0D\u660E") === team).map((row) => /* @__PURE__ */ jsxs("option", { value: row[valueKey], children: [
    row.kanji || row.name,
    " / ",
    row.romanName || row.name,
    "\uFF08",
    row.team,
    "\uFF09"
  ] }, row[valueKey])) }, team)) });
}

// <stdin>
import { useEffect, useMemo, useState } from "react";

// lib/catcher-view.ts
function catcherGridIndex(sourceIndex, columns) {
  return Math.floor(sourceIndex / columns) * columns + columns - 1 - sourceIndex % columns;
}
function catcherGridOrder(cells, columns) {
  return cells.map((_, index) => cells[catcherGridIndex(index, columns)]);
}

// app/barrel-zone-engine.ts
var X_EDGES = [-0.55, -0.254, -0.0847, 0.0847, 0.254, 0.55];
var Z_EDGES = [0.18, 0.45, 0.65, 0.85, 1.05, 1.32];
function hasKanjiName(value) {
  return /[一-龯々〆ヵヶ]/u.test(String(value ?? ""));
}
function canonicalPlayerKey(team, kanji) {
  if (!hasKanjiName(kanji)) return "";
  return `${String(team ?? "").trim()}|${String(kanji).replace(/[\s　]+/gu, "")}`;
}
function isBarrelEquivalent(pitch) {
  const speed = Number(pitch.exitVelocity);
  const angle = Number(pitch.launchAngle);
  if (!Number.isFinite(speed) || !Number.isFinite(angle)) return false;
  return speed >= 145 && angle >= 10 && angle <= 35;
}
function isSwingPitch(pitch) {
  return ["\u7A7A\u632F\u308A", "\u30A4\u30F3\u30D7\u30EC\u30FC", "\u30D5\u30A1\u30A6\u30EB", "\u30D5\u30A1\u30A6\u30EB\u30D5\u30E9\u30A4"].includes(pitch.result);
}
function isBipPitch(pitch) {
  return pitch.result === "\u30A4\u30F3\u30D7\u30EC\u30FC";
}
function zoneIndex(pitch) {
  const x = Number(pitch.plateX);
  const z = Number(pitch.plateZ);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const col = X_EDGES.findIndex((edge, index) => index < X_EDGES.length - 1 && x >= edge && x < X_EDGES[index + 1]);
  const fromBottom = Z_EDGES.findIndex((edge, index) => index < Z_EDGES.length - 1 && z >= edge && z < Z_EDGES[index + 1]);
  if (col < 0 || fromBottom < 0) return null;
  return { col, row: 4 - fromBottom };
}
function summarizeBarrelZones(pitches, metric) {
  const cells = Array.from({ length: 25 }, (_, index) => ({ row: Math.floor(index / 5), col: index % 5, numerator: 0, denominator: 0 }));
  for (const pitch of pitches) {
    const zone = zoneIndex(pitch);
    if (!zone) continue;
    const qualifies = metric === "swings" ? isSwingPitch(pitch) : isBipPitch(pitch);
    if (!qualifies) continue;
    const cell = cells[zone.row * 5 + zone.col];
    cell.denominator += 1;
    if (isBarrelEquivalent(pitch)) cell.numerator += 1;
  }
  return cells.map((cell) => ({ ...cell, rate: cell.denominator ? cell.numerator / cell.denominator : null }));
}

// lib/pitch-quality.mjs
var PITCH_QUALITY_VERSION = "tohto-pitch-score-v3";
var keys = ["stuffPlus", "locationPlus", "pitchingPlus"];
var features = ["velocity", "spin", "extension", "ivb", "hb", "vaa"];
var round = (v, digits = 1) => Math.round(v * 10 ** digits) / 10 ** digits;
var finite = (v) => typeof v === "number" && Number.isFinite(v);
var average = (values) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
var weighted = (rows, key) => {
  const valid = rows.filter((r) => finite(r[key]) && r.n > 0);
  const n = valid.reduce((sum, r) => sum + r.n, 0);
  return n ? valid.reduce((sum, r) => sum + r[key] * r.n, 0) / n : null;
};
function standardizer(rows, key) {
  const mean = weighted(rows, key);
  const variance = weighted(rows.map((r) => ({ n: r.n, value: (r[key] - mean) ** 2 })), "value");
  const sd = Math.sqrt(variance ?? 0);
  return (value) => finite(value) && mean !== null ? sd > 1e-9 ? (value - mean) / sd : 0 : null;
}
function pitchScore(z, n, prior = 20) {
  return finite(z) && n > 0 ? round(Math.max(0, 50 + 20 * z * n / (n + prior))) : null;
}
function location(p) {
  const x = p.plateX, z = p.plateZ;
  if (!finite(x) || !finite(z)) return null;
  const inside = x >= -0.254 && x <= 0.254 && z >= 0.45 && z <= 1.05;
  const edge = Math.min(Math.abs(x + 0.254), Math.abs(x - 0.254), Math.abs(z - 0.45), Math.abs(z - 1.05));
  const outside = Math.hypot(Math.max(-0.254 - x, 0, x - 0.254), Math.max(0.45 - z, 0, z - 1.05));
  let score = Math.abs(x) <= 0.085 && z >= 0.65 && z <= 0.85 ? -0.34 : inside && edge <= 0.075 ? 0.25 : inside ? 0.05 : outside <= 0.12 ? 0.18 : outside <= 0.25 ? -0.03 : -0.32;
  if (["\u898B\u9003\u3057\u30B9\u30C8\u30E9\u30A4\u30AF", "\u7A7A\u632F\u308A"].includes(p.result)) score += 0.04;
  if (["\u30DC\u30FC\u30EB", "\u30EF\u30F3\u30D0\u30A6\u30F3\u30C9"].includes(p.result)) score -= 0.03;
  return score;
}
var keyOf = (id, type) => JSON.stringify([id, type]);
var emptyScore = (n = 0) => ({ stuffPlus: null, locationPlus: null, pitchingPlus: null, qualitySample: n, qualityConfidence: "\u5BFE\u8C61\u4E0D\u8DB3", qualityShrinkage: 0 });
var top = (rows, key) => rows.filter((r) => finite(r[key])).sort((a, b) => b[key] - a[key])[0] ?? null;
function applyPitchQuality(dataset) {
  if (!dataset?.metadata || !Array.isArray(dataset.pitches) || !Array.isArray(dataset.pitchTypes) || !Array.isArray(dataset.pitchers) || dataset.metadata.pitchQuality?.version === PITCH_QUALITY_VERSION) return dataset;
  const groups = /* @__PURE__ */ new Map();
  for (const p of dataset.pitches) {
    const k = keyOf(p.pitcherId, p.pitchType);
    if (!groups.has(k)) groups.set(k, []);
    if (features.every((f) => finite(p[f])) && location(p) !== null) groups.get(k).push(p);
  }
  const rows = dataset.pitchTypes.map((source) => {
    const measured = groups.get(keyOf(source.pitcherId, source.pitchType)) ?? [];
    return { source, n: measured.length, ...Object.fromEntries(features.map((f) => [f, average(measured.map((p) => p[f]))])), loc: average(measured.map(location)) };
  });
  const byType = /* @__PURE__ */ new Map();
  for (const row of rows) {
    if (!byType.has(row.source.pitchType)) byType.set(row.source.pitchType, []);
    byType.get(row.source.pitchType).push(row);
  }
  for (const [type, group] of byType) {
    let baseline2 = group.filter((r) => r.n >= 25);
    if (baseline2.length < 3) baseline2 = group.filter((r) => r.n >= 10);
    if (baseline2.length < 3 || type === "\u4E0D\u660E") continue;
    const z = Object.fromEntries(features.map((f) => [f, standardizer(baseline2, f)]));
    for (const r of group) r.movement = Math.hypot(z.ivb(r.ivb) ?? 0, z.hb(r.hb) ?? 0);
    const movement = standardizer(baseline2, "movement");
    for (const r of group) {
      if (r.n < 10) continue;
      const vaaDirection = ["\u30B9\u30C8\u30EC\u30FC\u30C8", "\u30B7\u30F3\u30AB\u30FC", "\u30C4\u30FC\u30B7\u30FC\u30E0", "\u30AB\u30C3\u30C8\u30DC\u30FC\u30EB"].includes(type) ? 1 : -0.35;
      r.factors = [
        ["velocity", "\u7403\u901F", z.velocity(r.velocity), 0.45],
        ["spin", "\u56DE\u8EE2\u6570", z.spin(r.spin), 0.15],
        ["extension", "\u30A8\u30AF\u30B9\u30C6\u30F3\u30B7\u30E7\u30F3", z.extension(r.extension), 0.15],
        ["movement", "\u5909\u5316\u306E\u72EC\u81EA\u6027", movement(r.movement), 0.15],
        ["vaa", "\u9032\u5165\u89D2", z.vaa(r.vaa) * vaaDirection, 0.1]
      ].map(([key, label, value, weight]) => ({ key, label, z: value, contribution: value * weight }));
      r.rawStuff = r.factors.reduce((sum, f) => sum + f.contribution, 0);
    }
    const stuff = standardizer(baseline2, "rawStuff"), loc = standardizer(baseline2, "loc");
    for (const r of group.filter((r2) => r2.n >= 10)) {
      r.u = stuff(r.rawStuff);
      r.v = loc(r.loc);
      r.composite = (r.u + r.v) / 2;
    }
    const combined = standardizer(baseline2, "composite");
    for (const r of group.filter((r2) => r2.n >= 10)) {
      const ordered = [...r.factors].sort((a, b) => b.contribution - a.contribution);
      r.score = {
        stuffPlus: pitchScore(r.u, r.n),
        locationPlus: pitchScore(r.v, r.n),
        pitchingPlus: pitchScore(combined(r.composite), r.n),
        qualitySample: r.n,
        qualityReferenceCount: baseline2.length,
        qualityConfidence: r.n < 25 ? "\u53C2\u8003" : r.n >= 50 && baseline2.length >= 5 ? "\u9AD8" : "\u4E2D",
        qualityShrinkage: round(r.n / (r.n + 20), 3),
        qualityStrength: ordered[0].label,
        qualityRisk: ordered.at(-1).label,
        qualityFactors: r.factors.map((f) => ({ ...f, z: round(f.z, 2), contribution: round(f.contribution, 3) }))
      };
    }
  }
  const pitchTypes = rows.map((r) => ({ ...r.source, qualityFactors: [], qualityStrength: "\u2014", qualityRisk: "\u2014", ...emptyScore(r.n), ...r.score }));
  const totals = dataset.pitchers.map((source) => {
    const types = rows.filter((r) => r.source.pitcherId === source.id && r.score);
    const n = types.reduce((sum, r) => sum + r.n, 0);
    return { source, n, coverage: n / Math.max(1, source.pitches), u: weighted(types, "u"), v: weighted(types, "v") };
  });
  const eligible = totals.filter((r) => r.n >= 25 && r.coverage >= 0.8);
  const baseline = eligible.filter((r) => r.n >= 100);
  if (baseline.length >= 3) {
    const stuff = standardizer(baseline, "u"), loc = standardizer(baseline, "v");
    for (const r of eligible) {
      r.s = stuff(r.u);
      r.l = loc(r.v);
      r.composite = (r.s + r.l) / 2;
    }
    const combined = standardizer(baseline, "composite");
    for (const r of eligible) r.score = {
      stuffPlus: pitchScore(r.s, r.n, 50),
      locationPlus: pitchScore(r.l, r.n, 50),
      pitchingPlus: pitchScore(combined(r.composite), r.n, 50),
      qualitySample: r.n,
      qualityReferenceCount: baseline.length,
      qualityConfidence: r.n >= 100 && baseline.length >= 5 ? "\u9AD8" : r.n >= 50 ? "\u4E2D" : "\u53C2\u8003",
      qualityShrinkage: round(r.n / (r.n + 50), 3)
    };
  }
  let pitchers = totals.map((r) => ({ ...r.source, ...emptyScore(r.n), qualityCoverage: round(r.coverage, 3), ...r.score }));
  const qualified = pitchers.filter((r) => r.pitches >= 100 && finite(r.pitchingPlus));
  pitchers = pitchers.map((r) => ({ ...r, percentiles: { ...r.percentiles, ...Object.fromEntries(keys.map((key) => {
    const values = qualified.map((p) => p[key]).filter(finite);
    const less = values.filter((v) => v < r[key]).length, equal = values.filter((v) => v === r[key]).length;
    return [key, finite(r[key]) && values.length ? Math.max(1, Math.min(99, Math.round(100 * (less + equal / 2) / values.length))) : null];
  })) } }));
  const byId = new Map(pitchers.map((r) => [r.id, r]));
  return {
    ...dataset,
    metadata: { ...dataset.metadata, model: "\u6771\u90FDPITCH\u30B9\u30B3\u30A2 v3", pitchQuality: { version: PITCH_QUALITY_VERSION, center: 50, spread: 20, minimum: 0, maximum: null, pitchTypePrior: 20, pitcherPrior: 50, reference: "\u540C\u30B7\u30FC\u30BA\u30F3\u30FB\u7403\u7A2E\u522525\u7403\u4EE5\u4E0A\uFF083\u4EBA\u672A\u6E80\u306F10\u7403\u4EE5\u4E0A\uFF09\u3001\u6295\u624B\u7DCF\u5408100\u7403\u4EE5\u4E0A\u3002\u5404\u57FA\u6E963\u4EBA\u4EE5\u4E0A\u3002\u7DCF\u5408\u306F\u8A55\u4FA1\u53EF\u80FD\u740380%\u4EE5\u4E0A\u3002" } },
    pitchTypes,
    pitchers,
    players: dataset.players?.map((p) => p.pitching && byId.has(p.id) ? { ...p, pitching: byId.get(p.id) } : p),
    teams: dataset.teams?.map((t) => ({ ...t, pitchingPlus: (() => {
      const value = weighted(pitchers.filter((p) => p.team === t.name).map((p) => ({ ...p, n: p.qualitySample })), "pitchingPlus");
      return value === null ? null : round(value);
    })() })),
    highlights: { ...dataset.highlights, pitchingPlus: top(qualified, "pitchingPlus"), command: top(qualified, "locationPlus"), stuffPitch: top(pitchTypes.filter((r) => r.pitches >= 25), "stuffPlus") }
  };
}

// lib/dataset-transport.js
function unpackRows(table) {
  if (!Array.isArray(table.columns) || !Array.isArray(table.values) || !Array.isArray(table.missing)) throw new Error("Invalid dataset table");
  const { columns, values } = table;
  const rows = new Array(values.length);
  for (let i = 0; i < values.length; i++) {
    if (!Array.isArray(values[i]) || values[i].length !== columns.length) throw new Error("Invalid dataset row");
    const row = {};
    for (let j = 0; j < columns.length; j++) {
      const key = columns[j];
      if (key === "__proto__") Object.defineProperty(row, key, { value: values[i][j], enumerable: true, configurable: true, writable: true });
      else row[key] = values[i][j];
    }
    rows[i] = row;
  }
  for (const [i, j] of table.missing) {
    if (!Number.isInteger(i) || !Number.isInteger(j) || i < 0 || i >= rows.length || j < 0 || j >= columns.length) throw new Error("Invalid missing field");
    delete rows[i][columns[j]];
  }
  return rows;
}
function unpackDataset(data) {
  if (data?.transportVersion !== 1 || !["rows", "dataset"].includes(data.kind)) throw new Error("Unsupported dataset transport");
  const rows = unpackRows(data.table);
  return data.kind === "rows" ? rows : { ...data.summary, pitches: rows };
}

// lib/dataset-loader.ts
function createDatasetLoader(fetcher = fetch, current = false) {
  const cache = /* @__PURE__ */ new Map();
  async function request(url) {
    const response = await fetcher(url, { cache: "no-cache", signal: AbortSignal.timeout(2e4) });
    if (!response.ok) throw new Error("\u30C7\u30FC\u30BF\u3092\u8AAD\u307F\u8FBC\u3081\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u518D\u8AAD\u307F\u8FBC\u307F\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
    return applyPitchQuality(await response.json());
  }
  return function load(url) {
    const existing = cache.get(url);
    if (existing) return existing;
    const pending = (async () => {
      const match = /^\/data\/(season|spin)-(2025-fall|2026-spring|2026-fall)\.json$/.exec(url);
      if (current && match) {
        const response = await fetcher(`/api/dataset?season=${match[2]}&format=${match[1] === "spin" ? "spin" : "json"}`, { cache: "no-store", signal: AbortSignal.timeout(2e4) });
        if (response.status !== 204) {
          if (!response.ok) throw new Error("\u6700\u65B0\u30C7\u30FC\u30BF\u3092\u78BA\u8A8D\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002\u518D\u8AAD\u307F\u8FBC\u307F\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
          return applyPitchQuality(await response.json());
        }
      }
      if (/^\/data\/(season-|spin-).+\.json$/.test(url)) {
        try {
          return applyPitchQuality(unpackDataset(await request(url.replace("/data/", "/data/compact/"))));
        } catch {
        }
      }
      return request(url);
    })().catch((error) => {
      cache.delete(url);
      throw error;
    });
    cache.set(url, pending);
    return pending;
  };
}
var currentLoader = createDatasetLoader(fetch, true);
var loadBundledDataset = createDatasetLoader();
function loadStaticDataset(url) {
  return currentLoader(url);
}

// <stdin>
import { Fragment as Fragment2, jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
var SEASONS = [
  { key: "2026-fall", label: "2026\u79CB", path: "/data/season-2026-fall.json" },
  { key: "2026-spring", label: "2026\u6625", path: "/data/season-2026-spring.json" },
  { key: "2025-fall", label: "2025\u79CB", path: "/data/season-2025-fall.json" }
];
function heatColor(rate, metric) {
  if (rate === null) return "#f4f5f5";
  const max = metric === "swings" ? 0.15 : 0.35;
  const t = Math.min(1, rate / max);
  if (t < 0.5) {
    const p2 = t * 2;
    return `rgb(${Math.round(210 + 45 * p2)},${Math.round(229 + 26 * p2)},${Math.round(240 + 15 * p2)})`;
  }
  const p = (t - 0.5) * 2;
  return `rgb(255,${Math.round(255 - 113 * p)},${Math.round(255 - 117 * p)})`;
}
function Heatmap({ pitches, metric, minimum, title }) {
  const cells = useMemo(() => summarizeBarrelZones(pitches, metric), [pitches, metric]);
  const used = cells.reduce((sum, cell) => sum + cell.denominator, 0);
  const barrels = cells.reduce((sum, cell) => sum + cell.numerator, 0);
  return /* @__PURE__ */ jsxs2("article", { className: "barrel-heatmap-card", children: [
    /* @__PURE__ */ jsxs2("header", { children: [
      /* @__PURE__ */ jsxs2("div", { children: [
        /* @__PURE__ */ jsx2("h3", { children: title }),
        /* @__PURE__ */ jsx2("p", { children: metric === "swings" ? "Barrel\u76F8\u5F53 / Swings" : "Barrel\u76F8\u5F53 / BIP" })
      ] }),
      /* @__PURE__ */ jsxs2("strong", { children: [
        used ? `${(barrels / used * 100).toFixed(1)}%` : "\u2014",
        /* @__PURE__ */ jsxs2("small", { children: [
          barrels,
          " / ",
          used
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxs2("div", { className: "barrel-zone-axis", children: [
      /* @__PURE__ */ jsx2("span", { children: "\u9AD8\u3081" }),
      /* @__PURE__ */ jsx2("div", { className: "barrel-zone-grid", "aria-label": `${title}\u306E\u30BE\u30FC\u30F3\u5225Barrel\u76F8\u5F53\u7387`, children: catcherGridOrder(cells, 5).map((cell) => {
        const lowSample = cell.denominator > 0 && cell.denominator < minimum;
        return /* @__PURE__ */ jsxs2("div", { className: `barrel-zone-cell ${cell.row >= 1 && cell.row <= 3 && cell.col >= 1 && cell.col <= 3 ? "strike-cell" : "ball-cell"} ${lowSample ? "low-sample" : ""}`, style: { background: heatColor(cell.rate, metric) }, title: `Barrel\u76F8\u5F53 ${cell.numerator} / ${cell.denominator}`, children: [
          /* @__PURE__ */ jsx2("b", { children: cell.rate === null ? "\u2014" : `${(cell.rate * 100).toFixed(cell.rate > 0 ? 1 : 0)}%` }),
          /* @__PURE__ */ jsx2("small", { children: cell.denominator ? `${cell.numerator}/${cell.denominator}` : "n=0" })
        ] }, `${cell.row}-${cell.col}`);
      }) }),
      /* @__PURE__ */ jsx2("span", { children: "\u4F4E\u3081" })
    ] }),
    /* @__PURE__ */ jsxs2("div", { className: "barrel-zone-x", children: [
      /* @__PURE__ */ jsx2("span", { children: "\u6355\u624B\u304B\u3089\u898B\u3066\u5DE6" }),
      /* @__PURE__ */ jsx2("strong", { children: "\u6355\u624B\u5074\u304B\u3089\u898B\u305F\u56F3" }),
      /* @__PURE__ */ jsx2("span", { children: "\u6355\u624B\u304B\u3089\u898B\u3066\u53F3" })
    ] })
  ] });
}
function BarrelZoneView({ initialSeason = "2026-fall", initialData }) {
  const [datasets, setDatasets] = useState(initialData ? { [initialSeason]: initialData } : {});
  const [error, setError] = useState("");
  const [role, setRole] = useState("batting");
  const [team, setTeam] = useState("\u9752\u5C71\u5B66\u9662\u5927\u5B66");
  const [playerKey, setPlayerKey] = useState("");
  const [season, setSeason] = useState(initialSeason);
  const [metric, setMetric] = useState("swings");
  const [pitchType, setPitchType] = useState("");
  const [batterSide, setBatterSide] = useState("");
  const [pitcherThrows, setPitcherThrows] = useState("");
  const [minimum, setMinimum] = useState(5);
  useEffect(() => {
    let active = true;
    Promise.all(SEASONS.map(async (item) => [item.key, await loadStaticDataset(item.path)])).then((entries) => {
      if (active) setDatasets(Object.fromEntries(entries));
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : "\u30C7\u30FC\u30BF\u3092\u8AAD\u307F\u8FBC\u3081\u307E\u305B\u3093\u3067\u3057\u305F\u3002");
    });
    return () => {
      active = false;
    };
  }, []);
  const allPitches = useMemo(() => SEASONS.flatMap((item) => (datasets[item.key]?.pitches ?? []).map((pitch) => ({ ...pitch, seasonKey: item.key }))), [datasets]);
  const seasonKeys = useMemo(() => season === "compare" ? ["2026-spring", "2026-fall"] : season === "compare-previous" ? ["2025-fall", "2026-spring"] : season === "combined" ? SEASONS.map((item) => item.key) : [season], [season]);
  const periodPitches = useMemo(() => allPitches.filter((pitch) => seasonKeys.includes(pitch.seasonKey)), [allPitches, seasonKeys]);
  const teams = [...new Set(allPitches.map((pitch) => role === "batting" ? pitch.batterTeam : pitch.pitcherTeam))].filter(Boolean).sort();
  const candidates = useMemo(() => {
    const byPlayer = /* @__PURE__ */ new Map();
    for (const pitch of periodPitches) {
      const id = role === "batting" ? pitch.batterId : pitch.pitcherId;
      const rowTeam = role === "batting" ? pitch.batterTeam : pitch.pitcherTeam;
      const kanji = role === "batting" ? pitch.batterKanji : pitch.pitcherKanji;
      const key = canonicalPlayerKey(rowTeam, kanji);
      if (!id || rowTeam !== team || !key) continue;
      const previous = byPlayer.get(key);
      byPlayer.set(key, { key, ids: [.../* @__PURE__ */ new Set([...previous?.ids ?? [], id])], name: role === "batting" ? pitch.batter : pitch.pitcher, kanji, team: rowTeam });
    }
    return [...byPlayer.values()].sort(comparePlayerNames);
  }, [periodPitches, role, team]);
  const effectivePlayerKey = candidates.some((row) => row.key === playerKey) ? playerKey : candidates[0]?.key ?? "";
  const pitchTypes = useMemo(() => [...new Set(periodPitches.filter((pitch) => role === "batting" ? pitch.batterTeam === team : pitch.pitcherTeam === team).map((pitch) => pitch.pitchType).filter(Boolean))].sort(), [periodPitches, role, team]);
  const filtered = useMemo(() => periodPitches.filter((pitch) => {
    if ((role === "batting" ? pitch.batterTeam : pitch.pitcherTeam) !== team) return false;
    const pitchPlayerKey = canonicalPlayerKey(role === "batting" ? pitch.batterTeam : pitch.pitcherTeam, role === "batting" ? pitch.batterKanji : pitch.pitcherKanji);
    if (effectivePlayerKey && pitchPlayerKey !== effectivePlayerKey) return false;
    if (pitchType && pitch.pitchType !== pitchType) return false;
    if (batterSide && pitch.batterSide !== batterSide) return false;
    if (pitcherThrows && pitch.pitcherThrows !== pitcherThrows) return false;
    return true;
  }), [periodPitches, role, team, effectivePlayerKey, pitchType, batterSide, pitcherThrows]);
  const player = candidates.find((row) => row.key === effectivePlayerKey);
  const panels = season.startsWith("compare") ? SEASONS.filter((item) => seasonKeys.includes(item.key)).reverse().map((item) => ({ title: item.label, pitches: filtered.filter((pitch) => pitch.seasonKey === item.key) })) : season === "combined" ? [{ title: "2025\u79CB\uFF0B2026\u6625\uFF0B2026\u79CB \u5408\u7B97", pitches: filtered }] : batterSide ? [{ title: `${SEASONS.find((item) => item.key === season)?.label}\u30FB${batterSide}\u6253\u8005`, pitches: filtered }] : [
    { title: `${SEASONS.find((item) => item.key === season)?.label}\u30FB\u53F3\u6253\u8005`, pitches: filtered.filter((pitch) => pitch.batterSide === "\u53F3") },
    { title: `${SEASONS.find((item) => item.key === season)?.label}\u30FB\u5DE6\u6253\u8005`, pitches: filtered.filter((pitch) => pitch.batterSide === "\u5DE6") }
  ];
  return /* @__PURE__ */ jsxs2("section", { className: "page-section barrel-zone-page", children: [
    /* @__PURE__ */ jsx2("div", { className: "section-heading", children: /* @__PURE__ */ jsx2("h1", { children: "\u30BE\u30FC\u30F3\u5225 Barrel\u76F8\u5F53\u7387" }) }),
    /* @__PURE__ */ jsxs2("details", { className: "barrel-definition chart-definition", children: [
      /* @__PURE__ */ jsx2("summary", { children: "\u6307\u6A19\u306E\u5B9A\u7FA9" }),
      /* @__PURE__ */ jsx2("span", { children: "\u6771\u90FD\u5927\u5B66\u91CE\u7403\u5411\u3051\u306EBarrel\u76F8\u5F53\u6761\u4EF6\uFF08\u6253\u7403\u901F\u5EA6145km/h\u4EE5\u4E0A\u30FB\u6253\u7403\u89D2\u5EA610\u301C35\u5EA6\uFF09\u3092\u4F7F\u7528\u3002MLB\u516C\u5F0FBarrel\u30D5\u30E9\u30B0\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002" })
    ] }),
    /* @__PURE__ */ jsxs2("div", { className: "toolbar barrel-toolbar", children: [
      /* @__PURE__ */ jsxs2("div", { className: "segmented", children: [
        /* @__PURE__ */ jsx2("button", { className: role === "batting" ? "active" : "", onClick: () => {
          setRole("batting");
          setPlayerKey("");
        }, children: "\u6253\u8005\uFF08\u751F\u307F\u51FA\u3057\u305F\uFF09" }),
        /* @__PURE__ */ jsx2("button", { className: role === "pitching" ? "active" : "", onClick: () => {
          setRole("pitching");
          setPlayerKey("");
        }, children: "\u6295\u624B\uFF08\u8A31\u3057\u305F\uFF09" })
      ] }),
      /* @__PURE__ */ jsxs2("label", { children: [
        "\u5927\u5B66",
        /* @__PURE__ */ jsx2("select", { value: team, onChange: (event) => {
          setTeam(event.target.value);
          setPlayerKey("");
        }, children: teams.map((value) => /* @__PURE__ */ jsx2("option", { children: value }, value)) })
      ] }),
      /* @__PURE__ */ jsxs2("label", { children: [
        role === "batting" ? "\u6253\u8005" : "\u6295\u624B",
        /* @__PURE__ */ jsx2("select", { value: effectivePlayerKey, onChange: (event) => setPlayerKey(event.target.value), children: /* @__PURE__ */ jsx2(PlayerOptions, { players: candidates, valueKey: "key" }) })
      ] }),
      /* @__PURE__ */ jsxs2("label", { children: [
        "\u30B7\u30FC\u30BA\u30F3",
        /* @__PURE__ */ jsxs2("select", { value: season, onChange: (event) => setSeason(event.target.value), children: [
          /* @__PURE__ */ jsx2("option", { value: "2026-fall", children: "2026\u79CB\uFF08\u5DE6\u53F3\u6BD4\u8F03\uFF09" }),
          /* @__PURE__ */ jsx2("option", { value: "compare", children: "2026\u6625 vs 2026\u79CB" }),
          /* @__PURE__ */ jsx2("option", { value: "compare-previous", children: "2025\u79CB vs 2026\u6625" }),
          /* @__PURE__ */ jsx2("option", { value: "combined", children: "2025\u79CB\uFF0B2026\u6625\uFF0B2026\u79CB \u5408\u7B97" }),
          /* @__PURE__ */ jsx2("option", { value: "2025-fall", children: "2025\u79CB\uFF08\u5DE6\u53F3\u6BD4\u8F03\uFF09" }),
          /* @__PURE__ */ jsx2("option", { value: "2026-spring", children: "2026\u6625\uFF08\u5DE6\u53F3\u6BD4\u8F03\uFF09" })
        ] })
      ] }),
      /* @__PURE__ */ jsxs2("label", { children: [
        "\u7403\u7A2E",
        /* @__PURE__ */ jsxs2("select", { value: pitchType, onChange: (event) => setPitchType(event.target.value), children: [
          /* @__PURE__ */ jsx2("option", { value: "", children: "\u3059\u3079\u3066" }),
          pitchTypes.map((value) => /* @__PURE__ */ jsx2("option", { children: value }, value))
        ] })
      ] }),
      /* @__PURE__ */ jsxs2("label", { children: [
        "\u6253\u8005\u5DE6\u53F3",
        /* @__PURE__ */ jsxs2("select", { value: batterSide, onChange: (event) => setBatterSide(event.target.value), children: [
          /* @__PURE__ */ jsx2("option", { value: "", children: "\u5DE6\u53F3\u3059\u3079\u3066" }),
          /* @__PURE__ */ jsx2("option", { value: "\u53F3", children: "\u53F3\u6253\u8005" }),
          /* @__PURE__ */ jsx2("option", { value: "\u5DE6", children: "\u5DE6\u6253\u8005" })
        ] })
      ] }),
      /* @__PURE__ */ jsxs2("label", { children: [
        "\u6295\u624B\u5DE6\u53F3",
        /* @__PURE__ */ jsxs2("select", { value: pitcherThrows, onChange: (event) => setPitcherThrows(event.target.value), children: [
          /* @__PURE__ */ jsx2("option", { value: "", children: "\u5DE6\u53F3\u3059\u3079\u3066" }),
          /* @__PURE__ */ jsx2("option", { value: "\u53F3", children: "\u53F3\u6295\u624B" }),
          /* @__PURE__ */ jsx2("option", { value: "\u5DE6", children: "\u5DE6\u6295\u624B" })
        ] })
      ] }),
      /* @__PURE__ */ jsxs2("label", { children: [
        "\u8584\u8868\u793A\u306E\u57FA\u6E96",
        /* @__PURE__ */ jsx2("input", { type: "number", min: "1", max: "50", value: minimum, onChange: (event) => setMinimum(Math.max(1, Number(event.target.value) || 1)) })
      ] })
    ] }),
    /* @__PURE__ */ jsxs2("div", { className: "segmented barrel-metric", children: [
      /* @__PURE__ */ jsx2("button", { className: metric === "swings" ? "active" : "", onClick: () => setMetric("swings"), children: "Barrel\u76F8\u5F53 / Swings" }),
      /* @__PURE__ */ jsx2("button", { className: metric === "bip" ? "active" : "", onClick: () => setMetric("bip"), children: "Barrel\u76F8\u5F53 / BIP" })
    ] }),
    error && !seasonKeys.every((key) => datasets[key]) ? /* @__PURE__ */ jsx2("div", { className: "empty-state", children: /* @__PURE__ */ jsx2("h2", { children: error }) }) : !seasonKeys.every((key) => datasets[key]) ? /* @__PURE__ */ jsx2("div", { className: "loading-panel", children: "\u30B7\u30FC\u30BA\u30F3\u30C7\u30FC\u30BF\u3092\u96C6\u8A08\u3057\u3066\u3044\u307E\u3059\u2026" }) : /* @__PURE__ */ jsxs2(Fragment2, { children: [
      /* @__PURE__ */ jsxs2("div", { className: "barrel-summary", children: [
        /* @__PURE__ */ jsxs2("div", { children: [
          /* @__PURE__ */ jsx2("small", { children: role === "batting" ? "\u6253\u8005" : "\u6295\u624B" }),
          /* @__PURE__ */ jsx2("strong", { children: player?.kanji || player?.name || "\u2014" }),
          /* @__PURE__ */ jsx2("span", { children: team })
        ] }),
        /* @__PURE__ */ jsxs2("div", { children: [
          /* @__PURE__ */ jsx2("small", { children: "\u5BFE\u8C61\u7403" }),
          /* @__PURE__ */ jsx2("strong", { children: filtered.length.toLocaleString("ja-JP") }),
          /* @__PURE__ */ jsx2("span", { children: "\u30B3\u30FC\u30B9\u8A18\u9332\u3092\u30D5\u30A3\u30EB\u30BF\u30FC\u5F8C\u306B\u96C6\u8A08" })
        ] })
      ] }),
      /* @__PURE__ */ jsx2("div", { className: "barrel-heatmap-grid", children: panels.map((panel) => /* @__PURE__ */ jsx2(Heatmap, { title: panel.title, pitches: panel.pitches, metric, minimum }, panel.title)) }),
      /* @__PURE__ */ jsxs2("div", { className: "barrel-legend", children: [
        /* @__PURE__ */ jsx2("span", { children: "\u4F4E\u3044" }),
        /* @__PURE__ */ jsx2("i", {}),
        /* @__PURE__ */ jsx2("i", {}),
        /* @__PURE__ */ jsx2("i", {}),
        /* @__PURE__ */ jsx2("i", {}),
        /* @__PURE__ */ jsx2("i", {}),
        /* @__PURE__ */ jsx2("span", { children: "\u9AD8\u3044" })
      ] })
    ] })
  ] });
}
export {
  Heatmap,
  BarrelZoneView as default
};
