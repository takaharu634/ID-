/* eslint-disable @typescript-eslint/no-explicit-any */

export type ScoutingPitch = Record<string, any>;

export type ZoneBounds = {
  left: number;
  right: number;
  bottom: number;
  top: number;
};

export const DEFAULT_ZONE: ZoneBounds = { left: -0.254, right: 0.254, bottom: 0.45, top: 1.05 };
export const SCOUTING_DEFINITION_VERSION = "tohto-scouting-2026-09-v1";
export const DEFAULT_MINIMUM_SAMPLE = 5;

export const SCOUTING_DEFINITIONS = {
  swing: "空振り、ファウル、ファウルフライ、インプレーをスイングとして扱う。",
  strikeEquivalent: "見逃しストライク、空振り、ファウル、ファウルフライ、インプレーをストライク相当として扱う。",
  firstPitchSwingRate: "打席の1球目に対するスイング数÷打席の1球目の投球数。",
  firstStrikeSwingRate: "各打席で最初にストライク相当となった投球へのスイング数÷同投球数。初球とは別に判定する。",
  preTwoStrikeChaseRate: "投球前ストライク数が0または1のゾーン外投球へのスイング数÷同投球数。",
  twoStrikeChaseRate: "投球前ストライク数が2のゾーン外投球へのスイング数÷同投球数。",
  twoStrikeExpansion: "2ストライク時ボール球スイング率－追い込まれる前のボール球スイング率。",
  zoneSwingRate: "ゾーン内投球へのスイング数÷位置を確認できたゾーン内投球数。",
  contactRate: "ファウル、ファウルフライ、インプレーの合計÷スイング数。",
  whiffRate: "空振り数÷スイング数。",
  cswRate: "空振りまたは見逃しストライク数÷全投球数。",
  zoneRate: "ゾーン内投球数÷プレート通過位置を確認できた投球数。",
  chaseRate: "ゾーン外投球へのスイング数÷プレート通過位置を確認できたゾーン外投球数。",
} as const;

export type RateMetric = {
  numerator: number | null;
  denominator: number | null;
  value: number | null;
  unit: "rate" | "percentage-point";
  definition: string;
  definitionVersion: string;
  sampleStatus: "ok" | "reference" | "none";
  leagueAverage?: number | null;
  delta?: number | null;
  percentile?: number | null;
  comparisonDenominators?: { before: number; twoStrike: number };
};

export function isSwing(pitch: ScoutingPitch) {
  return ["空振り", "ファウル", "ファウルフライ", "インプレー"].includes(String(pitch.result ?? ""));
}

export function isContact(pitch: ScoutingPitch) {
  return ["ファウル", "ファウルフライ", "インプレー"].includes(String(pitch.result ?? ""));
}

export function isWhiff(pitch: ScoutingPitch) {
  return pitch.result === "空振り";
}

export function isCalledStrike(pitch: ScoutingPitch) {
  return pitch.result === "見逃しストライク";
}

export function isStrikeEquivalent(pitch: ScoutingPitch) {
  return isCalledStrike(pitch) || isSwing(pitch);
}

export function hasLocation(pitch: ScoutingPitch) {
  if (pitch.plateX === null || pitch.plateX === undefined || pitch.plateX === "" || pitch.plateZ === null || pitch.plateZ === undefined || pitch.plateZ === "") return false;
  return Number.isFinite(Number(pitch.plateX)) && Number.isFinite(Number(pitch.plateZ));
}

export function isInZone(pitch: ScoutingPitch, zone: ZoneBounds = DEFAULT_ZONE) {
  if (!hasLocation(pitch)) return false;
  const x = Number(pitch.plateX);
  const z = Number(pitch.plateZ);
  return x >= zone.left && x <= zone.right && z >= zone.bottom && z <= zone.top;
}

function endsPlateAppearance(pitch: ScoutingPitch) {
  if (["Walk", "Strikeout"].includes(String(pitch.korbb ?? ""))) return true;
  if (["死球", "敬遠"].includes(String(pitch.result ?? ""))) return true;
  if (pitch.result === "インプレー") return true;
  if (pitch.result === "ボール" && Number(pitch.balls) === 3) return true;
  if (["空振り", "見逃しストライク"].includes(String(pitch.result ?? "")) && Number(pitch.strikes) === 2) return true;
  const playResult = String(pitch.playResult ?? "");
  return Boolean(playResult && !["盗塁", "盗塁死"].includes(playResult));
}

export function annotatePlateAppearances(pitches: ScoutingPitch[]): ScoutingPitch[] {
  let sequence = 0;
  let currentContext = "";
  let firstStrikeSeen = false;
  let observedFromStart = false;
  let previous: ScoutingPitch | null = null;

  return pitches.map((pitch, index) => {
    const context = [pitch.gameId, pitch.inning, pitch.half, pitch.batterId].join("|");
    const countReset = Number(pitch.balls) === 0 && Number(pitch.strikes) === 0;
    const newAppearance = context !== currentContext || (countReset && Boolean(previous && endsPlateAppearance(previous)));
    if (newAppearance) {
      sequence += 1;
      currentContext = context;
      firstStrikeSeen = false;
      observedFromStart = countReset;
    }
    const firstPitch = newAppearance && countReset;
    const firstStrike = observedFromStart && !firstStrikeSeen && isStrikeEquivalent(pitch);
    if (firstStrike) firstStrikeSeen = true;
    previous = pitch;
    return {
      ...pitch,
      _paKey: observedFromStart ? `${context}|${sequence}` : null,
      _isPaFirstPitch: firstPitch,
      _isPaFirstStrike: firstStrike,
      _sourceIndex: index,
    };
  });
}

function sampleStatus(denominator: number | null, minimumSample: number) {
  if (!denominator) return "none" as const;
  return denominator < minimumSample ? "reference" as const : "ok" as const;
}

function rateMetric(
  pitches: ScoutingPitch[],
  denominatorPredicate: (pitch: ScoutingPitch) => boolean,
  numeratorPredicate: (pitch: ScoutingPitch) => boolean,
  definition: string,
  minimumSample: number,
): RateMetric {
  const denominatorRows = pitches.filter(denominatorPredicate);
  const denominator = denominatorRows.length;
  const numerator = denominatorRows.filter(numeratorPredicate).length;
  return {
    numerator,
    denominator,
    value: denominator ? numerator / denominator : null,
    unit: "rate",
    definition,
    definitionVersion: SCOUTING_DEFINITION_VERSION,
    sampleStatus: sampleStatus(denominator, minimumSample),
  };
}

export type ApproachMetrics = {
  firstPitchSwing: RateMetric;
  firstStrikeSwing: RateMetric;
  preTwoStrikeChase: RateMetric;
  twoStrikeChase: RateMetric;
  twoStrikeExpansion: RateMetric;
  zoneSwing: RateMetric;
  contact: RateMetric;
  whiff: RateMetric;
};

export function calculateApproachMetrics(
  pitches: ScoutingPitch[],
  minimumSample = DEFAULT_MINIMUM_SAMPLE,
  zone: ZoneBounds = DEFAULT_ZONE,
): ApproachMetrics {
  const firstPitchSwing = rateMetric(pitches, (pitch) => Boolean(pitch._isPaFirstPitch), isSwing, SCOUTING_DEFINITIONS.firstPitchSwingRate, minimumSample);
  const firstStrikeSwing = rateMetric(pitches, (pitch) => Boolean(pitch._isPaFirstStrike), isSwing, SCOUTING_DEFINITIONS.firstStrikeSwingRate, minimumSample);
  const preTwoStrikeChase = rateMetric(pitches, (pitch) => Number(pitch.strikes) < 2 && hasLocation(pitch) && !isInZone(pitch, zone), isSwing, SCOUTING_DEFINITIONS.preTwoStrikeChaseRate, minimumSample);
  const twoStrikeChase = rateMetric(pitches, (pitch) => Number(pitch.strikes) === 2 && hasLocation(pitch) && !isInZone(pitch, zone), isSwing, SCOUTING_DEFINITIONS.twoStrikeChaseRate, minimumSample);
  const expansionValue = preTwoStrikeChase.value === null || twoStrikeChase.value === null ? null : twoStrikeChase.value - preTwoStrikeChase.value;
  const twoStrikeExpansion: RateMetric = {
    numerator: null,
    denominator: null,
    value: expansionValue,
    unit: "percentage-point",
    definition: SCOUTING_DEFINITIONS.twoStrikeExpansion,
    definitionVersion: SCOUTING_DEFINITION_VERSION,
    sampleStatus: preTwoStrikeChase.denominator && twoStrikeChase.denominator
      ? (Math.min(preTwoStrikeChase.denominator, twoStrikeChase.denominator) < minimumSample ? "reference" : "ok")
      : "none",
    comparisonDenominators: { before: preTwoStrikeChase.denominator ?? 0, twoStrike: twoStrikeChase.denominator ?? 0 },
  };
  const zoneSwing = rateMetric(pitches, (pitch) => hasLocation(pitch) && isInZone(pitch, zone), isSwing, SCOUTING_DEFINITIONS.zoneSwingRate, minimumSample);
  const contact = rateMetric(pitches, isSwing, isContact, SCOUTING_DEFINITIONS.contactRate, minimumSample);
  const whiff = rateMetric(pitches, isSwing, isWhiff, SCOUTING_DEFINITIONS.whiffRate, minimumSample);
  return { firstPitchSwing, firstStrikeSwing, preTwoStrikeChase, twoStrikeChase, twoStrikeExpansion, zoneSwing, contact, whiff };
}

function percentile(value: number | null, values: number[]) {
  if (value === null || !values.length) return null;
  const belowOrEqual = values.filter((candidate) => candidate <= value).length;
  return Math.round((belowOrEqual / values.length) * 100);
}

function metricEligible(metric: RateMetric, minimumSample: number) {
  if (metric.unit === "percentage-point") {
    return Boolean(metric.comparisonDenominators && Math.min(metric.comparisonDenominators.before, metric.comparisonDenominators.twoStrike) >= minimumSample && metric.value !== null);
  }
  return Boolean((metric.denominator ?? 0) >= minimumSample && metric.value !== null);
}

function withBenchmark(metric: RateMetric, leagueMetric: RateMetric, distribution: number[]) {
  return {
    ...metric,
    leagueAverage: leagueMetric.value,
    delta: metric.value === null || leagueMetric.value === null ? null : metric.value - leagueMetric.value,
    percentile: percentile(metric.value, distribution),
  };
}

export type HeatCell = {
  id: string;
  row: number;
  column: number;
  label: string;
  numerator: number;
  denominator: number;
  value: number | null;
  inZone: boolean;
  sampleStatus: "ok" | "reference" | "none";
};

function heatmapCells(pitches: ScoutingPitch[], strikes: "before" | "two", minimumSample: number, zone: ZoneBounds): HeatCell[] {
  const size = 5;
  const zoneWidth = zone.right - zone.left;
  const zoneHeight = zone.top - zone.bottom;
  const xBounds = [-Infinity, zone.left, zone.left + zoneWidth / 3, zone.left + zoneWidth * 2 / 3, zone.right, Infinity];
  const zBounds = [Infinity, zone.top, zone.top - zoneHeight / 3, zone.top - zoneHeight * 2 / 3, zone.bottom, -Infinity];
  const eligible = pitches.filter((pitch) => hasLocation(pitch) && (strikes === "two" ? Number(pitch.strikes) === 2 : Number(pitch.strikes) < 2));
  const cells: HeatCell[] = [];
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const left = xBounds[column];
      const right = xBounds[column + 1];
      const top = zBounds[row];
      const bottom = zBounds[row + 1];
      const inZone = row >= 1 && row <= 3 && column >= 1 && column <= 3;
      const rows = eligible.filter((pitch) => {
        const x = Number(pitch.plateX), z = Number(pitch.plateZ);
        return x >= left && x < right && z >= bottom && z < top && !isInZone(pitch, zone);
      });
      const numerator = rows.filter(isSwing).length;
      cells.push({
        id: `${row}-${column}`,
        row,
        column,
        label: `${row + 1}行${column + 1}列`,
        numerator,
        denominator: rows.length,
        value: rows.length ? numerator / rows.length : null,
        inZone,
        sampleStatus: sampleStatus(rows.length, minimumSample),
      });
    }
  }
  return cells;
}

export function mainLocation(pitches: ScoutingPitch[], zone: ZoneBounds = DEFAULT_ZONE) {
  const valid = pitches.filter(hasLocation);
  if (!valid.length) return "—";
  const groups = new Map<string, number>();
  valid.forEach((pitch) => {
    const x = Number(pitch.plateX), z = Number(pitch.plateZ);
    const horizontal = x < zone.left ? "捕手から見て右外" : x > zone.right ? "捕手から見て左外" : x < -0.085 ? "捕手から見て右" : x > 0.085 ? "捕手から見て左" : "中央";
    const vertical = z < zone.bottom ? "低" : z > zone.top ? "高" : z < 0.65 ? "低め" : z > 0.85 ? "高め" : "中段";
    const label = `${horizontal}・${vertical}`;
    groups.set(label, (groups.get(label) ?? 0) + 1);
  });
  return [...groups.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "—";
}

export type PitchGroupSummary = {
  pitches: number;
  pitchMix: Array<{ pitchType: string; numerator: number; denominator: number; value: number | null }>;
  zone: RateMetric;
  whiff: RateMetric;
  csw: RateMetric;
  chase: RateMetric;
  avgVelocity: number | null;
  avgIvb: number | null;
  avgHb: number | null;
  mainLocation: string;
};

function average(pitches: ScoutingPitch[], key: string) {
  const values = pitches.map((pitch) => Number(pitch[key])).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function summarizePitchGroup(pitches: ScoutingPitch[], minimumSample = DEFAULT_MINIMUM_SAMPLE, zone: ZoneBounds = DEFAULT_ZONE): PitchGroupSummary {
  const pitchCounts = new Map<string, number>();
  pitches.forEach((pitch) => pitchCounts.set(String(pitch.pitchType ?? "不明"), (pitchCounts.get(String(pitch.pitchType ?? "不明")) ?? 0) + 1));
  const pitchMix = [...pitchCounts.entries()].map(([pitchType, numerator]) => ({ pitchType, numerator, denominator: pitches.length, value: pitches.length ? numerator / pitches.length : null })).sort((a, b) => b.numerator - a.numerator || a.pitchType.localeCompare(b.pitchType, "ja"));
  return {
    pitches: pitches.length,
    pitchMix,
    zone: rateMetric(pitches, hasLocation, (pitch) => isInZone(pitch, zone), SCOUTING_DEFINITIONS.zoneRate, minimumSample),
    whiff: rateMetric(pitches, isSwing, isWhiff, SCOUTING_DEFINITIONS.whiffRate, minimumSample),
    csw: rateMetric(pitches, () => true, (pitch) => isWhiff(pitch) || isCalledStrike(pitch), SCOUTING_DEFINITIONS.cswRate, minimumSample),
    chase: rateMetric(pitches, (pitch) => hasLocation(pitch) && !isInZone(pitch, zone), isSwing, SCOUTING_DEFINITIONS.chaseRate, minimumSample),
    avgVelocity: average(pitches, "velocity"),
    avgIvb: average(pitches, "ivb"),
    avgHb: average(pitches, "hb"),
    mainLocation: mainLocation(pitches, zone),
  };
}

export const COUNT_GROUPS = [
  { key: "first", label: "初球 0-0", counts: ["0-0"] },
  { key: "hitter", label: "打者有利", counts: ["1-0", "2-0", "3-0", "2-1", "3-1"] },
  { key: "pitcher", label: "投手有利", counts: ["0-1", "0-2", "1-2"] },
  { key: "twoStrike", label: "2ストライク", counts: ["0-2", "1-2", "2-2", "3-2"] },
] as const;

export function buildCountReport(pitches: ScoutingPitch[], minimumSample = DEFAULT_MINIMUM_SAMPLE, zone: ZoneBounds = DEFAULT_ZONE) {
  const counts = ["0-0", "1-0", "2-0", "3-0", "0-1", "1-1", "2-1", "3-1", "0-2", "1-2", "2-2", "3-2"];
  return {
    definitionVersion: SCOUTING_DEFINITION_VERSION,
    counts: counts.map((count) => ({ count, ...summarizePitchGroup(pitches.filter((pitch) => `${pitch.balls}-${pitch.strikes}` === count), minimumSample, zone) })),
    groups: COUNT_GROUPS.map((group) => ({ ...group, ...summarizePitchGroup(pitches.filter((pitch) => group.counts.includes(`${pitch.balls}-${pitch.strikes}` as never)), minimumSample, zone) })),
  };
}

export function buildPitcherSideReport(pitches: ScoutingPitch[], minimumSample = DEFAULT_MINIMUM_SAMPLE, zone: ZoneBounds = DEFAULT_ZONE) {
  const sides = ["右", "左"].map((side) => {
    const sidePitches = pitches.filter((pitch) => pitch.batterSide === side);
    const summary = summarizePitchGroup(sidePitches, minimumSample, zone);
    return {
      side,
      summary,
      pitchTypes: summary.pitchMix.map((mix) => ({ ...mix, ...summarizePitchGroup(sidePitches.filter((pitch) => pitch.pitchType === mix.pitchType), minimumSample, zone) })),
    };
  });
  const right = sides[0], left = sides[1];
  const differences: string[] = [];
  if (right.summary.pitches >= minimumSample && left.summary.pitches >= minimumSample) {
    const allTypes = [...new Set([...right.summary.pitchMix.map((row) => row.pitchType), ...left.summary.pitchMix.map((row) => row.pitchType)])];
    allTypes.forEach((pitchType) => {
      const r = right.summary.pitchMix.find((row) => row.pitchType === pitchType)?.value ?? 0;
      const l = left.summary.pitchMix.find((row) => row.pitchType === pitchType)?.value ?? 0;
      const delta = r - l;
      if (Math.abs(delta) >= 0.1) differences.push(`対${delta > 0 ? "右" : "左"}では${pitchType}が${Math.abs(delta * 100).toFixed(0)}ポイント多い`);
    });
    const metricDifferences: Array<[string, RateMetric, RateMetric]> = [
      ["空振り率", right.summary.whiff, left.summary.whiff],
      ["CSW%", right.summary.csw, left.summary.csw],
      ["Chase%", right.summary.chase, left.summary.chase],
      ["ゾーン率", right.summary.zone, left.summary.zone],
    ];
    metricDifferences.forEach(([label, r, l]) => {
      if (r.sampleStatus !== "ok" || l.sampleStatus !== "ok" || r.value === null || l.value === null) return;
      const delta = r.value - l.value;
      if (Math.abs(delta) >= 0.08) differences.push(`対${delta > 0 ? "右" : "左"}の${label}が${Math.abs(delta * 100).toFixed(0)}ポイント高い`);
    });
  }
  return { definitionVersion: SCOUTING_DEFINITION_VERSION, sides, differences: differences.slice(0, 4) };
}

export function buildBatterApproachReport(
  playerPitches: ScoutingPitch[],
  leaguePitches: ScoutingPitch[],
  minimumSample = DEFAULT_MINIMUM_SAMPLE,
  zone: ZoneBounds = DEFAULT_ZONE,
) {
  const playerMetrics = calculateApproachMetrics(playerPitches, minimumSample, zone);
  const leagueMetrics = calculateApproachMetrics(leaguePitches, minimumSample, zone);
  const leagueByBatter = new Map<string, ScoutingPitch[]>();
  leaguePitches.forEach((pitch) => {
    const key = String(pitch.batterId ?? "");
    if (!key) return;
    const rows = leagueByBatter.get(key) ?? [];
    rows.push(pitch);
    leagueByBatter.set(key, rows);
  });
  const distributions = [...leagueByBatter.values()].map((rows) => calculateApproachMetrics(rows, minimumSample, zone));
  const metrics = Object.fromEntries(Object.entries(playerMetrics).map(([key, metric]) => {
    const values = distributions.map((row) => row[key as keyof ApproachMetrics]).filter((candidate) => metricEligible(candidate, minimumSample)).map((candidate) => candidate.value as number);
    return [key, withBenchmark(metric, leagueMetrics[key as keyof ApproachMetrics], values)];
  })) as ApproachMetrics;

  const pitchTypes = [...new Set(playerPitches.map((pitch) => String(pitch.pitchType ?? "不明")))];
  const pitchTypeRows = pitchTypes.map((pitchType) => {
    const player = calculateApproachMetrics(playerPitches.filter((pitch) => pitch.pitchType === pitchType), minimumSample, zone);
    const league = calculateApproachMetrics(leaguePitches.filter((pitch) => pitch.pitchType === pitchType), minimumSample, zone);
    const compared = Object.fromEntries(Object.entries(player).map(([key, metric]) => [key, withBenchmark(metric, league[key as keyof ApproachMetrics], [])])) as ApproachMetrics;
    const relevance = Math.max(...Object.values(player).map((metric) => metric.denominator ?? Math.min(metric.comparisonDenominators?.before ?? 0, metric.comparisonDenominators?.twoStrike ?? 0)));
    return { pitchType, relevance, metrics: compared };
  }).filter((row) => row.relevance > 0).sort((a, b) => b.relevance - a.relevance || a.pitchType.localeCompare(b.pitchType, "ja"));

  const summaries: string[] = [];
  const firstPitchTarget = pitchTypeRows.filter((row) => row.metrics.firstPitchSwing.sampleStatus === "ok" && (row.metrics.firstPitchSwing.delta ?? 0) >= 0.1).sort((a, b) => (b.metrics.firstPitchSwing.delta ?? 0) - (a.metrics.firstPitchSwing.delta ?? 0))[0];
  if (firstPitchTarget) summaries.push(`初球は${firstPitchTarget.pitchType}へのスイングがリーグ平均より${((firstPitchTarget.metrics.firstPitchSwing.delta ?? 0) * 100).toFixed(0)}ポイント高い`);
  const firstStrikeTake = pitchTypeRows.filter((row) => row.metrics.firstStrikeSwing.sampleStatus === "ok" && (row.metrics.firstStrikeSwing.delta ?? 0) <= -0.1).sort((a, b) => (a.metrics.firstStrikeSwing.delta ?? 0) - (b.metrics.firstStrikeSwing.delta ?? 0))[0];
  if (firstStrikeTake) summaries.push(`最初の${firstStrikeTake.pitchType}ストライクはリーグ平均より見送る傾向`);
  if (metrics.twoStrikeExpansion.sampleStatus === "ok" && (metrics.twoStrikeExpansion.value ?? 0) >= 0.12) summaries.push(`2ストライク後はゾーン外スイング率が${((metrics.twoStrikeExpansion.value ?? 0) * 100).toFixed(0)}ポイント上がる`);
  if (metrics.preTwoStrikeChase.sampleStatus === "ok" && (metrics.preTwoStrikeChase.delta ?? 0) <= -0.1) summaries.push("追い込まれる前はリーグ平均よりボール球を見送る");
  const chaseTarget = pitchTypeRows.filter((row) => row.metrics.twoStrikeChase.sampleStatus === "ok" && (row.metrics.twoStrikeChase.delta ?? 0) >= 0.1).sort((a, b) => (b.metrics.twoStrikeChase.delta ?? 0) - (a.metrics.twoStrikeChase.delta ?? 0))[0];
  if (chaseTarget) summaries.push(`2ストライク後は${chaseTarget.pitchType}のボール球へのスイングがリーグ平均より多い`);

  const handedness = ["右", "左"].map((throws) => ({
    throws,
    pitches: playerPitches.filter((pitch) => pitch.pitcherThrows === throws).length,
    metrics: calculateApproachMetrics(playerPitches.filter((pitch) => pitch.pitcherThrows === throws), minimumSample, zone),
  }));
  const rightHanded = handedness[0], leftHanded = handedness[1];
  const handednessDifferences: string[] = [];
  const handedMetrics: Array<[string, keyof ApproachMetrics]> = [
    ["初球Swing%", "firstPitchSwing"], ["First Strike Swing%", "firstStrikeSwing"],
    ["追込前Chase%", "preTwoStrikeChase"], ["2S Chase%", "twoStrikeChase"], ["Whiff%", "whiff"],
  ];
  handedMetrics.forEach(([label, key]) => {
    const rightMetric = rightHanded.metrics[key], leftMetric = leftHanded.metrics[key];
    if (rightMetric.sampleStatus !== "ok" || leftMetric.sampleStatus !== "ok" || rightMetric.value === null || leftMetric.value === null) return;
    const delta = rightMetric.value - leftMetric.value;
    if (Math.abs(delta) >= 0.1) handednessDifferences.push(`対${delta > 0 ? "右" : "左"}投手の${label}が${Math.abs(delta * 100).toFixed(0)}ポイント高い`);
  });
  summaries.push(...handednessDifferences.slice(0, Math.max(0, 4 - summaries.length)));

  return {
    definitionVersion: SCOUTING_DEFINITION_VERSION,
    minimumSample,
    pitches: playerPitches.length,
    plateAppearances: new Set(playerPitches.map((pitch) => pitch._paKey).filter(Boolean)).size,
    metrics,
    pitchTypes: pitchTypeRows,
    heatmaps: {
      beforeTwoStrikes: heatmapCells(playerPitches, "before", minimumSample, zone),
      twoStrikes: heatmapCells(playerPitches, "two", minimumSample, zone),
    },
    handedness,
    handednessDifferences,
    summaries: summaries.length ? summaries.slice(0, 4) : ["現在の条件では、母数を満たす顕著なリーグ平均との差はありません。"],
  };
}
