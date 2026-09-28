/** Shared by CSV ingestion, stored snapshots and browser/static data readers. */
export const PITCH_QUALITY_VERSION = 'tohto-pitch-score-v3';
const keys = ['stuffPlus', 'locationPlus', 'pitchingPlus'];
const features = ['velocity', 'spin', 'extension', 'ivb', 'hb', 'vaa'];
const round = (v, digits = 1) => Math.round(v * 10 ** digits) / 10 ** digits;
const finite = v => typeof v === 'number' && Number.isFinite(v);
const average = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const weighted = (rows, key) => {
  const valid = rows.filter(r => finite(r[key]) && r.n > 0);
  const n = valid.reduce((sum, r) => sum + r.n, 0);
  return n ? valid.reduce((sum, r) => sum + r[key] * r.n, 0) / n : null;
};
function standardizer(rows, key) {
  const mean = weighted(rows, key);
  const variance = weighted(rows.map(r => ({ n: r.n, value: (r[key] - mean) ** 2 })), 'value');
  const sd = Math.sqrt(variance ?? 0);
  return value => finite(value) && mean !== null ? (sd > 1e-9 ? (value - mean) / sd : 0) : null;
}
export function pitchScore(z, n, prior = 20) {
  return finite(z) && n > 0 ? round(Math.max(0, 50 + 20 * z * n / (n + prior))) : null;
}
function location(p) {
  const x = p.plateX, z = p.plateZ;
  if (!finite(x) || !finite(z)) return null;
  const inside = x >= -.254 && x <= .254 && z >= .45 && z <= 1.05;
  const edge = Math.min(Math.abs(x + .254), Math.abs(x - .254), Math.abs(z - .45), Math.abs(z - 1.05));
  const outside = Math.hypot(Math.max(-.254 - x, 0, x - .254), Math.max(.45 - z, 0, z - 1.05));
  let score = Math.abs(x) <= .085 && z >= .65 && z <= .85 ? -.34 : inside && edge <= .075 ? .25 : inside ? .05 : outside <= .12 ? .18 : outside <= .25 ? -.03 : -.32;
  if (['見逃しストライク', '空振り'].includes(p.result)) score += .04;
  if (['ボール', 'ワンバウンド'].includes(p.result)) score -= .03;
  return score;
}
const keyOf = (id, type) => JSON.stringify([id, type]);
const emptyScore = (n = 0) => ({ stuffPlus: null, locationPlus: null, pitchingPlus: null, qualitySample: n, qualityConfidence: '対象不足', qualityShrinkage: 0 });
const top = (rows, key) => rows.filter(r => finite(r[key])).sort((a, b) => b[key] - a[key])[0] ?? null;

/** Does not mutate source data or unrelated result/expected-value metrics.
 * @template T
 * @param {T} dataset
 * @returns {T}
 */
export function applyPitchQuality(dataset) {
  if (!dataset?.metadata || !Array.isArray(dataset.pitches) || !Array.isArray(dataset.pitchTypes) || !Array.isArray(dataset.pitchers) || dataset.metadata.pitchQuality?.version === PITCH_QUALITY_VERSION) return dataset;
  const groups = new Map();
  for (const p of dataset.pitches) {
    const k = keyOf(p.pitcherId, p.pitchType);
    if (!groups.has(k)) groups.set(k, []);
    // A common measured sample keeps the two components comparable.
    if (features.every(f => finite(p[f])) && location(p) !== null) groups.get(k).push(p);
  }
  const rows = dataset.pitchTypes.map(source => {
    const measured = groups.get(keyOf(source.pitcherId, source.pitchType)) ?? [];
    return { source, n: measured.length, ...Object.fromEntries(features.map(f => [f, average(measured.map(p => p[f]))])), loc: average(measured.map(location)) };
  });
  const byType = new Map();
  for (const row of rows) {
    if (!byType.has(row.source.pitchType)) byType.set(row.source.pitchType, []);
    byType.get(row.source.pitchType).push(row);
  }
  for (const [type, group] of byType) {
    let baseline = group.filter(r => r.n >= 25);
    if (baseline.length < 3) baseline = group.filter(r => r.n >= 10);
    if (baseline.length < 3 || type === '不明') continue;
    const z = Object.fromEntries(features.map(f => [f, standardizer(baseline, f)]));
    for (const r of group) r.movement = Math.hypot(z.ivb(r.ivb) ?? 0, z.hb(r.hb) ?? 0);
    const movement = standardizer(baseline, 'movement');
    for (const r of group) {
      if (r.n < 10) continue;
      const vaaDirection = ['ストレート', 'シンカー', 'ツーシーム', 'カットボール'].includes(type) ? 1 : -.35;
      r.factors = [
        ['velocity', '球速', z.velocity(r.velocity), .45], ['spin', '回転数', z.spin(r.spin), .15],
        ['extension', 'エクステンション', z.extension(r.extension), .15], ['movement', '変化の独自性', movement(r.movement), .15],
        ['vaa', '進入角', z.vaa(r.vaa) * vaaDirection, .1],
      ].map(([key, label, value, weight]) => ({ key, label, z: value, contribution: value * weight }));
      r.rawStuff = r.factors.reduce((sum, f) => sum + f.contribution, 0);
    }
    const stuff = standardizer(baseline, 'rawStuff'), loc = standardizer(baseline, 'loc');
    for (const r of group.filter(r => r.n >= 10)) { r.u = stuff(r.rawStuff); r.v = loc(r.loc); r.composite = (r.u + r.v) / 2; }
    const combined = standardizer(baseline, 'composite');
    for (const r of group.filter(r => r.n >= 10)) {
      const ordered = [...r.factors].sort((a, b) => b.contribution - a.contribution);
      r.score = {
        stuffPlus: pitchScore(r.u, r.n), locationPlus: pitchScore(r.v, r.n), pitchingPlus: pitchScore(combined(r.composite), r.n),
        qualitySample: r.n, qualityReferenceCount: baseline.length,
        qualityConfidence: r.n < 25 ? '参考' : r.n >= 50 && baseline.length >= 5 ? '高' : '中', qualityShrinkage: round(r.n / (r.n + 20), 3),
        qualityStrength: ordered[0].label, qualityRisk: ordered.at(-1).label,
        qualityFactors: r.factors.map(f => ({ ...f, z: round(f.z, 2), contribution: round(f.contribution, 3) })),
      };
    }
  }
  const pitchTypes = rows.map(r => ({ ...r.source, qualityFactors: [], qualityStrength: '—', qualityRisk: '—', ...emptyScore(r.n), ...r.score }));
  const typesByPitcher = new Map();
  for (const row of rows) if (row.score) {
    const group = typesByPitcher.get(row.source.pitcherId) ?? [];
    group.push(row); typesByPitcher.set(row.source.pitcherId, group);
  }
  const totals = dataset.pitchers.map(source => {
    const types = typesByPitcher.get(source.id) ?? [];
    const n = types.reduce((sum, r) => sum + r.n, 0);
    return { source, n, coverage: n / Math.max(1, source.pitches), u: weighted(types, 'u'), v: weighted(types, 'v') };
  });
  const eligible = totals.filter(r => r.n >= 25 && r.coverage >= .8);
  const baseline = eligible.filter(r => r.n >= 100);
  if (baseline.length >= 3) {
    const stuff = standardizer(baseline, 'u'), loc = standardizer(baseline, 'v');
    for (const r of eligible) { r.s = stuff(r.u); r.l = loc(r.v); r.composite = (r.s + r.l) / 2; }
    const combined = standardizer(baseline, 'composite');
    for (const r of eligible) r.score = {
      stuffPlus: pitchScore(r.s, r.n, 50), locationPlus: pitchScore(r.l, r.n, 50), pitchingPlus: pitchScore(combined(r.composite), r.n, 50),
      qualitySample: r.n, qualityReferenceCount: baseline.length, qualityConfidence: r.n >= 100 && baseline.length >= 5 ? '高' : r.n >= 50 ? '中' : '参考', qualityShrinkage: round(r.n / (r.n + 50), 3),
    };
  }
  let pitchers = totals.map(r => ({ ...r.source, ...emptyScore(r.n), qualityCoverage: round(r.coverage, 3), ...r.score }));
  const qualified = pitchers.filter(r => r.pitches >= 100 && finite(r.pitchingPlus));
  const percentilePools = Object.fromEntries(keys.map(key => [key, qualified.map(p => p[key]).filter(finite).sort((a, b) => a - b)]));
  const bound = (values, value, upper) => {
    let lo = 0, hi = values.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (values[mid] < value || upper && values[mid] === value) lo = mid + 1; else hi = mid; }
    return lo;
  };
  pitchers = pitchers.map(r => ({ ...r, percentiles: { ...r.percentiles, ...Object.fromEntries(keys.map(key => {
    const values = percentilePools[key];
    const less = bound(values, r[key], false), equal = bound(values, r[key], true) - less;
    return [key, finite(r[key]) && values.length ? Math.max(1, Math.min(99, Math.round(100 * (less + equal / 2) / values.length))) : null];
  })) } }));
  const byId = new Map(pitchers.map(r => [r.id, r]));
  return {
    ...dataset,
    metadata: { ...dataset.metadata, model: '東都PITCHスコア v3', pitchQuality: { version: PITCH_QUALITY_VERSION, center: 50, spread: 20, minimum: 0, maximum: null, pitchTypePrior: 20, pitcherPrior: 50, reference: '同シーズン・球種別25球以上（3人未満は10球以上）、投手総合100球以上。各基準3人以上。総合は評価可能球80%以上。' } },
    pitchTypes, pitchers,
    players: dataset.players?.map(p => p.pitching && byId.has(p.id) ? { ...p, pitching: byId.get(p.id) } : p),
    teams: dataset.teams?.map(t => ({ ...t, pitchingPlus: (() => { const value = weighted(pitchers.filter(p => p.team === t.name).map(p => ({ ...p, n: p.qualitySample })), 'pitchingPlus'); return value === null ? null : round(value); })() })),
    highlights: { ...dataset.highlights, pitchingPlus: top(qualified, 'pitchingPlus'), command: top(qualified, 'locationPlus'), stuffPitch: top(pitchTypes.filter(r => r.pitches >= 25), 'stuffPlus') },
  };
}
