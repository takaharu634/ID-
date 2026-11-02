import { UMPIRE_ASSIGNMENTS, UMPIRE_MEMOS_WITHOUT_GAME_ID } from './umpire-assignments.mjs';

export const FRAMING_MODEL_VERSION = 'umpire-game-ridge-v1';
const finite = value => typeof value === 'number' && Number.isFinite(value);
const sigmoid = value => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))));
const round = (value, digits = 3) => finite(value) ? Number(value.toFixed(digits)) : null;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const dateKey = value => String(value ?? '').replace(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/, (_, y, m, d) => `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
const isTake = p => p.result === 'ボール' || p.result === '見逃しストライク';
const edge = p => [
  ['left', Math.abs(p.plateX + .254)], ['right', Math.abs(p.plateX - .254)],
  ['low', Math.abs(p.plateZ - .45)], ['high', Math.abs(p.plateZ - 1.05)],
].sort((a, b) => a[1] - b[1])[0][0];
const area = p => {
  const e = edge(p);
  return e === 'left' ? (p.batterSide === '右' ? 'outside' : 'inside')
    : e === 'right' ? (p.batterSide === '右' ? 'inside' : 'outside') : e;
};

// Reuse only verified memos. Unknown games are still separate game effects;
// neither rotation nor an opponent's umpire name is ever imputed.
export function framingUmpires(games) {
  const assignments = new Map();
  for (const [id, date, home, away, name] of UMPIRE_ASSIGNMENTS) {
    const matches = games.filter(g => g.id === id);
    if (matches.length === 1 && dateKey(matches[0].date) === date && matches[0].homeTeam === home && matches[0].awayTeam === away) assignments.set(id, name);
  }
  for (const [date, home, away, name] of UMPIRE_MEMOS_WITHOUT_GAME_ID) {
    const matches = games.filter(g => dateKey(g.date) === date && g.homeTeam === home && g.awayTeam === away);
    if (matches.length === 1 && (!assignments.has(matches[0].id) || assignments.get(matches[0].id) === name)) assignments.set(matches[0].id, name);
  }
  return assignments;
}

// Penalized logistic regression, fitted jointly rather than subtracting each
// game's observed mean (which would also remove the catchers' performances).
// Spatial surfaces are bilinear, stratified by batter hand. Umpire and game
// effects vary by edge/hand; sparse groups shrink toward the league surface.
export function fitFramingModel(data, assignments = framingUmpires(data.games ?? [])) {
  const seen = new Set();
  const takes = (data.pitches ?? []).filter(p => {
    if (!p.id || seen.has(p.id) || !p.gameId || !p.catcherId || !isTake(p)
      || !finite(p.plateX) || !finite(p.plateZ) || !['右', '左'].includes(p.batterSide)
      || !Number.isInteger(p.balls) || p.balls < 0 || p.balls > 3
      || !Number.isInteger(p.strikes) || p.strikes < 0 || p.strikes > 2) return false;
    seen.add(p.id); return true;
  });
  const columns = [], columnIds = new Map(), samples = [];
  function add(sample, name, value, penalty, kind = 'context') {
    if (!value) return;
    if (!columnIds.has(name)) { columnIds.set(name, columns.length); columns.push({ name, penalty, kind, beta: 0, entries: [] }); }
    const column = columns[columnIds.get(name)];
    column.entries.push([samples.length, value]); sample.features.push([column, value]);
  }
  for (const p of takes) {
    const margin = Math.min(p.plateX + .254, .254 - p.plateX, p.plateZ - .45, 1.05 - p.plateZ);
    const sample = { p, actual: p.result === '見逃しストライク' ? 1 : 0, eta: clamp(24 * margin, -15, 8), features: [] };
    add(sample, 'intercept', 1, .001);
    const x = clamp((p.plateX + .6) / .15, 0, 8), z = clamp((p.plateZ - .15) / .15, 0, 8);
    const xi = Math.min(7, Math.floor(x)), zi = Math.min(7, Math.floor(z)), tx = x - xi, tz = z - zi;
    for (const [dx, wx] of [[0, 1 - tx], [1, tx]]) for (const [dz, wz] of [[0, 1 - tz], [1, tz]]) {
      add(sample, `location:${p.batterSide}:${xi + dx}:${zi + dz}`, wx * wz, 1);
    }
    add(sample, `count:${p.balls}:${p.strikes}`, 1, 8);
    add(sample, `type:${p.pitchType || '不明'}:${p.pitcherThrows || '不明'}`, 1, 8);
    if (finite(p.velocity)) add(sample, 'velocity', clamp((p.velocity - 135) / 10, -4, 4), 8);
    if (p.pitcherId) add(sample, `pitcher:${p.pitcherId}`, 1, 16);
    const e = edge(p), name = assignments.get(p.gameId);
    add(sample, `catcher:${p.catcherId}`, 1, 4, 'catcher');
    add(sample, `catcher-edge:${p.catcherId}:${e}`, 1, 12, 'catcher');
    if (name) {
      add(sample, `umpire:${name}`, 1, 8, 'umpire');
      add(sample, `umpire-edge:${name}:${p.batterSide}:${e}`, 1, 20, 'umpire');
    }
    add(sample, `game:${p.gameId}`, 1, 12, 'game');
    add(sample, `game-edge:${p.gameId}:${p.batterSide}:${e}`, 1, 30, 'game');
    samples.push(sample);
  }
  // Each complete categorical block sums to one for every pitch. Center its
  // coefficients into the intercept without changing any predicted logit. This
  // removes redundant intercept directions and speeds joint optimization.
  const groups = new Map();
  for (const column of columns) {
    const key = column.name.split(':')[0];
    if (key === 'intercept' || key === 'velocity') continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(column);
  }
  const centered = [...groups.values()].filter(group => {
    const coverage = new Float64Array(samples.length);
    for (const column of group) for (const [i, value] of column.entries) coverage[i] += value;
    return coverage.every(value => Math.abs(value - 1) < 1e-10);
  });
  let iterations = 0, converged = false, previousLoss = Infinity, relativeImprovement = Infinity;
  for (; iterations < 400; iterations++) {
    let largest = 0;
    for (const column of columns) {
      let gradient = -column.penalty * column.beta, curvature = column.penalty;
      for (const [i, value] of column.entries) {
        const probability = sigmoid(samples[i].eta);
        gradient += value * (samples[i].actual - probability);
        curvature += value * value * probability * (1 - probability);
      }
      const step = clamp(gradient / curvature, -.75, .75);
      column.beta += step;
      for (const [i, value] of column.entries) samples[i].eta += value * step;
      largest = Math.max(largest, Math.abs(step));
    }
    for (const group of centered) {
      const mean = group.reduce((sum, c) => sum + c.beta, 0) / group.length;
      for (const column of group) column.beta -= mean;
      columns[0].beta += mean;
    }
    const loss = samples.reduce((sum, s) => sum + Math.max(s.eta, 0) - s.actual * s.eta + Math.log1p(Math.exp(-Math.abs(s.eta))), 0)
      + columns.reduce((sum, c) => sum + .5 * c.penalty * c.beta * c.beta, 0);
    relativeImprovement = (previousLoss - loss) / Math.max(1, Math.abs(previousLoss));
    if (largest < 1e-5 || (iterations > 5 && relativeImprovement >= 0 && relativeImprovement < 1e-8)) {
      converged = true; iterations++; break;
    }
    previousLoss = loss;
  }
  const effects = sample => {
    const result = { catcher: 0, umpire: 0, game: 0 };
    for (const [column, value] of sample.features) if (column.kind in result) result[column.kind] += column.beta * value;
    return result;
  };
  const meanCatcher = samples.length ? samples.reduce((sum, s) => sum + effects(s).catcher, 0) / samples.length : 0;
  const predictions = samples.map(sample => {
    const effect = effects(sample), eta = sample.eta - effect.catcher + meanCatcher;
    return { pitch: sample.p, actual: sample.actual, expected: sigmoid(eta),
      leagueExpected: sigmoid(eta - effect.umpire - effect.game),
      umpire: assignments.get(sample.p.gameId) ?? '', shadow: false };
  });
  // One common boundary definition, independent of the assigned umpire. Thus
  // changing a game's calls does not move a catcher's opportunities in/out of
  // the denominator merely because its umpire has a wide zone.
  for (const prediction of predictions) prediction.shadow = prediction.leagueExpected >= .1 && prediction.leagueExpected <= .9;
  return { predictions, diagnostics: { iterations, converged, relativeImprovement: finite(relativeImprovement) ? relativeImprovement : null, takes: takes.length, parameters: columns.length } };
}

const aggregate = () => ({ n: 0, actual: 0, expected: 0 });
const addResult = (a, p) => { a.n++; a.actual += p.actual; a.expected += p.expected; };
const finish = a => ({ pitches: a.n, actualStrikeRate: a.n ? round(a.actual / a.n) : null,
  expectedStrikeRate: a.n ? round(a.expected / a.n) : null, extraStrikes: a.n ? round(a.actual - a.expected, 1) : null,
  extraStrikeRate: a.n ? round((a.actual - a.expected) / a.n) : null });
const repaired = new WeakMap();

/** Pure/idempotent migration used by CSV import, published data and offline reads.
 * @template T
 * @param {T} data
 * @returns {T}
 */
export function applyFramingAdjustment(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.pitches) || !Array.isArray(data.catchers) || !data.catchers.length || !Array.isArray(data.games)
    || data.metadata?.framing?.version === FRAMING_MODEL_VERSION) return data;
  if (repaired.has(data)) return repaired.get(data);
  const assignments = framingUmpires(data.games), model = fitFramingModel(data, assignments), byCatcher = new Map();
  for (const p of model.predictions) {
    const id = p.pitch.catcherId;
    if (!byCatcher.has(id)) byCatcher.set(id, { total: aggregate(), called: 0, registered: 0, games: new Set(),
      areas: Object.fromEntries(['low', 'high', 'inside', 'outside'].map(key => [key, aggregate()])),
      maps: { '右': Array.from({ length: 25 }, aggregate), '左': Array.from({ length: 25 }, aggregate) } });
    const row = byCatcher.get(id); row.called++;
    if (!p.shadow) continue;
    addResult(row.total, p); row.games.add(p.pitch.gameId); if (p.umpire) row.registered++;
    addResult(row.areas[area(p.pitch)], p);
    const { plateX: x, plateZ: z, batterSide: side } = p.pitch;
    if (x >= -.45 && x <= .45 && z >= .25 && z <= 1.25) {
      const col = clamp(Math.floor((x + .45) / .9 * 5), 0, 4);
      const gridRow = clamp(4 - Math.floor((z - .25) * 5), 0, 4);
      addResult(row.maps[side][gridRow * 5 + col], p);
    }
  }
  const catchers = data.catchers.map(c => {
    const a = byCatcher.get(c.id), total = a?.total ?? aggregate(), stats = finish(total);
    const areas = Object.fromEntries(['low', 'high', 'inside', 'outside'].map(key => [key, finish(a?.areas[key] ?? aggregate())]));
    return { ...c, calledPitches: a?.called ?? 0, shadowPitches: total.n, actualStrikeRate: stats.actualStrikeRate,
      expectedStrikeRate: stats.expectedStrikeRate, extraStrikes: stats.extraStrikes, extraStrikeRate: stats.extraStrikeRate,
      framingRuns: total.n ? round((total.actual - total.expected) * .125, 1) : null,
      framingPer1000: total.n ? round((total.actual - total.expected) * 1000 / total.n, 1) : null,
      framingModel: FRAMING_MODEL_VERSION, framingGames: a?.games.size ?? 0, umpireAdjustedPitches: a?.registered ?? 0,
      gameOnlyAdjustedPitches: total.n - (a?.registered ?? 0), framingAreas: areas,
      lowExtraStrikes: areas.low.extraStrikes, highExtraStrikes: areas.high.extraStrikes,
      insideExtraStrikes: areas.inside.extraStrikes, outsideExtraStrikes: areas.outside.extraStrikes,
      framingHeatmaps: Object.fromEntries(['右', '左'].map(side => [side, (a?.maps[side] ?? Array.from({ length: 25 }, aggregate)).map(finish)])) };
  });
  for (const key of ['extraStrikes', 'framingRuns', 'framingPer1000']) {
    const pool = catchers.filter(c => c.shadowPitches >= 100 && finite(c[key])).map(c => c[key]).sort((a, b) => a - b);
    for (const c of catchers) {
      const less = pool.filter(v => v < c[key]).length, equal = pool.filter(v => v === c[key]).length;
      c.percentiles = { ...c.percentiles, [key]: pool.length && c.shadowPitches >= 100 && finite(c[key])
        ? clamp(Math.round(100 * (less + equal / 2) / pool.length), 1, 99) : null };
    }
  }
  const catcherMap = new Map(catchers.map(c => [c.id, c]));
  const output = { ...data, catchers, players: (data.players ?? []).map(p => catcherMap.has(p.id) ? { ...p, catching: catcherMap.get(p.id) } : p),
    metadata: { ...data.metadata, framing: { version: FRAMING_MODEL_VERSION, ...model.diagnostics,
      registeredUmpireGames: assignments.size, totalGames: data.games.length,
      method: '投球位置・打者左右・カウント・球種・球速・投手・捕手・球審・試合を同時推定する正則化ロジスティックモデル。球審と試合は左右打者・ゾーン端ごとの差を補正。球審未登録は試合差のみ補正。' } } };
  repaired.set(data, output); return output;
}
