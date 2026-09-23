import { PLAYER_MASTER } from "./player-master.js";
import { applyOfficialBatting2026Spring } from "./official-batting-2026-spring.js";
import { annotateRunnerStates } from "./runner-state.js";

const TEAM_NAMES = {
  CHU_UNI: "中央大学",
  TOY_UNI: "東洋大学",
  AOY_UNI: "青山学院大学",
  KOK_UNI: "國學院大學",
  ASI_UNI: "亜細亜大学",
  TAI_UNI: "立正大学",
  RIS_UNI: "立正大学",
  KOM_UNI: "駒澤大学",
};

const PITCH_NAMES = {
  Fastball: "ストレート",
  "Four-Seam": "ストレート",
  Slider: "スライダー",
  ChangeUp: "チェンジアップ",
  Changeup: "チェンジアップ",
  Curveball: "カーブ",
  Splitter: "フォーク",
  Cutter: "カットボール",
  Sinker: "シンカー",
  TwoSeamFastBall: "ツーシーム",
  TwoSeamFastball: "ツーシーム",
  "Two-Seam": "ツーシーム",
  Knuckleball: "ナックル",
  Other: "その他",
};

const RESULT_NAMES = {
  BallCalled: "ボール",
  BallinDirt: "ワンバウンド",
  BallIntentional: "敬遠",
  StrikeCalled: "見逃しストライク",
  StrikeSwinging: "空振り",
  FoulBallNotFieldable: "ファウル",
  foulBallNotFieldable: "ファウル",
  FoulBallFieldable: "ファウルフライ",
  InPlay: "インプレー",
  HitByPitch: "死球",
  Undefined: "不明",
};

const PLAY_NAMES = {
  Single: "単打",
  Double: "二塁打",
  Triple: "三塁打",
  HomeRun: "本塁打",
  Out: "アウト",
  Error: "失策",
  Sacrifice: "犠打・犠飛",
  FieldersChoice: "野選",
  Filderschoice: "野選",
  StolenBase: "盗塁",
  CaughtStealing: "盗塁死",
  Undefined: "",
};

// TrackMan exports occasionally change an ID or spelling for the same player.
// Keep these corrections team-scoped because numeric IDs are not globally unique
// in the supplied files (for example, one ID is shared by players at two schools).
const PERSON_ALIASES = {
  "中央大学|1000544953": { id: "1000544953", name: "Ito, Kaito" },
  "國學院大學|1000545046": { id: "1000545046", name: "Ishino, Renju" },
  "立正大学|1000413382": { id: "1000413382", name: "Hosokubo, Yura" },
  "青山学院大学|1000544869": { id: "1000419780", name: "Ohga, Hiroo" },
  "青山学院大学|1000419780": { id: "1000419780", name: "Ohga, Hiroo" },
  "亜細亜大学|1000274586": { id: "1000274587", name: "Maejima, Ran" },
  "亜細亜大学|1000274587": { id: "1000274587", name: "Maejima, Ran" },
  "立正大学|1000545115": { id: "1000545116", name: "Nishimura, Genki" },
  "立正大学|1000545116": { id: "1000545116", name: "Nishimura, Genki" },
  "亜細亜大学|1000544933": { id: "1000544934", name: "Watanabe, Kei" },
  "亜細亜大学|1000544934": { id: "1000544934", name: "Watanabe, Kei" },
};

const PERSON_NAME_ALIASES = {
  "中央大学|ito, kanta": { id: "1000544953", name: "Ito, Kaito" },
  "中央大学|ito, kaita": { id: "1000544953", name: "Ito, Kaito" },
  "國學院大學|ishii, renju": { id: "1000545046", name: "Ishino, Renju" },
  "國學院大學|ishino, renju": { id: "1000545046", name: "Ishino, Renju" },
  "立正大学|hosokubo, yura": { id: "1000413382", name: "Hosokubo, Yura" },
  "青山学院大学|ohga, hiroh": { id: "1000419780", name: "Ohga, Hiroo" },
  "青山学院大学|ohga, hiroo": { id: "1000419780", name: "Ohga, Hiroo" },
  "亜細亜大学|maejima, ran": { id: "1000274587", name: "Maejima, Ran" },
  "立正大学|nishimura, genki": { id: "1000545116", name: "Nishimura, Genki" },
  "亜細亜大学|watanabe, kei": { id: "1000544934", name: "Watanabe, Kei" },
  "立正大学|miyakawa, shiki": { id: "1000544944", name: "Miyakawa, Shiki" },
};

const SELECTED_COLUMNS = [
  "SourceFile", "PitchNo", "Date", "Time", "PAofInning", "PitchofPA",
  "Pitcher", "PitcherId", "PitcherThrows", "PitcherTeam", "Batter",
  "BatterId", "BatterSide", "BatterTeam", "Inning", "Top/Bottom", "Outs",
  "Balls", "Strikes", "TaggedPitchType", "AutoPitchType", "PitchCall",
  "KorBB", "TaggedHitType", "PlayResult", "OutsOnPlay", "RunsScored",
  "RelSpeed", "VertRelAngle", "HorzRelAngle", "SpinRate", "SpinAxis", "Tilt",
  "RelHeight", "RelSide", "Extension", "InducedVertBreak", "HorzBreak",
  "PlateLocHeight", "PlateLocSide", "ZoneSpeed", "VertApprAngle",
  "HorzApprAngle", "ExitSpeed", "Angle", "Direction", "Bearing", "Distance", "HomeTeam",
  "AwayTeam", "GameID", "PitchUID", "GameUID", "Catcher", "CatcherId",
  "CatcherTeam", "PopTime", "BasePositionX", "CatcherThrowCatchConfidence",
  "CatcherThrowReleaseConfidence",
];

const ZONE = { left: -0.254, right: 0.254, bottom: 0.45, top: 1.05 };
const HARD_HIT_KMH = 152.9;

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeIdentity(value) {
  return clean(value).normalize("NFKC").toLowerCase()
    .replace(/[\s,，.．・'’\-ー_]/g, "");
}

const PLAYER_MASTER_BY_ALIAS = new Map();
const PLAYER_MASTER_BY_CANONICAL = new Map();
for (const player of PLAYER_MASTER) {
  const canonicalKey = `${player.team}|${normalizeIdentity(player.roman)}`;
  PLAYER_MASTER_BY_CANONICAL.set(canonicalKey, player);
  for (const alias of [player.roman, ...(player.aliases ?? [])]) {
    PLAYER_MASTER_BY_ALIAS.set(`${player.team}|${normalizeIdentity(alias)}`, player);
  }
}

function playerMasterFor(team, name) {
  return PLAYER_MASTER_BY_ALIAS.get(`${team}|${normalizeIdentity(name)}`) ??
    PLAYER_MASTER_BY_CANONICAL.get(`${team}|${normalizeIdentity(name)}`) ?? null;
}

function decoratePlayerRow(row, nameKey = "name") {
  const master = playerMasterFor(row.team, row[nameKey]);
  if (!master) return row;
  row[nameKey] = master.roman;
  row.romanName = master.roman;
  row.kanji = master.kanji;
  row.aliases = [...new Set([master.roman, ...(master.aliases ?? [])])];
  row.nameSources = master.sources ?? [];
  return row;
}

function num(value) {
  if (value === null || value === undefined || clean(value) === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 1) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function div(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

function mean(sum, count) {
  return count ? sum / count : null;
}

function quantile(values, q) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * q;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function normalizeTeam(code) {
  const value = clean(code);
  return TEAM_NAMES[value] ?? value ?? "不明";
}

function normalizePitch(tagged, automatic) {
  const raw = selectRawPitchType(tagged, automatic);
  return PITCH_NAMES[raw] ?? (raw && raw !== "Undefined" ? raw : "不明");
}

function selectRawPitchType(tagged, automatic) {
  const taggedValue = clean(tagged);
  return taggedValue && taggedValue !== "Undefined" ? taggedValue : clean(automatic);
}

export const FASTBALL_SINKER_VELOCITY_RATIO = 0.96;

export function normalizeFastballSinkerPitchType(rawPitchType, pitchVelocity, fastballAvgVelocity) {
  const rawType = normalizePitch(rawPitchType, rawPitchType);
  if (!["ストレート", "シンカー"].includes(rawType)) return rawType;
  if (!Number.isFinite(pitchVelocity) || !Number.isFinite(fastballAvgVelocity) || fastballAvgVelocity <= 0) return rawType;
  return pitchVelocity <= fastballAvgVelocity * FASTBALL_SINKER_VELOCITY_RATIO ? "シンカー" : "ストレート";
}

function playerKey(id, name, team) {
  const rawId = clean(id);
  return rawId ? `id:${rawId}|${team}` : `name:${clean(name).toLowerCase()}|${team}`;
}

function normalizePerson(id, name, team) {
  const rawId = clean(id).replace(/\.0$/, "");
  const rawName = clean(name);
  const alias = PERSON_ALIASES[`${team}|${rawId}`] ?? PERSON_NAME_ALIASES[`${team}|${rawName.toLowerCase()}`];
  const canonicalId = alias?.id ?? rawId;
  const aliasName = alias?.name ?? rawName;
  const master = playerMasterFor(team, aliasName) ?? playerMasterFor(team, rawName);
  const canonicalName = master?.roman ?? aliasName;
  return {
    id: canonicalId,
    name: canonicalName,
    kanji: master?.kanji ?? "",
    aliases: master?.aliases ?? [rawName],
    sources: master?.sources ?? [],
    key: playerKey(canonicalId, canonicalName, team),
  };
}

function gameKey(row) {
  return clean(row.GameUID) || clean(row.GameID) || clean(row.SourceFile) ||
    `${clean(row.Date)}|${clean(row.HomeTeam)}|${clean(row.AwayTeam)}`;
}

function plateAppearanceKey(row, batterKey) {
  const game = gameKey(row);
  const pa = clean(row.PAofInning);
  if (pa) return `${game}|${clean(row["Top/Bottom"])}|${clean(row.Inning)}|${pa}|${batterKey}`;
  return `${game}|terminal|${clean(row.PitchUID) || clean(row.PitchNo)}|${batterKey}`;
}

function parseCsv(csvText) {
  const selectedRows = [];
  let headers = null;
  let selected = null;
  let row = [];
  let field = "";
  let quoted = false;

  const consumeRow = () => {
    if (row.length === 1 && row[0] === "") {
      row = [];
      return;
    }
    if (!headers) {
      headers = row.map((value, index) => index === 0 ? value.replace(/^\uFEFF/, "") : value);
      const headerMap = new Map(headers.map((value, index) => [value, index]));
      const missing = ["Pitcher", "Batter", "PitchCall", "RelSpeed"].filter((name) => !headerMap.has(name));
      if (missing.length) throw new Error(`必須列がありません: ${missing.join("、")}`);
      selected = SELECTED_COLUMNS.map((name) => [name, headerMap.get(name)]);
    } else {
      const compact = {};
      for (const [name, index] of selected) compact[name] = index === undefined ? "" : (row[index] ?? "");
      selectedRows.push(compact);
    }
    row = [];
  };

  for (let i = 0; i < csvText.length; i += 1) {
    const char = csvText[i];
    if (quoted) {
      if (char === '"' && csvText[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      field = "";
      consumeRow();
    } else {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    consumeRow();
  }
  return selectedRows;
}

function isSwing(call) {
  return call === "StrikeSwinging" || call === "InPlay" || call === "FoulBallFieldable" ||
    call === "FoulBallNotFieldable" || call === "foulBallNotFieldable";
}

function isStrike(call) {
  return call === "StrikeCalled" || isSwing(call);
}

function inZone(x, z) {
  return x !== null && z !== null && x >= ZONE.left && x <= ZONE.right && z >= ZONE.bottom && z <= ZONE.top;
}

function inHeart(x, z) {
  return x !== null && z !== null && Math.abs(x) <= 0.085 && z >= 0.65 && z <= 0.85;
}

function locationScore(x, z, call) {
  if (x === null || z === null) return 0;
  const inside = inZone(x, z);
  const distances = [Math.abs(x - ZONE.left), Math.abs(x - ZONE.right), Math.abs(z - ZONE.bottom), Math.abs(z - ZONE.top)];
  const edgeDistance = Math.min(...distances);
  const outsideX = Math.max(ZONE.left - x, 0, x - ZONE.right);
  const outsideZ = Math.max(ZONE.bottom - z, 0, z - ZONE.top);
  const outsideDistance = Math.hypot(outsideX, outsideZ);
  let score;
  if (inHeart(x, z)) score = -0.34;
  else if (inside && edgeDistance <= 0.075) score = 0.25;
  else if (inside) score = 0.05;
  else if (outsideDistance <= 0.12) score = 0.18;
  else if (outsideDistance <= 0.25) score = -0.03;
  else score = -0.32;
  if (call === "StrikeCalled" || call === "StrikeSwinging") score += 0.04;
  if (call === "BallCalled" || call === "BallinDirt") score -= 0.03;
  return score;
}

function pitchValue(row) {
  const korbb = clean(row.KorBB);
  const call = clean(row.PitchCall);
  const play = clean(row.PlayResult);
  if (korbb === "Strikeout") return 0.28;
  if (korbb === "Walk" || korbb === "Waik") return -0.33;
  if (call === "HitByPitch") return -0.35;
  if (call === "InPlay") {
    if (play === "Single") return -0.47;
    if (play === "Double") return -0.78;
    if (play === "Triple") return -1.05;
    if (play === "HomeRun") return -1.4;
    if (play === "Out") return 0.25;
    if (play === "Sacrifice") return 0.12;
    if (play === "FieldersChoice" || play === "Filderschoice") return 0.15;
    if (play === "Error") return -0.35;
  }
  if (call === "StrikeSwinging") return 0.045;
  if (call === "StrikeCalled") return 0.035;
  if (call === "FoulBallNotFieldable" || call === "foulBallNotFieldable") return 0.018;
  if (call === "BallinDirt") return -0.033;
  if (call === "BallCalled" || call === "BallIntentional") return -0.028;
  return 0;
}

function geometricStrikeProbability(x, z) {
  if (x === null || z === null) return null;
  const margin = Math.min(x - ZONE.left, ZONE.right - x, z - ZONE.bottom, ZONE.top - z);
  return 1 / (1 + Math.exp(-24 * margin));
}

function buildExpectedStrikeModel(rows) {
  const xMin = -0.62;
  const xMax = 0.62;
  const zMin = 0.18;
  const zMax = 1.32;
  const xCells = 25;
  const zCells = 24;
  const samples = { "右": [], "左": [] };

  for (const row of rows) {
    const call = clean(row.PitchCall);
    if (call !== "StrikeCalled" && call !== "BallCalled") continue;
    const x = num(row.PlateLocSide);
    const z = num(row.PlateLocHeight);
    if (x === null || z === null || x < xMin || x > xMax || z < zMin || z > zMax) continue;
    const side = clean(row.BatterSide) === "Left" ? "左" : "右";
    samples[side].push({ x, z, strike: call === "StrikeCalled" ? 1 : 0 });
  }

  const grids = {};
  for (const side of ["右", "左"]) {
    const grid = Array.from({ length: xCells * zCells }, () => 0.5);
    for (let rowIndex = 0; rowIndex < zCells; rowIndex += 1) {
      const centerZ = zMin + (rowIndex / (zCells - 1)) * (zMax - zMin);
      for (let colIndex = 0; colIndex < xCells; colIndex += 1) {
        const centerX = xMin + (colIndex / (xCells - 1)) * (xMax - xMin);
        let weightedStrikes = 0;
        let weightTotal = 0;
        for (const sample of samples[side]) {
          const dx = (sample.x - centerX) / 0.085;
          const dz = (sample.z - centerZ) / 0.095;
          if (Math.abs(dx) > 3 || Math.abs(dz) > 3) continue;
          const weight = Math.exp(-0.5 * (dx * dx + dz * dz));
          weightedStrikes += weight * sample.strike;
          weightTotal += weight;
        }
        const priorProbability = geometricStrikeProbability(centerX, centerZ);
        const priorWeight = 4;
        grid[rowIndex * xCells + colIndex] = Math.max(0.01, Math.min(0.99,
          (weightedStrikes + priorWeight * priorProbability) / (weightTotal + priorWeight),
        ));
      }
    }
    grids[side] = grid;
  }

  const interpolate = (grid, x, z) => {
    if (x === null || z === null) return null;
    if (x < xMin || x > xMax || z < zMin || z > zMax) return geometricStrikeProbability(x, z);
    const xPosition = ((x - xMin) / (xMax - xMin)) * (xCells - 1);
    const zPosition = ((z - zMin) / (zMax - zMin)) * (zCells - 1);
    const x0 = Math.floor(xPosition);
    const z0 = Math.floor(zPosition);
    const x1 = Math.min(xCells - 1, x0 + 1);
    const z1 = Math.min(zCells - 1, z0 + 1);
    const tx = xPosition - x0;
    const tz = zPosition - z0;
    const top = grid[z0 * xCells + x0] * (1 - tx) + grid[z0 * xCells + x1] * tx;
    const bottom = grid[z1 * xCells + x0] * (1 - tx) + grid[z1 * xCells + x1] * tx;
    return top * (1 - tz) + bottom * tz;
  };

  // Recenter the location model so league-wide shadow-zone residuals sum to
  // approximately zero. This keeps catcher values comparative rather than
  // rewarding or penalizing the league's overall called-zone tendency.
  for (const side of ["右", "左"]) {
    const grid = grids[side];
    for (let iteration = 0; iteration < 2; iteration += 1) {
      const shadow = samples[side].map((sample) => ({ ...sample, expected: interpolate(grid, sample.x, sample.z) }))
        .filter((sample) => sample.expected >= 0.1 && sample.expected <= 0.9);
      if (!shadow.length) continue;
      const actualTotal = shadow.reduce((sum, sample) => sum + sample.strike, 0);
      const expectedTotal = shadow.reduce((sum, sample) => sum + sample.expected, 0);
      const adjustment = (actualTotal - expectedTotal) / shadow.length;
      for (let index = 0; index < grid.length; index += 1) {
        grid[index] = Math.max(0.01, Math.min(0.99, grid[index] + adjustment));
      }
    }
  }

  return (x, z, side) => interpolate(grids[side] ?? grids["右"], x, z);
}

function framingArea(x, z, batterSide) {
  const edges = [
    { key: "outside", distance: Math.abs(x - (batterSide === "右" ? ZONE.left : ZONE.right)) },
    { key: "inside", distance: Math.abs(x - (batterSide === "右" ? ZONE.right : ZONE.left)) },
    { key: "low", distance: Math.abs(z - ZONE.bottom) },
    { key: "high", distance: Math.abs(z - ZONE.top) },
  ];
  return edges.sort((a, b) => a.distance - b.distance)[0].key;
}

function isBarrel(exitSpeedKmh, launchAngle) {
  if (exitSpeedKmh === null || launchAngle === null) return false;
  const mph = exitSpeedKmh / 1.609344;
  if (mph < 98) return false;
  const over = mph - 98;
  const lower = Math.max(8, 26 - over);
  const upper = Math.min(50, 30 + over * 1.5);
  return launchAngle >= lower && launchAngle <= upper;
}

function createBatting(id, name, team, side) {
  return {
    id, name, team, side, pitches: 0, pa: 0, ab: 0, hits: 0, singles: 0,
    doubles: 0, triples: 0, homeRuns: 0, walks: 0, hbp: 0, strikeouts: 0,
    sacrifices: 0, runsCreatedNumerator: 0, bbe: 0, evSum: 0, evValues: [],
    laSum: 0, distanceMax: null, hardHit: 0, barrels: 0, sweetSpot: 0,
    xHits: 0, xTb: 0, xWobaContact: 0, swings: 0, whiffs: 0, zonePitches: 0,
    zoneSwings: 0, outsidePitches: 0, chases: 0, csw: 0,
  };
}

function createPitching(id, name, team, throws) {
  return {
    id, name, team, throws, pitches: 0, pa: 0, outs: 0, hits: 0, homeRuns: 0,
    walks: 0, hbp: 0, strikeouts: 0, runs: 0, swings: 0, whiffs: 0, csw: 0,
    strikes: 0, firstPitches: 0, firstPitchStrikes: 0, zonePitches: 0,
    outsidePitches: 0, chases: 0, heartPitches: 0, bbe: 0, evSum: 0,
    hardHit: 0, barrels: 0, xWobaContact: 0, xHits: 0, xTb: 0,
    pitchValue: 0, locationScore: 0, veloSum: 0, veloN: 0, maxVelo: null,
    spinSum: 0, spinN: 0, ivbSum: 0, ivbN: 0, hbSum: 0, hbN: 0,
    extensionSum: 0, extensionN: 0, vaaSum: 0, vaaN: 0,
  };
}

function createPitchType(pitcherId, pitcher, team, pitchType) {
  return {
    pitcherId, pitcher, team, pitchType, pitches: 0, veloSum: 0, veloN: 0,
    maxVelo: null, spinSum: 0, spinN: 0, ivbSum: 0, ivbN: 0, hbSum: 0,
    hbN: 0, vaaSum: 0, vaaN: 0, extensionSum: 0, extensionN: 0,
    relHeightSum: 0, relHeightN: 0, relSideSum: 0, relSideN: 0,
    vertAngleSum: 0, vertAngleN: 0, horzAngleSum: 0, horzAngleN: 0,
    swings: 0, whiffs: 0, csw: 0, bbe: 0, evSum: 0, hardHit: 0,
    pitchValue: 0, locationScore: 0,
  };
}

function createCatching(id, name, team) {
  return {
    id, name, team, received: 0, calledPitches: 0, shadowPitches: 0,
    actualStrikes: 0, expectedStrikes: 0, extraStrikes: 0,
    popTimes: [],
    framingAreas: {
      low: { pitches: 0, actualStrikes: 0, expectedStrikes: 0, extraStrikes: 0 },
      high: { pitches: 0, actualStrikes: 0, expectedStrikes: 0, extraStrikes: 0 },
      inside: { pitches: 0, actualStrikes: 0, expectedStrikes: 0, extraStrikes: 0 },
      outside: { pitches: 0, actualStrikes: 0, expectedStrikes: 0, extraStrikes: 0 },
    },
    framingHeatmaps: {
      "右": Array.from({ length: 25 }, () => ({ pitches: 0, actualStrikes: 0, expectedStrikes: 0, extraStrikes: 0 })),
      "左": Array.from({ length: 25 }, () => ({ pitches: 0, actualStrikes: 0, expectedStrikes: 0, extraStrikes: 0 })),
    },
  };
}

function addFramingResult(aggregate, actual, expected) {
  aggregate.pitches += 1;
  aggregate.actualStrikes += actual;
  aggregate.expectedStrikes += expected;
  aggregate.extraStrikes += actual - expected;
}

function finalizeFramingAggregate(raw) {
  return {
    pitches: raw.pitches,
    actualStrikeRate: round(div(raw.actualStrikes, raw.pitches), 3),
    expectedStrikeRate: round(div(raw.expectedStrikes, raw.pitches), 3),
    extraStrikes: round(raw.extraStrikes, 1),
    extraStrikeRate: round(div(raw.extraStrikes, raw.pitches), 3),
  };
}

function addNumeric(aggregate, prefix, value) {
  if (value === null) return;
  aggregate[`${prefix}Sum`] += value;
  aggregate[`${prefix}N`] += 1;
}

function finalizeBatting(raw, leagueWoba) {
  const denominator = raw.ab + raw.walks + raw.hbp + raw.sacrifices;
  const actualWobaNumerator = 0.69 * raw.walks + 0.72 * raw.hbp + 0.88 * raw.singles +
    1.247 * raw.doubles + 1.578 * raw.triples + 2.031 * raw.homeRuns;
  const xWobaNumerator = 0.69 * raw.walks + 0.72 * raw.hbp + raw.xWobaContact;
  const woba = div(actualWobaNumerator, denominator);
  const xwoba = div(xWobaNumerator, denominator);
  const avg = div(raw.hits, raw.ab);
  const obp = div(raw.hits + raw.walks + raw.hbp, raw.ab + raw.walks + raw.hbp + raw.sacrifices);
  const slg = div(raw.singles + 2 * raw.doubles + 3 * raw.triples + 4 * raw.homeRuns, raw.ab);
  return {
    id: raw.id, name: raw.name, team: raw.team, side: raw.side,
    pitches: raw.pitches, pa: raw.pa, ab: raw.ab, hits: raw.hits,
    doubles: raw.doubles, triples: raw.triples, homeRuns: raw.homeRuns,
    walks: raw.walks, hbp: raw.hbp, sacrifices: raw.sacrifices, strikeouts: raw.strikeouts, bbe: raw.bbe,
    battingAverage: round(avg, 3), onBasePercentage: round(obp, 3),
    sluggingPercentage: round(slg, 3), ops: round((obp ?? 0) + (slg ?? 0), 3),
    woba: round(woba, 3), xba: round(div(raw.xHits, raw.ab), 3),
    xslg: round(div(raw.xTb, raw.ab), 3), xwoba: round(xwoba, 3),
    wrcPlus: round(woba !== null && leagueWoba ? 100 * woba / leagueWoba : null, 0),
    avgExitVelocity: round(mean(raw.evSum, raw.bbe), 1),
    maxExitVelocity: round(raw.evValues.length ? Math.max(...raw.evValues) : null, 1),
    ev90: round(quantile(raw.evValues, 0.9), 1),
    avgLaunchAngle: round(mean(raw.laSum, raw.bbe), 1),
    maxDistance: round(raw.distanceMax, 1),
    hardHitRate: round(div(raw.hardHit, raw.bbe), 3),
    barrelRate: round(div(raw.barrels, raw.bbe), 3),
    sweetSpotRate: round(div(raw.sweetSpot, raw.bbe), 3),
    swingRate: round(div(raw.swings, raw.pitches), 3),
    whiffRate: round(div(raw.whiffs, raw.swings), 3),
    chaseRate: round(div(raw.chases, raw.outsidePitches), 3),
    zoneContactRate: round(div(raw.zoneSwings - raw.whiffs, raw.zoneSwings), 3),
    cswRate: round(div(raw.csw, raw.pitches), 3),
  };
}

function inningsDisplay(outs) {
  return `${Math.floor(outs / 3)}.${outs % 3}`;
}

function finalizePitching(raw, league) {
  const innings = raw.outs / 3;
  const denominator = raw.pa || 1;
  const xWobaAllowed = (0.69 * raw.walks + 0.72 * raw.hbp + raw.xWobaContact) / denominator;
  const xEra = league.era + (xWobaAllowed - league.xwoba) * 25;
  return {
    id: raw.id, name: raw.name, team: raw.team, throws: raw.throws,
    pitches: raw.pitches, pa: raw.pa, innings: inningsDisplay(raw.outs),
    inningsValue: round(innings, 2), hits: raw.hits, homeRuns: raw.homeRuns,
    walks: raw.walks, hbp: raw.hbp, strikeouts: raw.strikeouts, runs: raw.runs,
    era: round(innings ? raw.runs * 9 / innings : null, 2),
    xera: round(Math.max(0, xEra), 2),
    whip: round(innings ? (raw.hits + raw.walks) / innings : null, 2),
    kPer9: round(innings ? raw.strikeouts * 9 / innings : null, 1),
    bbPer9: round(innings ? raw.walks * 9 / innings : null, 1),
    kMinusBbRate: round(div(raw.strikeouts - raw.walks, raw.pa), 3),
    strikeRate: round(div(raw.strikes, raw.pitches), 3),
    firstPitchStrikeRate: round(div(raw.firstPitchStrikes, raw.firstPitches), 3),
    whiffRate: round(div(raw.whiffs, raw.swings), 3),
    cswRate: round(div(raw.csw, raw.pitches), 3),
    chaseRate: round(div(raw.chases, raw.outsidePitches), 3),
    heartRate: round(div(raw.heartPitches, raw.pitches), 3),
    avgExitVelocityAllowed: round(mean(raw.evSum, raw.bbe), 1),
    hardHitRateAllowed: round(div(raw.hardHit, raw.bbe), 3),
    barrelRateAllowed: round(div(raw.barrels, raw.bbe), 3),
    xwobaAllowed: round(xWobaAllowed, 3),
    pitchValue: round(raw.pitchValue, 2),
    pitchValuePer100: round(100 * raw.pitchValue / raw.pitches, 2),
    avgVelocity: round(mean(raw.veloSum, raw.veloN), 1), maxVelocity: round(raw.maxVelo, 1),
    avgSpin: round(mean(raw.spinSum, raw.spinN), 0),
    avgIvb: round(mean(raw.ivbSum, raw.ivbN), 1), avgHb: round(mean(raw.hbSum, raw.hbN), 1),
    avgExtension: round(mean(raw.extensionSum, raw.extensionN) * 100, 1),
    avgVaa: round(mean(raw.vaaSum, raw.vaaN), 1),
    stuffPlus: null, locationPlus: round(100 + 26 * mean(raw.locationScore, raw.pitches), 1),
    pitchingPlus: null,
  };
}

function zscore(value, center, spread) {
  if (value === null || !Number.isFinite(value) || !spread) return 0;
  return (value - center) / spread;
}

function weightedSummaryStats(rows, key, weightKey = "pitches") {
  const valid = rows.filter((row) => Number.isFinite(row[key]) && Number.isFinite(row[weightKey]) && row[weightKey] > 0);
  if (!valid.length) return { mean: 0, sd: 1 };
  const weight = valid.reduce((sum, row) => sum + row[weightKey], 0);
  const avg = valid.reduce((sum, row) => sum + row[key] * row[weightKey], 0) / weight;
  const variance = valid.reduce((sum, row) => sum + row[weightKey] * (row[key] - avg) ** 2, 0) / weight;
  return { mean: avg, sd: Math.sqrt(variance) || 1 };
}

function percentile(values, value, higherIsBetter = true) {
  const valid = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!valid.length || !Number.isFinite(value)) return null;
  let below = 0;
  for (const candidate of valid) if (candidate <= value) below += 1;
  const pct = Math.round(100 * (below - 0.5) / valid.length);
  return higherIsBetter ? Math.max(1, Math.min(99, pct)) : Math.max(1, Math.min(99, 100 - pct));
}

function computePercentiles(rows, fields) {
  const pools = Object.fromEntries(fields.map(({ key }) => [key, rows.map((row) => row[key]).filter(Number.isFinite)]));
  for (const row of rows) {
    row.percentiles = {};
    for (const { key, higher = true } of fields) row.percentiles[key] = percentile(pools[key], row[key], higher);
  }
}

function modelMap(rows, role = "pitcher") {
  const map = new Map();
  for (const row of rows ?? []) {
    const team = clean(row.Team ?? row.team);
    const person = normalizePerson("", clean(row.PitcherDisplay ?? row.name), team);
    const name = person.name.toLowerCase();
    const rawType = clean(row.PitchType ?? row.pitchType);
    const type = role === "pitchType" ? normalizePitch(rawType, rawType) : "";
    map.set(`${name}|${team}|${type}`, row);
  }
  return map;
}

export function buildDatasetFromCsv(csvText, options = {}) {
  const parsedRows = parseCsv(csvText);
  const deduped = [];
  const seen = new Set();
  for (const row of parsedRows) {
    const dedupeKey = clean(row.PitchUID) || `${gameKey(row)}|${clean(row.PitchNo)}|${clean(row.Pitcher)}|${clean(row.Batter)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    deduped.push(row);
  }
  const datasetSeason = clean(options.season) || "2026年春季";
  const fastballBaselines = new Map();
  for (const row of deduped) {
    const rawPitchType = selectRawPitchType(row.TaggedPitchType, row.AutoPitchType);
    if (normalizePitch(rawPitchType, rawPitchType) !== "ストレート") continue;
    const velocity = num(row.RelSpeed);
    if (velocity === null) continue;
    const pitcherTeam = normalizeTeam(row.PitcherTeam);
    const pitcherPerson = normalizePerson(row.PitcherId, clean(row.Pitcher) || "投手不明", pitcherTeam);
    const key = `${datasetSeason}|${pitcherPerson.key}`;
    const baseline = fastballBaselines.get(key) ?? {
      season: datasetSeason,
      pitcherId: pitcherPerson.key,
      pitcher: pitcherPerson.name,
      pitcherKanji: pitcherPerson.kanji,
      team: pitcherTeam,
      velocitySum: 0,
      fastballPitches: 0,
    };
    baseline.velocitySum += velocity;
    baseline.fastballPitches += 1;
    fastballBaselines.set(key, baseline);
  }
  for (const baseline of fastballBaselines.values()) {
    baseline.fastballAvgVelocity = baseline.velocitySum / baseline.fastballPitches;
    baseline.sinkerThreshold = baseline.fastballAvgVelocity * FASTBALL_SINKER_VELOCITY_RATIO;
  }
  const expectedStrikeFor = buildExpectedStrikeModel(deduped);

  const contacts = [];
  for (const row of deduped) {
    const ev = num(row.ExitSpeed);
    const la = num(row.Angle);
    const play = clean(row.PlayResult);
    const taggedHit = clean(row.TaggedHitType);
    if (clean(row.PitchCall) === "InPlay" && taggedHit !== "Bunt" && ev !== null && ev > 0 && la !== null) {
      const hit = ["Single", "Double", "Triple", "HomeRun"].includes(play) ? 1 : 0;
      const tb = play === "Single" ? 1 : play === "Double" ? 2 : play === "Triple" ? 3 : play === "HomeRun" ? 4 : 0;
      const woba = play === "Single" ? 0.88 : play === "Double" ? 1.247 : play === "Triple" ? 1.578 : play === "HomeRun" ? 2.031 : 0;
      contacts.push({ row, ev, la, hit, tb, woba });
    }
  }
  const contactLeague = {
    hit: contacts.reduce((sum, item) => sum + item.hit, 0) / Math.max(1, contacts.length),
    tb: contacts.reduce((sum, item) => sum + item.tb, 0) / Math.max(1, contacts.length),
    woba: contacts.reduce((sum, item) => sum + item.woba, 0) / Math.max(1, contacts.length),
  };
  const bins = new Map();
  for (const item of contacts) {
    const key = `${Math.floor(item.ev / 8)}|${Math.floor((item.la + 90) / 10)}`;
    const bin = bins.get(key) ?? { n: 0, hit: 0, tb: 0, woba: 0 };
    bin.n += 1; bin.hit += item.hit; bin.tb += item.tb; bin.woba += item.woba;
    bins.set(key, bin);
  }
  const expectedByRow = new Map();
  for (const item of contacts) {
    const key = `${Math.floor(item.ev / 8)}|${Math.floor((item.la + 90) / 10)}`;
    const bin = bins.get(key);
    const prior = 12;
    expectedByRow.set(item.row, {
      hit: (bin.hit + contactLeague.hit * prior) / (bin.n + prior),
      tb: (bin.tb + contactLeague.tb * prior) / (bin.n + prior),
      woba: (bin.woba + contactLeague.woba * prior) / (bin.n + prior),
    });
  }

  const battersRaw = new Map();
  const pitchersRaw = new Map();
  const pitchTypesRaw = new Map();
  const catchersRaw = new Map();
  const gamesRaw = new Map();
  const completedBatterPa = new Set();
  const completedPitcherPa = new Set();
  const pitchSamples = [];
  const pitchTypeNormalizationByPitcher = new Map();

  for (const row of deduped) {
    const pitcherTeam = normalizeTeam(row.PitcherTeam);
    const batterTeam = normalizeTeam(row.BatterTeam);
    const catcherTeam = normalizeTeam(row.CatcherTeam || row.PitcherTeam);
    const pitcherPerson = normalizePerson(row.PitcherId, clean(row.Pitcher) || "投手不明", pitcherTeam);
    const batterPerson = normalizePerson(row.BatterId, clean(row.Batter) || "打者不明", batterTeam);
    const rawCatcherName = clean(row.Catcher);
    const catcherPerson = rawCatcherName ? normalizePerson(row.CatcherId, rawCatcherName, catcherTeam) : null;
    const pitcherName = pitcherPerson.name;
    const batterName = batterPerson.name;
    const catcherName = catcherPerson?.name ?? "";
    const pitcherId = pitcherPerson.key;
    const batterId = batterPerson.key;
    const catcherId = catcherPerson?.key ?? null;
    const rawPitchType = selectRawPitchType(row.TaggedPitchType, row.AutoPitchType);
    const rawPitchTypeDisplay = normalizePitch(rawPitchType, rawPitchType);
    const fastballBaseline = fastballBaselines.get(`${datasetSeason}|${pitcherId}`) ?? null;
    let pitchType = normalizeFastballSinkerPitchType(rawPitchType, num(row.RelSpeed), fastballBaseline?.fastballAvgVelocity);
    if (options.applyPlayerRules) {
      const v = num(row.RelSpeed);
      if (pitcherTeam === '立正大学' && pitcherName === 'Nita, Haruto' && v !== null && ['ストレート', 'シンカー'].includes(rawPitchTypeDisplay)) pitchType = v >= 145 ? 'ストレート' : 'シンカー';
      if (pitcherTeam === '國學院大學' && pitcherName === 'Fujimoto, Shisei' && v !== null && v <= 120) pitchType = 'チェンジアップ';
    }
    if (["ストレート", "シンカー"].includes(rawPitchTypeDisplay)) {
      const audit = pitchTypeNormalizationByPitcher.get(pitcherId) ?? {
        season: datasetSeason,
        pitcherId,
        pitcher: pitcherName,
        pitcherKanji: pitcherPerson.kanji,
        team: pitcherTeam,
        fastballPitches: fastballBaseline?.fastballPitches ?? 0,
        fastballAvgVelocity: fastballBaseline?.fastballAvgVelocity ?? null,
        sinkerThreshold: fastballBaseline?.sinkerThreshold ?? null,
        rawFastballPitches: 0,
        rawSinkerPitches: 0,
        rawFastballToSinker: 0,
        rawSinkerToFastball: 0,
        rawSinkerRetained: 0,
      };
      if (rawPitchTypeDisplay === "ストレート") {
        audit.rawFastballPitches += 1;
        if (pitchType === "シンカー") audit.rawFastballToSinker += 1;
      } else {
        audit.rawSinkerPitches += 1;
        if (pitchType === "ストレート") audit.rawSinkerToFastball += 1;
        else audit.rawSinkerRetained += 1;
      }
      pitchTypeNormalizationByPitcher.set(pitcherId, audit);
    }
    const call = clean(row.PitchCall);
    const play = clean(row.PlayResult);
    const korbb = clean(row.KorBB);
    const batterSide = clean(row.BatterSide) === "Left" ? "左" : "右";
    const pitcherThrows = clean(row.PitcherThrows) === "Left" ? "左" : "右";
    const x = num(row.PlateLocSide);
    const z = num(row.PlateLocHeight);
    const ev = num(row.ExitSpeed);
    const la = num(row.Angle);
    const launchDirection = num(row.Direction);
    const bearing = num(row.Bearing);
    const distance = num(row.Distance);
    const velo = num(row.RelSpeed);
    const spin = num(row.SpinRate);
    const ivb = num(row.InducedVertBreak);
    const hb = num(row.HorzBreak);
    const vaa = num(row.VertApprAngle);
    const extension = num(row.Extension);
    const rawPitchValue = pitchValue(row);
    const rawLocationScore = locationScore(x, z, call);
    const expected = expectedByRow.get(row);

    let batting = battersRaw.get(batterId);
    if (!batting) {
      batting = createBatting(batterId, batterName, batterTeam, batterSide);
      battersRaw.set(batterId, batting);
    }
    let pitching = pitchersRaw.get(pitcherId);
    if (!pitching) {
      pitching = createPitching(pitcherId, pitcherName, pitcherTeam, pitcherThrows);
      pitchersRaw.set(pitcherId, pitching);
    }
    const pitchTypeKey = `${pitcherId}|${pitchType}`;
    let pitchTypeAgg = pitchTypesRaw.get(pitchTypeKey);
    if (!pitchTypeAgg) {
      pitchTypeAgg = createPitchType(pitcherId, pitcherName, pitcherTeam, pitchType);
      pitchTypesRaw.set(pitchTypeKey, pitchTypeAgg);
    }

    batting.pitches += 1;
    pitching.pitches += 1;
    pitchTypeAgg.pitches += 1;
    pitching.pitchValue += rawPitchValue;
    pitching.locationScore += rawLocationScore;
    pitchTypeAgg.pitchValue += rawPitchValue;
    pitchTypeAgg.locationScore += rawLocationScore;

    const swing = isSwing(call);
    const whiff = call === "StrikeSwinging";
    const zone = inZone(x, z);
    if (swing) { batting.swings += 1; pitching.swings += 1; pitchTypeAgg.swings += 1; }
    if (whiff) { batting.whiffs += 1; pitching.whiffs += 1; pitchTypeAgg.whiffs += 1; }
    if (call === "StrikeCalled" || whiff) { batting.csw += 1; pitching.csw += 1; pitchTypeAgg.csw += 1; }
    if (isStrike(call)) pitching.strikes += 1;
    if (zone) { batting.zonePitches += 1; pitching.zonePitches += 1; if (swing) batting.zoneSwings += 1; }
    else { batting.outsidePitches += 1; pitching.outsidePitches += 1; if (swing) { batting.chases += 1; pitching.chases += 1; } }
    if (inHeart(x, z)) pitching.heartPitches += 1;
    if (num(row.Balls) === 0 && num(row.Strikes) === 0) {
      pitching.firstPitches += 1;
      if (isStrike(call)) pitching.firstPitchStrikes += 1;
    }

    addNumeric(pitching, "velo", velo);
    addNumeric(pitching, "spin", spin);
    addNumeric(pitching, "ivb", ivb);
    addNumeric(pitching, "hb", hb);
    addNumeric(pitching, "extension", extension);
    addNumeric(pitching, "vaa", vaa);
    addNumeric(pitchTypeAgg, "velo", velo);
    addNumeric(pitchTypeAgg, "spin", spin);
    addNumeric(pitchTypeAgg, "ivb", ivb);
    addNumeric(pitchTypeAgg, "hb", hb);
    addNumeric(pitchTypeAgg, "vaa", vaa);
    addNumeric(pitchTypeAgg, "extension", extension);
    addNumeric(pitchTypeAgg, "relHeight", num(row.RelHeight));
    addNumeric(pitchTypeAgg, "relSide", num(row.RelSide));
    addNumeric(pitchTypeAgg, "vertAngle", num(row.VertRelAngle));
    addNumeric(pitchTypeAgg, "horzAngle", num(row.HorzRelAngle));
    if (velo !== null) {
      pitching.maxVelo = pitching.maxVelo === null ? velo : Math.max(pitching.maxVelo, velo);
      pitchTypeAgg.maxVelo = pitchTypeAgg.maxVelo === null ? velo : Math.max(pitchTypeAgg.maxVelo, velo);
    }

    if (expected) {
      batting.bbe += 1; batting.evSum += ev; batting.evValues.push(ev); batting.laSum += la;
      batting.hardHit += ev >= HARD_HIT_KMH ? 1 : 0;
      batting.barrels += isBarrel(ev, la) ? 1 : 0;
      batting.sweetSpot += la >= 8 && la <= 32 ? 1 : 0;
      batting.xHits += expected.hit; batting.xTb += expected.tb; batting.xWobaContact += expected.woba;
      if (distance !== null) batting.distanceMax = batting.distanceMax === null ? distance : Math.max(batting.distanceMax, distance);
      pitching.bbe += 1; pitching.evSum += ev; pitching.hardHit += ev >= HARD_HIT_KMH ? 1 : 0;
      pitching.barrels += isBarrel(ev, la) ? 1 : 0;
      pitching.xHits += expected.hit; pitching.xTb += expected.tb; pitching.xWobaContact += expected.woba;
      pitchTypeAgg.bbe += 1; pitchTypeAgg.evSum += ev; pitchTypeAgg.hardHit += ev >= HARD_HIT_KMH ? 1 : 0;
    }

    const terminal = korbb === "Strikeout" || korbb === "Walk" || korbb === "Waik" || call === "HitByPitch" || call === "InPlay";
    if (terminal) {
      const paKey = plateAppearanceKey(row, batterId);
      if (!completedBatterPa.has(paKey)) {
        completedBatterPa.add(paKey);
        batting.pa += 1;
        if (korbb === "Strikeout") { batting.strikeouts += 1; batting.ab += 1; }
        else if (korbb === "Walk" || korbb === "Waik") batting.walks += 1;
        else if (call === "HitByPitch") batting.hbp += 1;
        else {
          if (play === "Sacrifice") batting.sacrifices += 1;
          else batting.ab += 1;
          if (["Single", "Double", "Triple", "HomeRun"].includes(play)) batting.hits += 1;
          if (play === "Single") batting.singles += 1;
          if (play === "Double") batting.doubles += 1;
          if (play === "Triple") batting.triples += 1;
          if (play === "HomeRun") batting.homeRuns += 1;
        }
      }
      if (!completedPitcherPa.has(paKey)) {
        completedPitcherPa.add(paKey);
        pitching.pa += 1;
        const recordedOuts = num(row.OutsOnPlay) ?? 0;
        pitching.outs += recordedOuts + (korbb === "Strikeout" && recordedOuts === 0 ? 1 : 0);
        pitching.runs += num(row.RunsScored) ?? 0;
        if (korbb === "Strikeout") pitching.strikeouts += 1;
        else if (korbb === "Walk" || korbb === "Waik") pitching.walks += 1;
        else if (call === "HitByPitch") pitching.hbp += 1;
        if (["Single", "Double", "Triple", "HomeRun"].includes(play)) pitching.hits += 1;
        if (play === "HomeRun") pitching.homeRuns += 1;
      }
    }

    if (catcherId) {
      let catching = catchersRaw.get(catcherId);
      if (!catching) { catching = createCatching(catcherId, catcherName, catcherTeam); catchersRaw.set(catcherId, catching); }
      catching.received += 1;
      const popTime = num(row.PopTime);
      const basePositionX = num(row.BasePositionX);
      const validSecondBaseThrow = basePositionX !== null && basePositionX >= 35 &&
        popTime !== null && popTime >= 1.6 && popTime <= 2.5 &&
        clean(row.CatcherThrowCatchConfidence) !== "Low" &&
        clean(row.CatcherThrowReleaseConfidence) !== "Low";
      if (validSecondBaseThrow) catching.popTimes.push(popTime);
      if ((call === "StrikeCalled" || call === "BallCalled") && x !== null && z !== null) {
        const probability = expectedStrikeFor(x, z, batterSide);
        const actual = call === "StrikeCalled" ? 1 : 0;
        catching.calledPitches += 1;
        if (probability >= 0.1 && probability <= 0.9) {
          catching.shadowPitches += 1;
          catching.actualStrikes += actual;
          catching.expectedStrikes += probability;
          catching.extraStrikes += actual - probability;
          addFramingResult(catching.framingAreas[framingArea(x, z, batterSide)], actual, probability);
        }
        if (x >= -0.45 && x <= 0.45 && z >= 0.25 && z <= 1.25) {
          const col = Math.min(4, Math.max(0, Math.floor(((x + 0.45) / 0.9) * 5)));
          const heatRow = Math.min(4, Math.max(0, 4 - Math.floor(((z - 0.25) / 1) * 5)));
          addFramingResult(catching.framingHeatmaps[batterSide][heatRow * 5 + col], actual, probability);
        }
      }
    }

    const gameId = gameKey(row);
    let game = gamesRaw.get(gameId);
    if (!game) {
      game = {
        id: gameId, date: clean(row.Date), homeTeam: normalizeTeam(row.HomeTeam),
        awayTeam: normalizeTeam(row.AwayTeam), homeRuns: 0, awayRuns: 0, pitches: 0,
      };
      gamesRaw.set(gameId, game);
    }
    game.pitches += 1;
    const runs = num(row.RunsScored) ?? 0;
    if (runs) {
      if (batterTeam === game.homeTeam) game.homeRuns += runs;
      if (batterTeam === game.awayTeam) game.awayRuns += runs;
    }

    pitchSamples.push({
      id: clean(row.PitchUID) || `${gameId}-${clean(row.PitchNo)}`,
      paOfInning: num(row.PAofInning), pitchOfPA: num(row.PitchofPA),
      gameId, date: clean(row.Date), time: clean(row.Time), pitchNo: num(row.PitchNo), inning: num(row.Inning), half: clean(row["Top/Bottom"]) === "Top" ? "表" : "裏",
      year: Number(clean(row.Date).slice(0, 4)) || null, season: String(options.season ?? "2026年春季").includes("秋") ? "秋" : "春",
      pitcherId, pitcher: pitcherName, pitcherKanji: pitcherPerson.kanji, pitcherTeam, pitcherThrows,
      batterId, batter: batterName, batterKanji: batterPerson.kanji, batterTeam, batterSide,
      pitchType, normalizedPitchType: pitchType, rawPitchType, rawPitchTypeDisplay,
      pitchTypeChanged: rawPitchTypeDisplay !== pitchType,
      playerRulesApplied: Boolean(options.applyPlayerRules),
      rawVelocity: num(row.RelSpeed),
      taggedPitchType: clean(row.TaggedPitchType), autoPitchType: clean(row.AutoPitchType),
      pitchTypeSource: clean(row.TaggedPitchType) && clean(row.TaggedPitchType) !== "Undefined" ? "TaggedPitchType" : "AutoPitchType",
      catcherId, catcher: catcherName, catcherKanji: catcherPerson?.kanji ?? "", catcherTeam,
      opponentTeam: batterTeam, balls: num(row.Balls), strikes: num(row.Strikes), outs: num(row.Outs), result: RESULT_NAMES[call] ?? call,
      playResult: PLAY_NAMES[play] ?? play, velocity: round(velo, 1), spin: round(spin, 0),
      ivb: round(ivb, 1), hb: round(hb, 1), vaa: round(vaa, 1),
      extension: round(extension === null ? null : extension * 100, 1),
      releaseHeight: round(num(row.RelHeight) === null ? null : num(row.RelHeight) * 100, 1),
      releaseSide: round(num(row.RelSide) === null ? null : num(row.RelSide) * 100, 1),
      spinAxis: round(num(row.SpinAxis), 1), tilt: clean(row.Tilt),
      plateX: round(x, 3), plateZ: round(z, 3), exitVelocity: round(ev, 1),
      launchAngle: round(la, 1), direction: round(launchDirection, 1),
      hitType: clean(row.TaggedHitType),
      sprayAngle: round(bearing ?? launchDirection, 1), distance: round(distance, 1),
      expectedHit: round(expected?.hit ?? null, 4), expectedTb: round(expected?.tb ?? null, 4),
      expectedWoba: round(expected?.woba ?? null, 4), korbb: clean(row.KorBB),
      outsOnPlay: num(row.OutsOnPlay), runsScored: num(row.RunsScored),
    });
  }

  const leaguePa = [...battersRaw.values()].reduce((sum, row) => sum + row.pa, 0);
  const leagueWobaNumerator = [...battersRaw.values()].reduce((sum, row) => sum +
    0.69 * row.walks + 0.72 * row.hbp + 0.88 * row.singles + 1.247 * row.doubles +
    1.578 * row.triples + 2.031 * row.homeRuns, 0);
  const leagueWoba = leagueWobaNumerator / Math.max(1, leaguePa);
  const totalRuns = [...pitchersRaw.values()].reduce((sum, row) => sum + row.runs, 0);
  const totalOuts = [...pitchersRaw.values()].reduce((sum, row) => sum + row.outs, 0);
  const leagueEra = totalOuts ? totalRuns * 27 / totalOuts : 4;
  const leagueExpectedWobaNumerator = [...battersRaw.values()].reduce((sum, row) => sum + 0.69 * row.walks + 0.72 * row.hbp + row.xWobaContact, 0);
  const leagueExpectedWoba = leagueExpectedWobaNumerator / Math.max(1, leaguePa);
  const league = { woba: leagueWoba, xwoba: leagueExpectedWoba, era: leagueEra };

  const batters = [...battersRaw.values()].map((row) => decoratePlayerRow(finalizeBatting(row, leagueWoba)));
  const officialBatting = applyOfficialBatting2026Spring(batters, options.season);
  const pitchers = [...pitchersRaw.values()].map((row) => decoratePlayerRow(finalizePitching(row, league)));

  const pitchTypes = [...pitchTypesRaw.values()].map((raw) => ({
    pitcherId: raw.pitcherId, pitcher: raw.pitcher, team: raw.team, pitchType: raw.pitchType,
    pitches: raw.pitches, usageRate: null,
    avgVelocity: round(mean(raw.veloSum, raw.veloN), 1), maxVelocity: round(raw.maxVelo, 1),
    avgSpin: round(mean(raw.spinSum, raw.spinN), 0), avgIvb: round(mean(raw.ivbSum, raw.ivbN), 1),
    avgHb: round(mean(raw.hbSum, raw.hbN), 1), avgVaa: round(mean(raw.vaaSum, raw.vaaN), 1),
    avgExtension: round(mean(raw.extensionSum, raw.extensionN) * 100, 1),
    avgReleaseHeight: round(mean(raw.relHeightSum, raw.relHeightN) * 100, 1),
    avgReleaseSide: round(mean(raw.relSideSum, raw.relSideN) * 100, 1),
    avgVerticalReleaseAngle: round(mean(raw.vertAngleSum, raw.vertAngleN), 1),
    avgHorizontalReleaseAngle: round(mean(raw.horzAngleSum, raw.horzAngleN), 1),
    whiffRate: round(div(raw.whiffs, raw.swings), 3), cswRate: round(div(raw.csw, raw.pitches), 3),
    avgExitVelocityAllowed: round(mean(raw.evSum, raw.bbe), 1),
    hardHitRateAllowed: round(div(raw.hardHit, raw.bbe), 3),
    pitchValuePer100: round(100 * raw.pitchValue / raw.pitches, 2),
    rawLocationScore: mean(raw.locationScore, raw.pitches),
    locationPlus: null,
    stuffPlus: null, pitchingPlus: null,
  })).map((row) => {
    const master = playerMasterFor(row.team, row.pitcher);
    if (master) { row.pitcher = master.roman; row.pitcherKanji = master.kanji; }
    return row;
  });

  const pitcherPitchCounts = new Map(pitchers.map((row) => [row.id, row.pitches]));
  for (const row of pitchTypes) row.usageRate = round(row.pitches / pitcherPitchCounts.get(row.pitcherId), 3);

  const groups = new Map();
  for (const row of pitchTypes) {
    if (!groups.has(row.pitchType)) groups.set(row.pitchType, []);
    groups.get(row.pitchType).push(row);
  }
  for (const rows of groups.values()) {
    const veloStats = weightedSummaryStats(rows, "avgVelocity");
    const spinStats = weightedSummaryStats(rows, "avgSpin");
    const ivbStats = weightedSummaryStats(rows, "avgIvb");
    const hbStats = weightedSummaryStats(rows, "avgHb");
    const extStats = weightedSummaryStats(rows, "avgExtension");
    const vaaStats = weightedSummaryStats(rows, "avgVaa");
    const locationStats = weightedSummaryStats(rows, "rawLocationScore");
    const movementScores = rows.map((row) => Math.hypot(zscore(row.avgIvb, ivbStats.mean, ivbStats.sd), zscore(row.avgHb, hbStats.mean, hbStats.sd)));
    rows.forEach((row, index) => { row.rawMovementScore = movementScores[index]; });
    const moveStats = weightedSummaryStats(rows, "rawMovementScore");
    rows.forEach((row, index) => {
      const vaaDirection = ["ストレート", "シンカー", "カットボール"].includes(row.pitchType) ? 1 : -0.35;
      const shrinkage = row.pitches / (row.pitches + 20);
      const factors = [
        { key: "velocity", label: "球速", z: zscore(row.avgVelocity, veloStats.mean, veloStats.sd), weight: 0.45 },
        { key: "spin", label: "回転数", z: zscore(row.avgSpin, spinStats.mean, spinStats.sd), weight: 0.15 },
        { key: "extension", label: "エクステンション", z: zscore(row.avgExtension, extStats.mean, extStats.sd), weight: 0.15 },
        { key: "movement", label: "変化の独自性", z: zscore(movementScores[index], moveStats.mean, moveStats.sd), weight: 0.15 },
        { key: "vaa", label: "進入角", z: vaaDirection * zscore(row.avgVaa, vaaStats.mean, vaaStats.sd), weight: 0.10 },
      ].map((factor) => ({ ...factor, contribution: factor.z * factor.weight }));
      const rawScore = factors.reduce((sum, factor) => sum + factor.contribution, 0);
      row.stuffPlus = round(100 + 8 * rawScore * shrinkage, 1);
      row.locationPlus = round(100 + 8 * zscore(row.rawLocationScore, locationStats.mean, locationStats.sd) * shrinkage, 1);
      row.pitchingPlus = round((row.stuffPlus + row.locationPlus) / 2, 1);
      const ranked = [...factors].sort((a, b) => b.contribution - a.contribution);
      row.qualityStrength = ranked[0]?.label ?? "—";
      row.qualityRisk = ranked[ranked.length - 1]?.label ?? "—";
      row.qualityFactors = factors.map(({ key, label, z, contribution }) => ({ key, label, z: round(z, 2), contribution: round(contribution, 3) }));
      row.qualityConfidence = row.pitches >= 50 ? "高" : row.pitches >= 25 ? "中" : "低";
      row.qualityShrinkage = round(shrinkage, 3);
      delete row.rawMovementScore;
      delete row.rawLocationScore;
    });
  }

  const pitchTypesByPitcher = new Map();
  for (const row of pitchTypes) {
    if (!pitchTypesByPitcher.has(row.pitcherId)) pitchTypesByPitcher.set(row.pitcherId, []);
    pitchTypesByPitcher.get(row.pitcherId).push(row);
  }
  for (const pitcher of pitchers) {
    const rows = pitchTypesByPitcher.get(pitcher.id) ?? [];
    const total = rows.reduce((sum, row) => sum + row.pitches, 0) || 1;
    pitcher.stuffPlus = round(rows.reduce((sum, row) => sum + row.stuffPlus * row.pitches, 0) / total, 1);
    pitcher.locationPlus = round(rows.reduce((sum, row) => sum + row.locationPlus * row.pitches, 0) / total, 1);
    pitcher.pitchingPlus = round((pitcher.stuffPlus + pitcher.locationPlus) / 2, 1);
  }

  const pitcherModels = modelMap(options.modelPitchers);
  const pitchTypeModels = modelMap(options.modelPitchTypes, "pitchType");
  for (const pitcher of pitchers) {
    const match = pitcherModels.get(`${pitcher.name.toLowerCase()}|${pitcher.team}|`);
    if (!match) continue;
    pitcher.stuffPlus = round(num(match.StuffPlus), 1);
    pitcher.locationPlus = round(num(match.LocationPlus), 1);
    pitcher.pitchingPlus = round(num(match.PitchingPlus), 1);
    pitcher.pitchValuePer100 = round(num(match.PitchValuePer100), 2);
    pitcher.pitchValue = round(num(match.PitchValue), 2);
  }
  for (const row of pitchTypes) {
    const match = pitchTypeModels.get(`${row.pitcher.toLowerCase()}|${row.team}|${row.pitchType}`);
    if (!match) continue;
    row.stuffPlus = round(num(match.StuffPlus), 1);
    row.locationPlus = round(num(match.LocationPlus), 1);
    row.pitchingPlus = round(num(match.PitchingPlus), 1);
    row.pitchValuePer100 = round(num(match.PitchValuePer100), 2);
  }

  const catchers = [...catchersRaw.values()].map((raw) => {
    const framingAreas = Object.fromEntries(Object.entries(raw.framingAreas)
      .map(([key, value]) => [key, finalizeFramingAggregate(value)]));
    const framingHeatmaps = Object.fromEntries(Object.entries(raw.framingHeatmaps)
      .map(([side, cells]) => [side, cells.map(finalizeFramingAggregate)]));
    return decoratePlayerRow({
      id: raw.id, name: raw.name, team: raw.team, received: raw.received,
      calledPitches: raw.calledPitches, shadowPitches: raw.shadowPitches,
      actualStrikeRate: round(div(raw.actualStrikes, raw.shadowPitches), 3),
      expectedStrikeRate: round(div(raw.expectedStrikes, raw.shadowPitches), 3),
      extraStrikeRate: round(div(raw.extraStrikes, raw.shadowPitches), 3),
      extraStrikes: round(raw.extraStrikes, 1),
      framingRuns: round(raw.extraStrikes * 0.125, 1),
      framingPer1000: round(raw.shadowPitches ? raw.extraStrikes * 1000 / raw.shadowPitches : null, 1),
      popTimeSamples: raw.popTimes.length,
      avgPopTime: round(raw.popTimes.length ? raw.popTimes.reduce((sum, value) => sum + value, 0) / raw.popTimes.length : null, 3),
      fastestPopTime: round(raw.popTimes.length ? Math.min(...raw.popTimes) : null, 3),
      medianPopTime: round(quantile(raw.popTimes, 0.5), 3),
      lowExtraStrikes: framingAreas.low.extraStrikes,
      highExtraStrikes: framingAreas.high.extraStrikes,
      insideExtraStrikes: framingAreas.inside.extraStrikes,
      outsideExtraStrikes: framingAreas.outside.extraStrikes,
      framingAreas,
      framingHeatmaps,
    });
  });

  computePercentiles(batters.filter((row) => row.pa >= 20), [
    { key: "wrcPlus" }, { key: "xwoba" }, { key: "avgExitVelocity" }, { key: "maxExitVelocity" },
    { key: "hardHitRate" }, { key: "barrelRate" }, { key: "whiffRate", higher: false },
    { key: "chaseRate", higher: false },
  ]);
  computePercentiles(pitchers.filter((row) => row.pitches >= 100), [
    { key: "pitchingPlus" }, { key: "stuffPlus" }, { key: "locationPlus" },
    { key: "pitchValuePer100" }, { key: "xera", higher: false }, { key: "whiffRate" },
    { key: "cswRate" }, { key: "hardHitRateAllowed", higher: false },
  ]);
  computePercentiles(catchers.filter((row) => row.shadowPitches >= 100), [
    { key: "extraStrikes" }, { key: "framingRuns" }, { key: "framingPer1000" },
  ]);

  const games = [...gamesRaw.values()].sort((a, b) => `${b.date}|${b.id}`.localeCompare(`${a.date}|${a.id}`));
  const teamMap = new Map();
  for (const team of Object.values(TEAM_NAMES)) teamMap.set(team, { name: team, games: 0, wins: 0, losses: 0, ties: 0 });
  for (const game of games) {
    const home = teamMap.get(game.homeTeam) ?? { name: game.homeTeam, games: 0, wins: 0, losses: 0, ties: 0 };
    const away = teamMap.get(game.awayTeam) ?? { name: game.awayTeam, games: 0, wins: 0, losses: 0, ties: 0 };
    home.games += 1; away.games += 1;
    if (game.homeRuns > game.awayRuns) { home.wins += 1; away.losses += 1; }
    else if (game.homeRuns < game.awayRuns) { away.wins += 1; home.losses += 1; }
    else { home.ties += 1; away.ties += 1; }
    teamMap.set(home.name, home); teamMap.set(away.name, away);
  }
  for (const team of teamMap.values()) {
    const teamPitchers = pitchers.filter((row) => row.team === team.name);
    const pitchCount = teamPitchers.reduce((sum, row) => sum + row.pitches, 0) || 1;
    team.pitchingPlus = round(teamPitchers.reduce((sum, row) => sum + row.pitchingPlus * row.pitches, 0) / pitchCount, 1);
    team.pitchValuePer100 = round(teamPitchers.reduce((sum, row) => sum + row.pitchValue, 0) * 100 / pitchCount, 2);
    const teamBatters = batters.filter((row) => row.team === team.name);
    const pa = teamBatters.reduce((sum, row) => sum + row.pa, 0) || 1;
    team.wrcPlus = round(teamBatters.reduce((sum, row) => sum + (row.wrcPlus ?? 0) * row.pa, 0) / pa, 0);
    team.homeRuns = teamBatters.reduce((sum, row) => sum + row.homeRuns, 0);
  }
  const teams = [...teamMap.values()].filter((row) => row.games || pitchers.some((p) => p.team === row.name));

  const playersById = new Map();
  const ensurePlayer = (id, name, team) => {
    const master = playerMasterFor(team, name);
    if (!playersById.has(id)) playersById.set(id, {
      id, name: master?.roman ?? name, romanName: master?.roman ?? name,
      kanji: master?.kanji ?? "", aliases: master?.aliases ?? [name],
      nameSources: master?.sources ?? [], team, roles: [],
    });
    return playersById.get(id);
  };
  for (const row of batters) { const p = ensurePlayer(row.id, row.name, row.team); p.roles.push("打者"); p.batting = row; }
  for (const row of pitchers) { const p = ensurePlayer(row.id, row.name, row.team); p.roles.push("投手"); p.pitching = row; }
  for (const row of catchers) { const p = ensurePlayer(row.id, row.name, row.team); if (!p.roles.includes("捕手")) p.roles.push("捕手"); p.catching = row; }

  const eligiblePitchers = pitchers.filter((row) => row.pitches >= 100);
  const eligibleBatters = batters.filter((row) => row.pa >= 20);
  const eligiblePitchTypes = pitchTypes.filter((row) => row.pitches >= 25);
  const top = (rows, key, higher = true) => [...rows].filter((row) => Number.isFinite(row[key]))
    .sort((a, b) => higher ? b[key] - a[key] : a[key] - b[key])[0] ?? null;
  const normalizationPitchers = [...pitchTypeNormalizationByPitcher.values()]
    .map(({ fastballAvgVelocity, sinkerThreshold, ...row }) => ({
      ...row,
      fastballAvgVelocity: round(fastballAvgVelocity, 3),
      sinkerThreshold: round(sinkerThreshold, 3),
    }))
    .sort((a, b) => b.rawSinkerToFastball - a.rawSinkerToFastball || b.rawSinkerPitches - a.rawSinkerPitches);
  const pitchTypeNormalization = {
    version: "tohto-fastball-sinker-v1",
    rule: "Raw Fastball/Four-Seam/Sinkerのみ、PitchVelocity <= FastballAvgVelocity * 0.96 をSinker、それ以外をFastballとして分析",
    fastballVelocityRatio: FASTBALL_SINKER_VELOCITY_RATIO,
    season: datasetSeason,
    rawSinkerPitches: normalizationPitchers.reduce((sum, row) => sum + row.rawSinkerPitches, 0),
    rawSinkerToFastball: normalizationPitchers.reduce((sum, row) => sum + row.rawSinkerToFastball, 0),
    rawSinkerRetained: normalizationPitchers.reduce((sum, row) => sum + row.rawSinkerRetained, 0),
    rawFastballToSinker: normalizationPitchers.reduce((sum, row) => sum + row.rawFastballToSinker, 0),
    pitchers: normalizationPitchers,
  };

  return {
    schemaVersion: 7,
    metadata: {
      title: options.title ?? "東都大学野球 2026年春季リーグ戦",
      season: options.season ?? "2026年春季",
      sourceName: options.sourceName ?? "TrackMan CSV",
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      pitches: pitchSamples.length, games: games.length, teams: teams.length,
      pitchers: pitchers.length, batters: batters.length, catchers: catchers.length,
      battedBalls: contacts.length,
      officialBatting,
      battingRecordPolicy: officialBatting.matched
        ? "公式個人成績表の掲載選手は打席・打数・安打・長打・本塁打・三振などの公式記録を優先。打球・投球計測指標はTrackManを使用。"
        : "打撃成績はTrackManの打席終了結果から集計。",
      model: options.modelPitchers?.length ? "東都版球質・コースモデル v2" : "自動標準化モデル v2",
      pitchTypeNormalization,
      runnerState: {
        version: "tohto-runner-state-v1",
        source: "inferred",
        note: "TrackMan標準CSVに塁占有列がないため、打席結果・得点・アウトから各投球前の走者状況を推定。",
      },
    },
    league: {
      woba: round(leagueWoba, 3), xwoba: round(leagueExpectedWoba, 3),
      era: round(leagueEra, 2), hardHitThreshold: HARD_HIT_KMH,
      zone: ZONE,
    },
    teams,
    games,
    players: [...playersById.values()].sort((a, b) => a.name.localeCompare(b.name)),
    batters: batters.sort((a, b) => b.pa - a.pa),
    pitchers: pitchers.sort((a, b) => b.pitches - a.pitches),
    catchers: catchers.sort((a, b) => b.received - a.received),
    pitchTypes: pitchTypes.sort((a, b) => b.pitches - a.pitches),
    pitches: annotateRunnerStates(pitchSamples),
    highlights: {
      pitchingPlus: top(eligiblePitchers, "pitchingPlus"),
      battingProduction: top(eligibleBatters, "wrcPlus"),
      exitVelocity: top(eligibleBatters, "maxExitVelocity"),
      stuffPitch: top(eligiblePitchTypes, "stuffPlus"),
      command: top(eligiblePitchers, "locationPlus"),
      expectedBatting: top(eligibleBatters, "xwoba"),
    },
  };
}

export const analyticsConstants = {
  teamNames: TEAM_NAMES,
  pitchNames: PITCH_NAMES,
  fastballSinkerVelocityRatio: FASTBALL_SINKER_VELOCITY_RATIO,
  zone: ZONE,
  hardHitKmh: HARD_HIT_KMH,
};
