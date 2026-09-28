"use client";

// <stdin>
import { useEffect, useMemo, useRef, useState } from "react";

// lib/catcher-view.ts
function catcherX(sourceX) {
  return sourceX === 0 ? 0 : -sourceX;
}
function catcherSpinVector(point) {
  return { x: catcherX(point.x), y: point.y, z: catcherX(point.z) };
}
function catcherSpinAxis(sourceAxis) {
  return (360 - sourceAxis % 360) % 360;
}

// lib/chart-geometry.ts
function pitchProjection(width, height, bounds = { left: -0.65, right: 0.65, bottom: 0.15, top: 1.4 }, padding = 24) {
  const scale = Math.min((width - 2 * padding) / (bounds.right - bounds.left), (height - 2 * padding) / (bounds.top - bounds.bottom));
  const x = (v) => width / 2 + (v - (bounds.left + bounds.right) / 2) * scale;
  const y = (v) => height / 2 - (v - (bounds.top + bounds.bottom) / 2) * scale;
  return { x, y, scale, left: x(bounds.left), top: y(bounds.top), width: (bounds.right - bounds.left) * scale, height: (bounds.top - bounds.bottom) * scale };
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
  const mean2 = weighted(rows, key);
  const variance = weighted(rows.map((r) => ({ n: r.n, value: (r[key] - mean2) ** 2 })), "value");
  const sd = Math.sqrt(variance ?? 0);
  return (value) => finite(value) && mean2 !== null ? sd > 1e-9 ? (value - mean2) / sd : 0 : null;
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
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
var pitchDefinitions = [
  { id: "fastball", label: "\u30B9\u30C8\u30EC\u30FC\u30C8", short: "FB", color: "#e73d4f", seamPlacement: "four-seam" },
  { id: "sinker", label: "\u30B7\u30F3\u30AB\u30FC", short: "SI", color: "#f28b38", seamPlacement: "four-seam" },
  { id: "cutter", label: "\u30AB\u30C3\u30C8\u30DC\u30FC\u30EB", short: "CT", color: "#735fe0", seamPlacement: "display" },
  { id: "slider", label: "\u30B9\u30E9\u30A4\u30C0\u30FC", short: "SL", color: "#4ba6ee", seamPlacement: "display" },
  { id: "curveball", label: "\u30AB\u30FC\u30D6", short: "CB", color: "#22a37a", seamPlacement: "display" },
  { id: "changeup", label: "\u30C1\u30A7\u30F3\u30B8\u30A2\u30C3\u30D7", short: "CH", color: "#e39a13", seamPlacement: "display" },
  { id: "splitter", label: "\u30D5\u30A9\u30FC\u30AF", short: "FO", color: "#ba5878", seamPlacement: "display" },
  { id: "other", label: "\u305D\u306E\u4ED6", short: "OT", color: "#607d8b", seamPlacement: "display" },
  { id: "knuckleball", label: "\u30CA\u30C3\u30AF\u30EB", short: "KN", color: "#596577", seamPlacement: "display" }
];
function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
function median(values) {
  const sorted = [...values].filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function circularMean(values) {
  const radians = values.filter(Number.isFinite).map((value) => value * Math.PI / 180);
  const angle = Math.atan2(mean(radians.map(Math.sin)), mean(radians.map(Math.cos))) * 180 / Math.PI;
  return (angle + 360) % 360;
}
function modalTilt(values) {
  const counts = /* @__PURE__ */ new Map();
  values.filter((value) => value && value !== "\u2014").forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "\u2014";
}
function buildPitchProfiles(pitches) {
  return pitchDefinitions.flatMap((definition) => {
    const rows = pitches.filter((pitch) => pitch.pitchType === definition.id);
    if (!rows.length) return [];
    const estimates = rows.filter((pitch) => Number.isFinite(pitch.gyroAngle) && Number.isFinite(pitch.spinEfficiency) && Number.isFinite(pitch.activeSpin));
    return [{
      ...definition,
      count: rows.length,
      estimateCount: estimates.length,
      velocity: mean(rows.map((pitch) => pitch.velocity)),
      spinRate: mean(rows.map((pitch) => pitch.spinRate)),
      spinAxis: circularMean(rows.map((pitch) => pitch.spinAxis)),
      measuredTilt: modalTilt(rows.map((pitch) => pitch.measuredTilt)),
      ivb: mean(rows.map((pitch) => pitch.ivb)),
      hb: mean(rows.map((pitch) => pitch.hb)),
      gyroAngle: median(estimates.map((pitch) => pitch.gyroAngle)),
      spinEfficiency: median(estimates.map((pitch) => pitch.spinEfficiency)),
      activeSpin: median(estimates.map((pitch) => pitch.activeSpin)),
      confidence: rows.length >= 20 ? "\u4E2D" : rows.length >= 5 ? "\u53C2\u8003" : "\u4F4E",
      clampedShare: rows.filter((pitch) => pitch.estimateClamped).length / rows.length,
      rotationDirection: -1
    }];
  });
}
var speedOptions = [
  { value: 0.01, label: "0.01\xD7" },
  { value: 0.025, label: "0.025\xD7" },
  { value: 0.05, label: "0.05\xD7" }
];
function clockFromAxis(axis) {
  const clockMinutes = (axis - 180 + 360) % 360 / 360 * 720;
  const rounded = Math.round(clockMinutes);
  const hour = Math.floor(rounded / 60) % 12 || 12;
  const minute = rounded % 60;
  return `${hour}:${String(minute).padStart(2, "0")}`;
}
function signed(value) {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}`;
}
function rotateAroundAxis(point, axis, angle) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dot = point.x * axis.x + point.y * axis.y + point.z * axis.z;
  return {
    x: point.x * cos + (axis.y * point.z - axis.z * point.y) * sin + axis.x * dot * (1 - cos),
    y: point.y * cos + (axis.z * point.x - axis.x * point.z) * sin + axis.y * dot * (1 - cos),
    z: point.z * cos + (axis.x * point.y - axis.y * point.x) * sin + axis.z * dot * (1 - cos)
  };
}
function add3(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}
function scale3(point, amount) {
  return { x: point.x * amount, y: point.y * amount, z: point.z * amount };
}
function normalize3(point) {
  const length = Math.hypot(point.x, point.y, point.z) || 1;
  return scale3(point, 1 / length);
}
function cross3(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}
function seamPoint(t) {
  const a = 0.4;
  const polar = Math.PI / 2 - (Math.PI / 2 - a) * Math.cos(t);
  const azimuth = t / 2 + a * Math.sin(2 * t);
  return {
    x: Math.sin(polar) * Math.cos(azimuth),
    y: Math.sin(polar) * Math.sin(azimuth),
    z: Math.cos(polar)
  };
}
function seamFrame(t) {
  const point = seamPoint(t);
  const before = seamPoint(t - 2e-3);
  const after = seamPoint(t + 2e-3);
  const tangent = normalize3({ x: after.x - before.x, y: after.y - before.y, z: after.z - before.z });
  const normal = normalize3(cross3(point, tangent));
  return { point, tangent, normal };
}
function alignAxis(point, from, to) {
  const source = normalize3(from);
  const target = normalize3(to);
  const rotationAxis = cross3(source, target);
  const sine = Math.hypot(rotationAxis.x, rotationAxis.y, rotationAxis.z);
  const cosine = source.x * target.x + source.y * target.y + source.z * target.z;
  if (sine < 1e-7) {
    if (cosine > 0) return point;
    const fallback = Math.abs(source.x) < 0.9 ? normalize3(cross3(source, { x: 1, y: 0, z: 0 })) : normalize3(cross3(source, { x: 0, y: 1, z: 0 }));
    return rotateAroundAxis(point, fallback, Math.PI);
  }
  return rotateAroundAxis(point, scale3(rotationAxis, 1 / sine), Math.atan2(sine, cosine));
}
function orientBaseball(point, axis, placement) {
  if (placement === "four-seam") {
    const phased = rotateAroundAxis(point, { x: 0, y: 0, z: 1 }, Math.PI / 4);
    return alignAxis(phased, { x: 0, y: 0, z: 1 }, axis);
  }
  const yawed = rotateAroundAxis(point, { x: 0, y: 1, z: 0 }, -0.34);
  return rotateAroundAxis(yawed, { x: 1, y: 0, z: 0 }, 0.18);
}
function buildStitchFrames() {
  const resolution = 2160;
  const samples = [{ t: 0, distance: 0 }];
  let distance = 0;
  let previous = seamPoint(0);
  for (let index = 1; index <= resolution; index += 1) {
    const t = index / resolution * Math.PI * 4;
    const point = seamPoint(t);
    distance += Math.hypot(point.x - previous.x, point.y - previous.y, point.z - previous.z);
    samples.push({ t, distance });
    previous = point;
  }
  return Array.from({ length: 108 }, (_, stitchIndex) => {
    const target = (stitchIndex + 0.5) / 108 * distance;
    let low = 0;
    let high = samples.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (samples[middle].distance < target) low = middle + 1;
      else high = middle;
    }
    return seamFrame(samples[low].t);
  });
}
var baseballStitches = buildStitchFrames();
var leatherGrain = Array.from({ length: 190 }, (_, index) => {
  const z = 1 - 2 * (index + 0.5) / 190;
  const radius = Math.sqrt(Math.max(0, 1 - z * z));
  const angle = index * Math.PI * (3 - Math.sqrt(5));
  return {
    point: { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, z },
    size: 0.55 + index * 37 % 11 / 16,
    tone: index * 53 % 4
  };
});
function SpinScene({ profile, speed, paused }) {
  const canvasRef = useRef(null);
  const rotationRef = useRef(0);
  useEffect(() => {
    if (canvasRef.current) return startSpinAnimation(canvasRef.current, profile, speed, paused, rotationRef);
  }, [profile, speed, paused]);
  return /* @__PURE__ */ jsx("canvas", { ref: canvasRef, className: "spin-canvas", role: "img", "data-view": "catcher", "data-rotation-direction": profile.rotationDirection < 0 ? "counterclockwise" : "clockwise", "data-seam-placement": profile.seamPlacement, "aria-label": `${profile.label}\u306E\u6355\u624B\u8996\u70B9\u30FB\u63A8\u5B9A3D\u56DE\u8EE2\u30A2\u30CB\u30E1\u30FC\u30B7\u30E7\u30F3` });
}
function startSpinAnimation(canvas, profile, speed, paused, rotationRef) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  let frame = 0;
  let last = performance.now();
  const tilt = (profile.spinAxis - 180 + 360) % 360 * Math.PI / 180;
  const gyro = profile.gyroAngle * Math.PI / 180;
  const transverseSpin = Math.cos(gyro);
  const axis = catcherSpinVector({
    x: -Math.cos(tilt) * transverseSpin,
    y: Math.sin(tilt) * transverseSpin,
    z: Math.sin(gyro)
  });
  const drawArrow = (x, y, angle, size) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.55, -size * 0.58);
    ctx.lineTo(-size * 0.35, 0);
    ctx.lineTo(-size * 0.55, size * 0.58);
    ctx.closePath();
    ctx.fillStyle = profile.color;
    ctx.strokeStyle = "rgba(255,255,255,.96)";
    ctx.lineWidth = Math.max(2, size * 0.28);
    ctx.stroke();
    ctx.fill();
    ctx.restore();
  };
  const render = (now) => {
    frame = requestAnimationFrame(render);
    const elapsed = Math.max(0, Math.min((now - last) / 1e3, 0.04));
    last = now;
    if (!paused) rotationRef.current += profile.rotationDirection * profile.spinRate * Math.PI * 2 / 60 * speed * elapsed;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(rect.width, 1);
    const height = Math.max(rect.height, 1);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const cx = width * 0.53;
    const cy = height * 0.47;
    const radius = Math.min(width, height) * 0.265;
    const transformSurface = (point) => rotateAroundAxis(orientBaseball(point, axis, profile.seamPlacement), axis, rotationRef.current);
    ctx.save();
    ctx.filter = "blur(15px)";
    ctx.fillStyle = "rgba(13,36,74,.16)";
    ctx.beginPath();
    ctx.ellipse(cx + radius * 0.13, cy + radius * 1.18, radius * 0.88, radius * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const ballGradient = ctx.createRadialGradient(cx - radius * 0.33, cy - radius * 0.39, radius * 0.05, cx + radius * 0.08, cy + radius * 0.1, radius * 1.1);
    ballGradient.addColorStop(0, "#fffefa");
    ballGradient.addColorStop(0.43, "#f7f3e9");
    ballGradient.addColorStop(0.76, "#ddd7ca");
    ballGradient.addColorStop(0.94, "#b8b2a8");
    ballGradient.addColorStop(1, "#8f8d89");
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = ballGradient;
    ctx.shadowColor = "rgba(28,43,67,.23)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 11;
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 1, 0, Math.PI * 2);
    ctx.clip();
    const gleam = ctx.createRadialGradient(cx - radius * 0.42, cy - radius * 0.5, 0, cx - radius * 0.42, cy - radius * 0.5, radius * 0.68);
    gleam.addColorStop(0, "rgba(255,255,255,.72)");
    gleam.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gleam;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
    leatherGrain.forEach((grain) => {
      const point = transformSurface(grain.point);
      if (point.z < 0.04) return;
      const depth = Math.min(1, (point.z - 0.04) / 0.96);
      ctx.beginPath();
      ctx.arc(cx + point.x * radius, cy - point.y * radius, grain.size * (0.55 + depth * 0.45), 0, Math.PI * 2);
      ctx.fillStyle = grain.tone === 0 ? `rgba(102,86,67,${0.055 * depth})` : `rgba(255,255,255,${0.11 * depth})`;
      ctx.fill();
    });
    const drawSeamCurve = (offset, color, lineWidth) => {
      let drawing = false;
      ctx.beginPath();
      for (let index = 0; index <= 520; index += 1) {
        const t = index / 520 * Math.PI * 4;
        const frameAtPoint = seamFrame(t);
        const surfacePoint = normalize3(add3(frameAtPoint.point, scale3(frameAtPoint.normal, offset)));
        const point = transformSurface(surfacePoint);
        const x = cx + point.x * radius;
        const y = cy - point.y * radius;
        const visible = point.z > -0.015;
        if (visible && !drawing) {
          ctx.moveTo(x, y);
          drawing = true;
        } else if (visible) ctx.lineTo(x, y);
        else drawing = false;
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    };
    drawSeamCurve(-0.018, "rgba(113,92,75,.38)", Math.max(0.8, radius * 7e-3));
    drawSeamCurve(0.018, "rgba(113,92,75,.38)", Math.max(0.8, radius * 7e-3));
    drawSeamCurve(0, "rgba(74,48,39,.46)", Math.max(1.2, radius * 0.012));
    baseballStitches.forEach(({ point, tangent, normal }) => {
      const center = transformSurface(point);
      if (center.z < 0.025) return;
      const stitchWidth = 0.056;
      const stitchLength = 0.026;
      const makePoint = (normalAmount, tangentAmount) => normalize3(add3(add3(point, scale3(normal, normalAmount)), scale3(tangent, tangentAmount)));
      const segments = [
        [makePoint(stitchWidth, -stitchLength), makePoint(stitchWidth * 0.12, stitchLength)],
        [makePoint(-stitchWidth, stitchLength), makePoint(-stitchWidth * 0.12, -stitchLength)]
      ];
      segments.forEach(([startPoint, endPoint]) => {
        const start = transformSurface(startPoint);
        const end = transformSurface(endPoint);
        if (start.z < 0 || end.z < 0) return;
        ctx.beginPath();
        ctx.moveTo(cx + start.x * radius, cy - start.y * radius);
        ctx.lineTo(cx + end.x * radius, cy - end.y * radius);
        ctx.strokeStyle = "rgba(83,17,27,.42)";
        ctx.lineWidth = Math.max(2.8, radius * 0.019);
        ctx.lineCap = "round";
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx + start.x * radius, cy - start.y * radius - radius * 3e-3);
        ctx.lineTo(cx + end.x * radius, cy - end.y * radius - radius * 3e-3);
        ctx.strokeStyle = "#c52334";
        ctx.lineWidth = Math.max(1.55, radius * 0.011);
        ctx.stroke();
      });
    });
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(61,67,76,.22)";
    ctx.lineWidth = 1;
    ctx.stroke();
    const axisScreen = { x: axis.x, y: -axis.y };
    const frontAxisX = cx + axisScreen.x * radius;
    const frontAxisY = cy + axisScreen.y * radius;
    const backAxisX = cx - axisScreen.x * radius;
    const backAxisY = cy - axisScreen.y * radius;
    const transverseLength = Math.hypot(axis.x, axis.y);
    const ringU = transverseLength > 1e-3 ? { x: -axis.y / transverseLength, y: axis.x / transverseLength, z: 0 } : { x: 1, y: 0, z: 0 };
    const ringV = {
      x: axis.y * ringU.z - axis.z * ringU.y,
      y: axis.z * ringU.x - axis.x * ringU.z,
      z: axis.x * ringU.y - axis.y * ringU.x
    };
    const ringRadius = radius * 1.22;
    ctx.beginPath();
    for (let i = 0; i <= 120; i += 1) {
      const phi = i / 120 * Math.PI * 2;
      const x = cx + (ringU.x * Math.cos(phi) + ringV.x * Math.sin(phi)) * ringRadius;
      const y = cy - (ringU.y * Math.cos(phi) + ringV.y * Math.sin(phi)) * ringRadius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "rgba(255,255,255,.93)";
    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(8, radius * 0.063);
    ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i <= 120; i += 1) {
      const phi = i / 120 * Math.PI * 2;
      const x = cx + (ringU.x * Math.cos(phi) + ringV.x * Math.sin(phi)) * ringRadius;
      const y = cy - (ringU.y * Math.cos(phi) + ringV.y * Math.sin(phi)) * ringRadius;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = profile.color;
    ctx.globalAlpha = 0.94;
    ctx.lineWidth = Math.max(4, radius * 0.034);
    ctx.stroke();
    [0.28, 1.32, 2.36, 3.42, 4.48, 5.52].forEach((phi) => {
      const x = cx + (ringU.x * Math.cos(phi) + ringV.x * Math.sin(phi)) * ringRadius;
      const y = cy - (ringU.y * Math.cos(phi) + ringV.y * Math.sin(phi)) * ringRadius;
      const tangentX = (-ringU.x * Math.sin(phi) + ringV.x * Math.cos(phi)) * profile.rotationDirection;
      const tangentY = (ringU.y * Math.sin(phi) - ringV.y * Math.cos(phi)) * profile.rotationDirection;
      drawArrow(x, y, Math.atan2(tangentY, tangentX), Math.max(8, radius * 0.075));
    });
    const rodScale = 1.48;
    const rodStartX = cx - axisScreen.x * radius * rodScale;
    const rodStartY = cy - axisScreen.y * radius * rodScale;
    const rodEndX = cx + axisScreen.x * radius * rodScale;
    const rodEndY = cy + axisScreen.y * radius * rodScale;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(rodStartX, rodStartY);
    ctx.lineTo(rodEndX, rodEndY);
    ctx.strokeStyle = "rgba(255,255,255,.97)";
    ctx.lineWidth = Math.max(11, radius * 0.08);
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(rodStartX, rodStartY);
    ctx.lineTo(rodEndX, rodEndY);
    ctx.strokeStyle = "#0b1f42";
    ctx.lineWidth = Math.max(4.5, radius * 0.033);
    ctx.stroke();
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.arc(backAxisX, backAxisY, Math.max(7, radius * (0.046 - axis.z * 0.01)), 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,.9)";
    ctx.fill();
    ctx.strokeStyle = "#0b1f42";
    ctx.lineWidth = Math.max(2, radius * 0.014);
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(frontAxisX, frontAxisY, Math.max(9, radius * (0.055 + axis.z * 0.026)), 0, Math.PI * 2);
    ctx.fillStyle = profile.color;
    ctx.shadowColor = "rgba(11,31,66,.28)";
    ctx.shadowBlur = 9;
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = "rgba(255,255,255,.98)";
    ctx.lineWidth = Math.max(3, radius * 0.021);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(frontAxisX, frontAxisY, Math.max(2.4, radius * 0.016), 0, Math.PI * 2);
    ctx.fillStyle = "#0b1f42";
    ctx.fill();
  };
  frame = requestAnimationFrame(render);
  return () => cancelAnimationFrame(frame);
}
function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
function PitchLocationChart({ pitch, color }) {
  const hasLocation = Number.isFinite(pitch.plateLocHeight) && Number.isFinite(pitch.plateLocSide);
  const extent = Math.max(0.55, hasLocation ? Math.abs(pitch.plateLocSide) + 0.05 : 0);
  const projection = pitchProjection(130, 130, { left: -extent, right: extent, bottom: Math.min(0.15, hasLocation ? pitch.plateLocHeight - 0.05 : 0.15), top: Math.max(1.35, hasLocation ? pitch.plateLocHeight + 0.05 : 1.35) }, 8);
  const x = projection.x(hasLocation ? catcherX(pitch.plateLocSide) : 0);
  const y = projection.y(hasLocation ? pitch.plateLocHeight : 0.75);
  const zoneLeft = projection.x(-0.254), zoneRight = projection.x(0.254), zoneTop = projection.y(1.05), zoneBottom = projection.y(0.45);
  const inZone = hasLocation && Math.abs(pitch.plateLocSide) <= 0.254 && pitch.plateLocHeight >= 0.45 && pitch.plateLocHeight <= 1.05;
  return /* @__PURE__ */ jsxs("section", { className: "mini-chart", "aria-label": "\u6355\u624B\u5074\u304B\u3089\u898B\u305F9\u5206\u5272\u30B9\u30C8\u30E9\u30A4\u30AF\u30BE\u30FC\u30F3\u306E\u6295\u7403\u4F4D\u7F6E", children: [
    /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsx("strong", { children: "PITCH LOCATION" }),
      /* @__PURE__ */ jsx("span", { children: hasLocation ? inZone ? "ZONE" : "OUT" : "NO DATA" })
    ] }),
    /* @__PURE__ */ jsxs("svg", { viewBox: "0 0 130 130", role: "img", "aria-label": hasLocation ? `\u30D7\u30EC\u30FC\u30C8\u6A2A\u4F4D\u7F6E${pitch.plateLocSide.toFixed(2)}\u30E1\u30FC\u30C8\u30EB\u3001\u9AD8\u3055${pitch.plateLocHeight.toFixed(2)}\u30E1\u30FC\u30C8\u30EB` : "\u6295\u7403\u4F4D\u7F6E\u30C7\u30FC\u30BF\u306A\u3057", children: [
      /* @__PURE__ */ jsx("rect", { x: zoneLeft, y: zoneTop, width: zoneRight - zoneLeft, height: zoneBottom - zoneTop, className: "chart-zone" }),
      [1, 2].map((i) => /* @__PURE__ */ jsxs("g", { className: "chart-grid", children: [
        /* @__PURE__ */ jsx("line", { x1: zoneLeft + (zoneRight - zoneLeft) * i / 3, x2: zoneLeft + (zoneRight - zoneLeft) * i / 3, y1: zoneTop, y2: zoneBottom }),
        /* @__PURE__ */ jsx("line", { x1: zoneLeft, x2: zoneRight, y1: zoneTop + (zoneBottom - zoneTop) * i / 3, y2: zoneTop + (zoneBottom - zoneTop) * i / 3 })
      ] }, i)),
      /* @__PURE__ */ jsx("path", { d: `M${projection.x(0)} 6V124M8 ${projection.y(0.75)}H122`, className: "chart-crosshair" }),
      hasLocation ? /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx("circle", { cx: x, cy: y, r: "8", fill: "white", opacity: ".95" }),
        /* @__PURE__ */ jsx("circle", { cx: x, cy: y, r: "5.2", fill: color })
      ] }) : /* @__PURE__ */ jsx("text", { x: "65", y: "70", textAnchor: "middle", children: "\u4F4D\u7F6E\u30C7\u30FC\u30BF\u306A\u3057" })
    ] }),
    /* @__PURE__ */ jsx("p", { children: hasLocation ? `\u6355\u624B\u8996\u70B9\uFF5CSide ${signed(pitch.plateLocSide * 100)} / Height ${(pitch.plateLocHeight * 100).toFixed(1)} cm` : "\u6355\u624B\u8996\u70B9\uFF5CPlateLoc\u672A\u8A18\u9332" })
  ] });
}
function MovementCrossChart({ pitch, color, average: average2 = false }) {
  const range = 70;
  const x = 65 + clamp(catcherX(pitch.hb), -range, range) / range * 49;
  const y = 65 - clamp(pitch.ivb, -range, range) / range * 49;
  return /* @__PURE__ */ jsxs("section", { className: "mini-chart", "aria-label": average2 ? "\u7403\u7A2E\u5E73\u5747\u306E\u7E26\u6A2A\u5909\u5316\u91CF" : "\u6295\u7403\u5225\u306E\u7E26\u6A2A\u5909\u5316\u91CF", children: [
    /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsx("strong", { children: average2 ? "AVERAGE MOVEMENT" : "MOVEMENT" }),
      /* @__PURE__ */ jsx("span", { children: "\xB170 cm" })
    ] }),
    /* @__PURE__ */ jsxs("svg", { viewBox: "0 0 130 130", role: "img", "aria-label": `IVB ${signed(pitch.ivb)}\u30BB\u30F3\u30C1\u3001HB ${signed(pitch.hb)}\u30BB\u30F3\u30C1`, children: [
      /* @__PURE__ */ jsx("rect", { x: "10", y: "10", width: "110", height: "110", rx: "7", className: "chart-frame" }),
      /* @__PURE__ */ jsx("path", { d: "M65 10V120M10 65H120", className: "chart-crosshair strong" }),
      /* @__PURE__ */ jsx("text", { x: "65", y: "8", textAnchor: "middle", children: "+IVB" }),
      /* @__PURE__ */ jsx("text", { x: "65", y: "129", textAnchor: "middle", children: "\u2212IVB" }),
      /* @__PURE__ */ jsx("text", { x: "121", y: "61", textAnchor: "end", children: "\u2212HB \u6355\u624B\u53F3" }),
      /* @__PURE__ */ jsx("text", { x: "11", y: "61", children: "\u6355\u624B\u5DE6 +HB" }),
      /* @__PURE__ */ jsx("circle", { cx: x, cy: y, r: "8", fill: "white", opacity: ".95" }),
      /* @__PURE__ */ jsx("circle", { cx: x, cy: y, r: "5.2", fill: color })
    ] }),
    /* @__PURE__ */ jsxs("p", { children: [
      "IVB ",
      signed(pitch.ivb),
      " / HB ",
      signed(pitch.hb),
      " cm"
    ] })
  ] });
}
var japanesePitchIds = {
  "\u30B9\u30C8\u30EC\u30FC\u30C8": "fastball",
  "\u30B7\u30F3\u30AB\u30FC": "sinker",
  "\u30AB\u30C3\u30C8\u30DC\u30FC\u30EB": "cutter",
  "\u30AB\u30C3\u30C8": "cutter",
  "\u30B9\u30E9\u30A4\u30C0\u30FC": "slider",
  "\u30AB\u30FC\u30D6": "curveball",
  "\u30C1\u30A7\u30F3\u30B8\u30A2\u30C3\u30D7": "changeup",
  "\u30D5\u30A9\u30FC\u30AF": "splitter",
  "\u30B9\u30D7\u30EA\u30C3\u30C8": "splitter",
  "\u30CA\u30C3\u30AF\u30EB": "knuckleball"
};
function metricToken(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(1) : "\u2014";
}
function savantMatchKey(pitch) {
  return [
    pitch.date,
    japanesePitchIds[String(pitch.pitchType)] ?? pitch.pitchType,
    metricToken(pitch.velocity),
    metricToken(pitch.spin),
    metricToken(pitch.spinAxis),
    metricToken(pitch.ivb),
    metricToken(pitch.hb)
  ].join("|");
}
function spinMatchKey(pitch) {
  return [
    pitch.date,
    pitch.pitchType,
    metricToken(pitch.velocity),
    metricToken(pitch.spinRate),
    metricToken(pitch.spinAxis),
    metricToken(pitch.ivb),
    metricToken(pitch.hb)
  ].join("|");
}
function PitchSpinProfile({ season, playerId, playerName, pitches: filteredPitches, filtersActive, initialPitchType }) {
  const [seasonPitches, setSeasonPitches] = useState([]);
  const [dataState, setDataState] = useState("loading");
  const [selectedId, setSelectedId] = useState(japanesePitchIds[initialPitchType ?? ""] ?? "fastball");
  const [speed, setSpeed] = useState(0.025);
  const [paused, setPaused] = useState(false);
  const [mode, setMode] = useState("average");
  const [pitchIndex, setPitchIndex] = useState(0);
  useEffect(() => {
    const next = japanesePitchIds[initialPitchType ?? ""];
    if (next) {
      setSelectedId(next);
      setPitchIndex(0);
    }
  }, [initialPitchType]);
  useEffect(() => {
    let active = true;
    setDataState("loading");
    loadStaticDataset(`/data/spin-${season}.json`).then((rows) => {
      if (!active) return;
      setSeasonPitches(rows.filter((pitch2) => pitch2.pitcherId === `${season}:${playerId}`));
      setDataState("ready");
    }).catch(() => {
      if (active) setDataState("error");
    });
    return () => {
      active = false;
    };
  }, [season, playerId]);
  const playerPitches = useMemo(() => {
    if (!filtersActive) return seasonPitches;
    if (!filteredPitches.length) return [];
    const ids = new Set(filteredPitches.map((row) => row.id));
    if (seasonPitches.every((row) => row.pitchId)) return seasonPitches.filter((row) => ids.has(row.pitchId));
    const remaining = /* @__PURE__ */ new Map();
    filteredPitches.forEach((pitch2) => {
      const key = savantMatchKey(pitch2);
      remaining.set(key, (remaining.get(key) ?? 0) + 1);
    });
    return seasonPitches.filter((pitch2) => {
      const key = spinMatchKey(pitch2);
      const count = remaining.get(key) ?? 0;
      if (!count) return false;
      remaining.set(key, count - 1);
      return true;
    });
  }, [filteredPitches, filtersActive, seasonPitches]);
  const pitchProfiles = useMemo(() => buildPitchProfiles(playerPitches), [playerPitches]);
  const profile = pitchProfiles.find((row) => row.id === selectedId) ?? pitchProfiles[0];
  const pitchRows = useMemo(() => profile ? playerPitches.filter((row) => row.pitchType === profile.id) : [], [playerPitches, profile]);
  const pitch = pitchRows[Math.min(pitchIndex, Math.max(pitchRows.length - 1, 0))];
  const displayProfile = profile && mode === "pitch" && pitch ? { ...profile, velocity: pitch.velocity, spinRate: pitch.spinRate, spinAxis: pitch.spinAxis, measuredTilt: pitch.measuredTilt, ivb: pitch.ivb, hb: pitch.hb, gyroAngle: pitch.gyroAngle ?? 0, spinEfficiency: pitch.spinEfficiency ?? 0, activeSpin: pitch.activeSpin ?? 0, estimateCount: pitch.gyroAngle === null ? 0 : 1 } : profile;
  useEffect(() => {
    if (profile && profile.id !== selectedId) setSelectedId(profile.id);
  }, [profile?.id]);
  if (dataState !== "ready") {
    return /* @__PURE__ */ jsx("section", { className: "spin-embed", children: /* @__PURE__ */ jsxs("div", { className: `data-status-card ${dataState}`, role: "status", children: [
      /* @__PURE__ */ jsx("span", { className: "status-ball" }),
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("strong", { children: dataState === "error" ? "\u56DE\u8EE2\u30C7\u30FC\u30BF\u3092\u8AAD\u307F\u8FBC\u3081\u307E\u305B\u3093\u3067\u3057\u305F" : "\u56DE\u8EE2\u30C7\u30FC\u30BF\u3092\u8AAD\u307F\u8FBC\u307F\u4E2D" }),
        /* @__PURE__ */ jsx("p", { children: dataState === "error" ? "\u30DA\u30FC\u30B8\u3092\u518D\u8AAD\u307F\u8FBC\u307F\u3057\u3066\u304F\u3060\u3055\u3044\u3002" : "\u5B9F\u6E2C\u5024\u3068\u63A8\u5B9A3D\u56DE\u8EE2\u3092\u6E96\u5099\u3057\u3066\u3044\u307E\u3059\u3002" })
      ] })
    ] }) });
  }
  if (!profile || !displayProfile) {
    return /* @__PURE__ */ jsx("section", { className: "spin-embed", children: /* @__PURE__ */ jsx("div", { className: "data-status-card", children: /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsx("strong", { children: "\u3053\u306E\u6761\u4EF6\u306B\u56DE\u8EE2\u6570\u30FB\u56DE\u8EE2\u8EF8\u306E\u8A08\u6E2C\u30C7\u30FC\u30BF\u304C\u3042\u308A\u307E\u305B\u3093" }),
      /* @__PURE__ */ jsx("p", { children: "\u4E0A\u90E8\u306E\u5206\u6790\u6761\u4EF6\u3092\u7DE9\u3081\u308B\u3068\u8868\u793A\u3067\u304D\u308B\u5834\u5408\u304C\u3042\u308A\u307E\u3059\u3002\u672A\u8A08\u6E2C\u306E\u56DE\u8EE2\u306F\u4F5C\u6210\u3057\u307E\u305B\u3093\u3002" })
    ] }) }) });
  }
  return /* @__PURE__ */ jsxs("section", { className: "spin-embed", style: { "--pitch-color": displayProfile.color, "--navy": "#0b1f42" }, children: [
    /* @__PURE__ */ jsxs("header", { className: "spin-embed-heading", children: [
      /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("span", { children: "TRACKMAN SPIN LAB" }),
        /* @__PURE__ */ jsxs("h2", { children: [
          playerName,
          "\uFF5C\u56DE\u8EE2\u30A2\u30CB\u30E1\u30FC\u30B7\u30E7\u30F3"
        ] }),
        /* @__PURE__ */ jsxs("p", { children: [
          "\u73FE\u5728\u306E\u5206\u6790\u6761\u4EF6\u306B\u4E00\u81F4\u3057\u305F\u56DE\u8EE2\u8A08\u6E2C ",
          playerPitches.length,
          " \u7403"
        ] })
      ] }),
      /* @__PURE__ */ jsx("b", { children: "\u6295\u624B\u5F8C\u65B9\u8996\u70B9" })
    ] }),
    /* @__PURE__ */ jsx("nav", { className: "pitch-tabs", "aria-label": "\u56DE\u8EE2\u3092\u8868\u793A\u3059\u308B\u7403\u7A2E", children: pitchProfiles.map((item) => /* @__PURE__ */ jsxs("button", { type: "button", className: item.id === profile.id ? "active" : "", onClick: () => {
      setSelectedId(item.id);
      setPitchIndex(0);
    }, children: [
      /* @__PURE__ */ jsx("span", { className: "pitch-code", style: { backgroundColor: item.color }, children: item.short }),
      /* @__PURE__ */ jsx("span", { className: "pitch-name", children: item.label }),
      /* @__PURE__ */ jsxs("span", { className: "pitch-count", children: [
        "n=",
        item.count
      ] })
    ] }, item.id)) }),
    /* @__PURE__ */ jsxs("div", { className: "dashboard-grid", children: [
      /* @__PURE__ */ jsxs("article", { className: "visual-card", children: [
        /* @__PURE__ */ jsxs("div", { className: "card-topline", children: [
          /* @__PURE__ */ jsxs("div", { className: "visual-title", children: [
            /* @__PURE__ */ jsx("span", { className: "live-dot" }),
            /* @__PURE__ */ jsx("span", { children: mode === "average" ? "AVERAGE SPIN VISUAL" : "SINGLE PITCH VISUAL" }),
            mode === "pitch" && pitch && /* @__PURE__ */ jsxs("div", { className: "inline-pitch-nav", children: [
              /* @__PURE__ */ jsx("button", { type: "button", "aria-label": "\u524D\u306E\u6295\u7403", onClick: () => setPitchIndex((value) => Math.max(0, value - 1)), disabled: pitchIndex === 0, children: "\u2039" }),
              /* @__PURE__ */ jsxs("span", { children: [
                pitchIndex + 1,
                " / ",
                pitchRows.length
              ] }),
              /* @__PURE__ */ jsx("input", { "aria-label": "\u6295\u7403\u3092\u9078\u629E", type: "range", min: "0", max: Math.max(pitchRows.length - 1, 0), value: pitchIndex, onChange: (event) => setPitchIndex(Number(event.target.value)) }),
              /* @__PURE__ */ jsx("button", { type: "button", "aria-label": "\u6B21\u306E\u6295\u7403", onClick: () => setPitchIndex((value) => Math.min(pitchRows.length - 1, value + 1)), disabled: pitchIndex >= pitchRows.length - 1, children: "\u203A" })
            ] })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "mode-switch", "aria-label": "\u8868\u793A\u5358\u4F4D", children: [
            /* @__PURE__ */ jsx("button", { type: "button", className: mode === "average" ? "active" : "", onClick: () => setMode("average"), children: "\u7403\u7A2E\u5E73\u5747" }),
            /* @__PURE__ */ jsx("button", { type: "button", className: mode === "pitch" ? "active" : "", onClick: () => setMode("pitch"), children: "1\u7403\u305A\u3064" })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "visual-stage", children: [
          /* @__PURE__ */ jsx(SpinScene, { profile: displayProfile, speed, paused }),
          /* @__PURE__ */ jsxs("div", { className: "orientation", children: [
            /* @__PURE__ */ jsx("span", { className: "orientation-n", children: "12" }),
            /* @__PURE__ */ jsx("span", { className: "orientation-e", children: "3" }),
            /* @__PURE__ */ jsx("span", { className: "orientation-s", children: "6" }),
            /* @__PURE__ */ jsx("span", { className: "orientation-w", children: "9" }),
            /* @__PURE__ */ jsx("div", { className: "orientation-ring" })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "axis-guide", "aria-label": "\u56DE\u8EE2\u8EF8\u7AEF\u306E\u898B\u65B9", children: [
            /* @__PURE__ */ jsx("strong", { children: "3D SPIN AXIS" }),
            /* @__PURE__ */ jsxs("span", { children: [
              /* @__PURE__ */ jsx("i", { className: "axis-front-marker" }),
              "\u624B\u524D\u5074"
            ] }),
            /* @__PURE__ */ jsxs("span", { children: [
              /* @__PURE__ */ jsx("i", { className: "axis-back-marker" }),
              "\u5965\u5074"
            ] })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "axis-readout", children: [
            /* @__PURE__ */ jsx("small", { children: "\u56DE\u8EE2\u65B9\u5411\uFF08\u30AF\u30ED\u30C3\u30AF\uFF09" }),
            /* @__PURE__ */ jsx("strong", { children: clockFromAxis(catcherSpinAxis(displayProfile.spinAxis)) }),
            /* @__PURE__ */ jsxs("span", { children: [
              "Spin Axis ",
              displayProfile.spinAxis.toFixed(1),
              "\xB0 \xB7 ",
              displayProfile.estimateCount ? `Gyro ${displayProfile.gyroAngle.toFixed(1)}\xB0\uFF08\u63A8\u5B9A\uFF09` : "\u50BE\u304D\u63A8\u5B9A\u4E0D\u53EF\u30FB\u5E73\u9762\u8868\u793A"
            ] }),
            /* @__PURE__ */ jsx("em", { children: "\u6355\u624B\u8996\u70B9" })
          ] }),
          /* @__PURE__ */ jsx("div", { className: `pitch-data-charts ${mode === "average" ? "average-only" : ""}`, children: mode === "pitch" && pitch ? /* @__PURE__ */ jsxs(Fragment, { children: [
            /* @__PURE__ */ jsx(PitchLocationChart, { pitch, color: displayProfile.color }),
            /* @__PURE__ */ jsx(MovementCrossChart, { pitch, color: displayProfile.color })
          ] }) : /* @__PURE__ */ jsx(MovementCrossChart, { pitch: displayProfile, color: displayProfile.color, average: true }) })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "playback-bar", children: [
          /* @__PURE__ */ jsx("button", { type: "button", className: "play-button", onClick: () => setPaused((value) => !value), "aria-label": paused ? "\u518D\u751F" : "\u4E00\u6642\u505C\u6B62", children: paused ? "\u25B6" : "\u2161" }),
          /* @__PURE__ */ jsxs("div", { className: "speed-control", children: [
            /* @__PURE__ */ jsx("span", { children: "\u8868\u793A\u901F\u5EA6" }),
            /* @__PURE__ */ jsx("div", { children: speedOptions.map((option) => /* @__PURE__ */ jsx("button", { type: "button", className: speed === option.value ? "active" : "", onClick: () => setSpeed(option.value), children: option.label }, option.value)) })
          ] }),
          /* @__PURE__ */ jsxs("p", { children: [
            /* @__PURE__ */ jsx("span", { className: "axis-key" }),
            " \u767D\u7E01\u30E9\u30A4\u30F3\uFF1D\u63A8\u5B9A\u56DE\u8EE2\u8EF8 ",
            /* @__PURE__ */ jsx("span", { className: "arrow-key" }),
            " \u56DE\u8EE2\u65B9\u5411"
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsxs("aside", { className: "metrics-panel", children: [
        /* @__PURE__ */ jsxs("div", { className: "primary-metrics", children: [
          /* @__PURE__ */ jsxs("div", { className: "metric-card", children: [
            /* @__PURE__ */ jsx("span", { children: mode === "average" ? "\u5E73\u5747\u7403\u901F" : "\u7403\u901F" }),
            /* @__PURE__ */ jsx("strong", { children: displayProfile.velocity.toFixed(1) }),
            /* @__PURE__ */ jsx("small", { children: "km/h" })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "metric-card", children: [
            /* @__PURE__ */ jsx("span", { children: mode === "average" ? "\u5E73\u5747\u56DE\u8EE2\u6570" : "\u56DE\u8EE2\u6570" }),
            /* @__PURE__ */ jsx("strong", { children: Math.round(displayProfile.spinRate).toLocaleString("ja-JP") }),
            /* @__PURE__ */ jsx("small", { children: "rpm" })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "spin3d-card", children: [
          /* @__PURE__ */ jsxs("div", { className: "section-label", children: [
            /* @__PURE__ */ jsx("span", { children: "INFERRED 3D SPIN" }),
            /* @__PURE__ */ jsx("small", { children: mode === "average" ? "\u7403\u7A2E\u4E2D\u592E\u5024" : "\u6295\u7403\u5225\u63A8\u5B9A" })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "spin3d-grid", children: [
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("span", { children: "Gyro Angle" }),
              /* @__PURE__ */ jsx("strong", { children: displayProfile.estimateCount ? `${displayProfile.gyroAngle.toFixed(1)}\xB0` : "\u2014" })
            ] }),
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("span", { children: "Spin Efficiency" }),
              /* @__PURE__ */ jsx("strong", { children: displayProfile.estimateCount ? `${displayProfile.spinEfficiency.toFixed(1)}%` : "\u2014" })
            ] }),
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("span", { children: "Active Spin" }),
              /* @__PURE__ */ jsx("strong", { children: displayProfile.estimateCount ? Math.round(displayProfile.activeSpin).toLocaleString("ja-JP") : "\u2014" }),
              /* @__PURE__ */ jsx("small", { children: "rpm" })
            ] })
          ] }),
          /* @__PURE__ */ jsx("p", { children: "0\xB0 = transverse \xB7 90\xB0 = pure gyro" })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "measured-card", children: [
          /* @__PURE__ */ jsxs("div", { className: "section-label", children: [
            /* @__PURE__ */ jsx("span", { children: "TRACKMAN MEASURED" }),
            /* @__PURE__ */ jsx("small", { children: "\u5B9F\u6E2C" })
          ] }),
          /* @__PURE__ */ jsxs("div", { children: [
            /* @__PURE__ */ jsxs("span", { children: [
              "Spin Axis",
              /* @__PURE__ */ jsxs("strong", { children: [
                displayProfile.spinAxis.toFixed(1),
                "\xB0"
              ] })
            ] }),
            /* @__PURE__ */ jsxs("span", { children: [
              "Measured Tilt",
              /* @__PURE__ */ jsx("strong", { children: displayProfile.measuredTilt })
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "movement-card", children: [
          /* @__PURE__ */ jsxs("div", { className: "section-label", children: [
            /* @__PURE__ */ jsx("span", { children: "MOVEMENT" }),
            /* @__PURE__ */ jsx("small", { children: mode === "average" ? "\u5E73\u5747\u5909\u5316\u91CF" : "\u6295\u7403\u5225\u5909\u5316\u91CF" })
          ] }),
          /* @__PURE__ */ jsxs("div", { className: "movement-grid", children: [
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("span", { children: "IVB" }),
              /* @__PURE__ */ jsx("strong", { children: signed(displayProfile.ivb) }),
              /* @__PURE__ */ jsx("small", { children: "cm" })
            ] }),
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("span", { children: "HB" }),
              /* @__PURE__ */ jsx("strong", { children: signed(displayProfile.hb) }),
              /* @__PURE__ */ jsx("small", { children: "cm" })
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "data-card", children: [
          /* @__PURE__ */ jsxs("div", { className: "section-label", children: [
            /* @__PURE__ */ jsx("span", { children: "DATA BASIS" }),
            /* @__PURE__ */ jsx("small", { children: "\u8868\u793A\u6839\u62E0" })
          ] }),
          /* @__PURE__ */ jsxs("dl", { children: [
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("dt", { children: "\u7403\u7A2E\u5206\u985E" }),
              /* @__PURE__ */ jsx("dd", { children: "\u5206\u6790\u753B\u9762\u3068\u540C\u3058\u7403\u7A2E" })
            ] }),
            mode === "average" ? /* @__PURE__ */ jsxs(Fragment, { children: [
              /* @__PURE__ */ jsxs("div", { children: [
                /* @__PURE__ */ jsx("dt", { children: "\u5BFE\u8C61\u7403\u6570" }),
                /* @__PURE__ */ jsxs("dd", { children: [
                  profile.count,
                  " \u7403"
                ] })
              ] }),
              /* @__PURE__ */ jsxs("div", { children: [
                /* @__PURE__ */ jsx("dt", { children: "\u6A19\u672C\u6570\u306E\u76EE\u5B89" }),
                /* @__PURE__ */ jsx("dd", { children: profile.confidence })
              ] }),
              /* @__PURE__ */ jsxs("div", { children: [
                /* @__PURE__ */ jsx("dt", { children: "\u56DE\u8EE2\u8EF8\u96C6\u8A08" }),
                /* @__PURE__ */ jsx("dd", { children: "\u5186\u5468\u5E73\u5747" })
              ] }),
              /* @__PURE__ */ jsxs("div", { children: [
                /* @__PURE__ */ jsx("dt", { children: "3D\u63A8\u5B9A\u5BFE\u8C61" }),
                /* @__PURE__ */ jsxs("dd", { children: [
                  profile.estimateCount,
                  "\u7403\u306E\u4E2D\u592E\u5024"
                ] })
              ] })
            ] }) : /* @__PURE__ */ jsxs(Fragment, { children: [
              /* @__PURE__ */ jsxs("div", { children: [
                /* @__PURE__ */ jsx("dt", { children: "\u5143\u5206\u985E" }),
                /* @__PURE__ */ jsx("dd", { children: pitch?.rawPitchType || "\u2014" })
              ] }),
              /* @__PURE__ */ jsxs("div", { children: [
                /* @__PURE__ */ jsx("dt", { children: "\u8A08\u6E2C\u65E5" }),
                /* @__PURE__ */ jsx("dd", { children: pitch?.date || "\u2014" })
              ] }),
              /* @__PURE__ */ jsxs("div", { children: [
                /* @__PURE__ */ jsx("dt", { children: "Pitch No." }),
                /* @__PURE__ */ jsx("dd", { children: pitch?.pitchNo ?? "\u2014" })
              ] }),
              /* @__PURE__ */ jsxs("div", { children: [
                /* @__PURE__ */ jsx("dt", { children: "3D\u63A8\u5B9A\u5024" }),
                /* @__PURE__ */ jsx("dd", { children: displayProfile.estimateCount ? "\u5F53\u8A72\u6295\u7403" : "\u30E2\u30C7\u30EB\u7BC4\u56F2\u5916\u30FB\u8A08\u7B97\u4E0D\u53EF" })
              ] })
            ] }),
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("dt", { children: "\u30DC\u30FC\u30EB\u30E2\u30C7\u30EB" }),
              /* @__PURE__ */ jsx("dd", { children: "108\u30C0\u30D6\u30EB\u30B9\u30C6\u30C3\u30C1" })
            ] }),
            /* @__PURE__ */ jsxs("div", { children: [
              /* @__PURE__ */ jsx("dt", { children: "\u7E2B\u3044\u76EE\u914D\u7F6E" }),
              /* @__PURE__ */ jsx("dd", { children: profile.seamPlacement === "four-seam" ? "4\u30B7\u30FC\u30E0\u57FA\u6E96" : "\u8868\u793A\u7528\u521D\u671F\u4F4D\u76F8" })
            ] })
          ] })
        ] }),
        season === "2026-fall" && /* @__PURE__ */ jsxs("details", { className: "chart-definition", children: [
          /* @__PURE__ */ jsx("summary", { children: "\u63A8\u5B9A\u65B9\u6CD5" }),
          /* @__PURE__ */ jsxs("p", { children: [
            "\u79CB\u306E\u63A8\u5B9A\u306F\u6A19\u6E96\u7A7A\u6C17\u5BC6\u5EA6\u3092\u4EEE\u5B9A\u3057\u305F",
            /* @__PURE__ */ jsx("a", { href: "https://baseball.physics.illinois.edu/trackman/SpinAxis.pdf", target: "_blank", rel: "noreferrer", children: "Nathan\u30E2\u30C7\u30EB" }),
            "\u3092\u4F7F\u7528\u3057\u307E\u3059\u3002\u5929\u5019\u3084\u7E2B\u3044\u76EE\u306B\u3088\u308B\u7A7A\u529B\u306E\u5F71\u97FF\u306F\u672A\u88DC\u6B63\u3067\u3001\u5B9F\u6E2C3D\u56DE\u8EE2\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002"
          ] })
        ] }),
        /* @__PURE__ */ jsxs("details", { className: "accuracy-note chart-definition", children: [
          /* @__PURE__ */ jsx("summary", { children: "\u8A08\u6E2C\u30FB\u63A8\u5B9A\u306E\u533A\u5206" }),
          /* @__PURE__ */ jsxs("p", { children: [
            /* @__PURE__ */ jsx("strong", { children: "\u8ECC\u9053\u30C7\u30FC\u30BF\u304B\u3089\u306E\u63A8\u5B9A" }),
            "Spin Rate\u30FBSpin Axis\u30FBMeasured Tilt\u30FBIVB\u30FBHB\u306FTrackMan\u5B9F\u6E2C\u5024\u3067\u3059\u3002Gyro Angle\u30FBSpin Efficiency\u30FBActive Spin\u306F\u8ECC\u9053\u304B\u3089\u306E\u53C2\u8003\u63A8\u5B9A\u3067\u3059\u3002\u63A8\u5B9A\u4E0D\u80FD\u306E\u7403\u306F\u6570\u5024\u3092\u88DC\u308F\u305A\u3001\u56DE\u8EE2\u8EF8\u306E\u50BE\u304D\u3092\u4ED8\u3051\u306A\u3044\u5E73\u9762\u30A2\u30CB\u30E1\u30FC\u30B7\u30E7\u30F3\u3067\u8868\u793A\u3057\u307E\u3059\u3002\u7E2B\u3044\u76EE\u306E\u914D\u7F6E\u3068\u8EF8\u306E\u524D\u5F8C\u65B9\u5411\u306F\u8868\u793A\u4E0A\u306E\u4EEE\u5B9A\u3067\u3059\u3002\u5E73\u5747\u8868\u793A\u306E\u5909\u5316\u91CF\u30C1\u30E3\u30FC\u30C8\u306F\u5E73\u5747IVB\u30FB\u5E73\u5747HB\u30011\u7403\u8868\u793A\u306F\u5F53\u8A72\u6295\u7403\u306E\u5024\u3067\u3059\u3002"
          ] })
        ] })
      ] })
    ] })
  ] });
}
export {
  MovementCrossChart,
  PitchLocationChart,
  SpinScene,
  buildPitchProfiles,
  clockFromAxis,
  PitchSpinProfile as default,
  startSpinAnimation
};
