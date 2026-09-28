import { measuredNumber } from "./numeric-summary.ts";
import {
  DEFAULT_ZONE,
  SCOUTING_DEFINITIONS,
  SCOUTING_DEFINITION_VERSION,
  hasLocation,
  isCalledStrike,
  isContact,
  isInZone,
  isSwing,
  isWhiff,
  type ScoutingPitch,
  type ZoneBounds,
} from "./scouting-analytics.ts";

export const BATTER_PROFILE_DEFINITION_VERSION = "tohto-batter-profile-2026-09-v1";

export const BATTER_PROFILE_DEFINITIONS = {
  ...SCOUTING_DEFINITIONS,
  zoneContactRate: "ゾーン内のファウルまたはインプレー数÷ゾーン内スイング数。",
  chaseContactRate: "ゾーン外のファウルまたはインプレー数÷ゾーン外スイング数。",
  calledStrikeRate: "見逃しストライク数÷全投球数。",
  foulRate: "ファウル・ファウルフライ数÷全スイング数。",
  validBattedBall: "インプレーかつ正の打球速度を計測でき、バント・追跡失敗・無効値ではない打球。",
  strongContactEv: "有効打球のうち打球速度上位50%の平均。",
  hardHitRate: "選択シーズンの東都リーグ全有効打球速度の75パーセンタイル以上となった打球数÷有効打球数。",
  movementDirection: "TrackManの横変化量を打者左右へ変換し、打者側へ10cm以上を『入る』、打者から10cm以上離れるものを『逃げる』、10cm未満を『ほぼ真っすぐ』とする。",
} as const;

export type Confidence = "判定しない" | "低" | "中" | "高";
export type Rating = "得意" | "やや得意" | "平均的" | "やや苦手" | "苦手" | "特徴混在" | "データ不足";

export type ProfileMetric = {
  numerator: number | null;
  denominator: number;
  value: number | null;
  unit: "rate" | "km/h" | "count";
  definition: string;
  definitionVersion: string;
  sampleKind: "pitch" | "swing" | "battedBall";
  confidence: Confidence;
  leagueAverage?: number | null;
  delta?: number | null;
};

export type ProfileMetrics = {
  firstPitchSwing: ProfileMetric;
  swing: ProfileMetric;
  zoneSwing: ProfileMetric;
  chase: ProfileMetric;
  contact: ProfileMetric;
  zoneContact: ProfileMetric;
  chaseContact: ProfileMetric;
  whiff: ProfileMetric;
  calledStrike: ProfileMetric;
  foul: ProfileMetric;
  avgExitVelocity: ProfileMetric;
  medianExitVelocity: ProfileMetric;
  maxExitVelocity: ProfileMetric;
  strongContactEv: ProfileMetric;
  hardHit: ProfileMetric;
  battingAverage: ProfileMetric;
  sluggingPercentage: ProfileMetric;
};

export type StrongContactThreshold = { season: string; value: number | null; n: number };

export const PITCH_GROUP_ORDER = ["直球系", "動く速球系", "横変化系", "縦変化系", "落ち球系", "チェンジ系", "その他"];

export function pitchGroup(pitchType: unknown) {
  const type = String(pitchType ?? "").normalize("NFKC").toLowerCase().replace(/[\s_-]/g, "");
  if (["ストレート", "fastball", "fourseam", "4seam", "フォーシーム"].includes(type)) return "直球系";
  if (["カットボール", "cutter", "シンカー", "sinker", "ツーシーム", "twoseam"].includes(type)) return "動く速球系";
  if (["スライダー", "slider", "スイーパー", "sweeper"].includes(type)) return "横変化系";
  if (["カーブ", "curve", "curveball"].includes(type)) return "縦変化系";
  if (["フォーク", "fork", "スプリット", "splitter", "split"].includes(type)) return "落ち球系";
  if (["チェンジアップ", "changeup", "change"].includes(type)) return "チェンジ系";
  return "その他";
}

export function seasonKey(pitch: ScoutingPitch) {
  const year = String(pitch.year ?? "").trim();
  const season = String(pitch.season ?? "").trim();
  return [year && `${year}年`, season].filter(Boolean).join("") || "選択期間";
}

function normalizedHitType(pitch: ScoutingPitch) {
  return String(pitch.hitType ?? "").normalize("NFKC").toLowerCase().replace(/[\s_-]/g, "");
}

export function isValidBattedBall(pitch: ScoutingPitch) {
  const ev = Number(pitch.exitVelocity);
  if (pitch.result !== "インプレー" || !Number.isFinite(ev) || ev <= 0 || ev > 220) return false;
  const hitType = normalizedHitType(pitch);
  return !hitType.includes("bunt") && !hitType.includes("sacrifice") && !hitType.includes("バント") && !["undefined", "null", "nan"].includes(String(pitch.exitVelocity).toLowerCase());
}

export function quantile(values: number[], q: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function buildStrongContactThresholds(pitches: ScoutingPitch[]): StrongContactThreshold[] {
  const bySeason = new Map<string, number[]>();
  pitches.filter(isValidBattedBall).forEach((pitch) => {
    const key = seasonKey(pitch);
    const values = bySeason.get(key) ?? [];
    values.push(Number(pitch.exitVelocity));
    bySeason.set(key, values);
  });
  return [...bySeason.entries()].map(([season, values]) => ({ season, value: quantile(values, .75), n: values.length })).sort((a, b) => a.season.localeCompare(b.season, "ja"));
}

function thresholdMap(thresholds: StrongContactThreshold[]) {
  return new Map(thresholds.map((row) => [row.season, row.value]));
}

export function confidenceFor(n: number, kind: ProfileMetric["sampleKind"]): Confidence {
  if (kind === "swing") return n < 8 ? "判定しない" : n < 15 ? "低" : n < 30 ? "中" : "高";
  if (kind === "battedBall") return n < 5 ? "判定しない" : n < 10 ? "低" : n < 20 ? "中" : "高";
  return n < 15 ? "判定しない" : n < 30 ? "低" : n < 60 ? "中" : "高";
}

function metric(numerator: number, denominator: number, definition: string, sampleKind: ProfileMetric["sampleKind"]): ProfileMetric {
  return { numerator, denominator, value: denominator ? numerator / denominator : null, unit: "rate", definition, definitionVersion: BATTER_PROFILE_DEFINITION_VERSION, sampleKind, confidence: confidenceFor(denominator, sampleKind) };
}

function averageMetric(values: number[], definition: string): ProfileMetric {
  return { numerator: values.length ? values.reduce((sum, value) => sum + value, 0) : null, denominator: values.length, value: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null, unit: "km/h", definition, definitionVersion: BATTER_PROFILE_DEFINITION_VERSION, sampleKind: "battedBall", confidence: confidenceFor(values.length, "battedBall") };
}

function fixedValueMetric(value: number | null, denominator: number, definition: string, unit: ProfileMetric["unit"] = "km/h"): ProfileMetric {
  return { numerator: value, denominator, value, unit, definition, definitionVersion: BATTER_PROFILE_DEFINITION_VERSION, sampleKind: "battedBall", confidence: confidenceFor(denominator, "battedBall") };
}

function topHalfAverage(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => b - a);
  const top = sorted.slice(0, Math.ceil(sorted.length / 2));
  return top.reduce((sum, value) => sum + value, 0) / top.length;
}

function terminalAtBats(pitches: ScoutingPitch[]) {
  return pitches.filter((pitch) => {
    if (pitch.result === "インプレー") return !["犠打", "犠飛", "犠打・犠飛"].includes(String(pitch.playResult ?? ""));
    if (String(pitch.korbb ?? "") === "Strikeout") return true;
    return Number(pitch.strikes) === 2 && ["空振り", "見逃しストライク"].includes(String(pitch.result ?? ""));
  });
}

export function calculateProfileMetrics(pitches: ScoutingPitch[], thresholds: StrongContactThreshold[], zone: ZoneBounds = DEFAULT_ZONE): ProfileMetrics {
  const swings = pitches.filter(isSwing);
  const zonePitches = pitches.filter((pitch) => hasLocation(pitch) && isInZone(pitch, zone));
  const chasePitches = pitches.filter((pitch) => hasLocation(pitch) && !isInZone(pitch, zone));
  const zoneSwings = zonePitches.filter(isSwing);
  const chaseSwings = chasePitches.filter(isSwing);
  const batted = pitches.filter(isValidBattedBall);
  const evs = batted.map((pitch) => Number(pitch.exitVelocity));
  const thresholdsBySeason = thresholdMap(thresholds);
  const hardHit = batted.filter((pitch) => {
    const threshold = thresholdsBySeason.get(seasonKey(pitch));
    return threshold !== null && threshold !== undefined && Number(pitch.exitVelocity) >= threshold;
  });
  const atBats = terminalAtBats(pitches);
  const hits = atBats.filter((pitch) => ["単打", "二塁打", "三塁打", "本塁打"].includes(String(pitch.playResult ?? "")));
  const totalBases = atBats.reduce((sum, pitch) => sum + ({ "単打": 1, "二塁打": 2, "三塁打": 3, "本塁打": 4 }[String(pitch.playResult ?? "")] ?? 0), 0);
  const sortedEvs = [...evs].sort((a, b) => a - b);
  return {
    firstPitchSwing: metric(pitches.filter((pitch) => pitch._isPaFirstPitch && isSwing(pitch)).length, pitches.filter((pitch) => pitch._isPaFirstPitch).length, SCOUTING_DEFINITIONS.firstPitchSwingRate, "pitch"),
    swing: metric(swings.length, pitches.length, SCOUTING_DEFINITIONS.swing, "pitch"),
    zoneSwing: metric(zoneSwings.length, zonePitches.length, SCOUTING_DEFINITIONS.zoneSwingRate, "pitch"),
    chase: metric(chaseSwings.length, chasePitches.length, SCOUTING_DEFINITIONS.chaseRate, "pitch"),
    contact: metric(swings.filter(isContact).length, swings.length, SCOUTING_DEFINITIONS.contactRate, "swing"),
    zoneContact: metric(zoneSwings.filter(isContact).length, zoneSwings.length, BATTER_PROFILE_DEFINITIONS.zoneContactRate, "swing"),
    chaseContact: metric(chaseSwings.filter(isContact).length, chaseSwings.length, BATTER_PROFILE_DEFINITIONS.chaseContactRate, "swing"),
    whiff: metric(swings.filter(isWhiff).length, swings.length, SCOUTING_DEFINITIONS.whiffRate, "swing"),
    calledStrike: metric(pitches.filter(isCalledStrike).length, pitches.length, BATTER_PROFILE_DEFINITIONS.calledStrikeRate, "pitch"),
    foul: metric(swings.filter((pitch) => ["ファウル", "ファウルフライ"].includes(String(pitch.result))).length, swings.length, BATTER_PROFILE_DEFINITIONS.foulRate, "swing"),
    avgExitVelocity: averageMetric(evs, "有効打球の平均打球速度。"),
    medianExitVelocity: fixedValueMetric(quantile(sortedEvs, .5), evs.length, "有効打球速度の中央値。"),
    maxExitVelocity: fixedValueMetric(sortedEvs.at(-1) ?? null, evs.length, "有効打球の最大打球速度。"),
    strongContactEv: fixedValueMetric(topHalfAverage(evs), evs.length, BATTER_PROFILE_DEFINITIONS.strongContactEv),
    hardHit: metric(hardHit.length, batted.length, BATTER_PROFILE_DEFINITIONS.hardHitRate, "battedBall"),
    battingAverage: metric(hits.length, atBats.length, "インプレー結果から算出した安打数÷打数。正式成績表示には既存ページの値を使用する。", "battedBall"),
    sluggingPercentage: fixedValueMetric(atBats.length ? totalBases / atBats.length : null, atBats.length, "インプレー結果から算出した塁打数÷打数。", "count"),
  };
}

function withLeague(player: ProfileMetric, league: ProfileMetric) {
  return { ...player, leagueAverage: league.value, delta: player.value === null || league.value === null ? null : player.value - league.value };
}

export function compareProfileMetrics(player: ProfileMetrics, league: ProfileMetrics): ProfileMetrics {
  return Object.fromEntries(Object.entries(player).map(([key, value]) => [key, withLeague(value, league[key as keyof ProfileMetrics])])) as ProfileMetrics;
}

function axisScore(metric: ProfileMetric, goodDirection: "higher" | "lower", rateThreshold = .05, numericThreshold = 4) {
  if (metric.confidence === "判定しない" || metric.delta === null || metric.delta === undefined) return 0;
  const threshold = metric.unit === "km/h" ? numericThreshold : rateThreshold;
  const adjusted = goodDirection === "higher" ? metric.delta : -metric.delta;
  return adjusted >= threshold ? 1 : adjusted <= -threshold ? -1 : 0;
}

export function combinedRating(metrics: ProfileMetrics): Rating {
  const discipline = axisScore(metrics.chase, "lower");
  const contact = axisScore(metrics.contact, "higher");
  const quality = axisScore(metrics.hardHit, "higher", .07);
  const available = [metrics.chase, metrics.contact, metrics.hardHit].filter((row) => row.confidence !== "判定しない" && row.value !== null).length;
  if (available < 2) return "データ不足";
  const positives = [discipline, contact, quality].filter((value) => value > 0).length;
  const negatives = [discipline, contact, quality].filter((value) => value < 0).length;
  if (positives >= 2) return positives === 3 ? "得意" : "やや得意";
  if (negatives >= 2) return negatives === 3 ? "苦手" : "やや苦手";
  if (positives && negatives) return "特徴混在";
  return "平均的";
}

function mostCommon<T>(values: T[]) {
  const counts = new Map<T, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function hitShape(pitch: ScoutingPitch) {
  const raw = normalizedHitType(pitch);
  if (raw.includes("ground")) return "ゴロ";
  if (raw.includes("line")) return "ライナー";
  if (raw.includes("popup") || raw.includes("popfly")) return "ポップフライ";
  if (raw.includes("fly")) return "フライ";
  const launchAngle = measuredNumber(pitch.launchAngle);
  if (launchAngle !== null) {
    if (launchAngle < 5) return "ゴロ";
    if (launchAngle < 18) return "ライナー";
    if (launchAngle >= 50) return "ポップフライ";
    return "フライ";
  }
  return "その他";
}

export function sprayDirection(pitch: ScoutingPitch, batterSide: string) {
  const direction = measuredNumber(pitch.sprayAngle) ?? measuredNumber(pitch.direction);
  if (direction === null || Math.abs(direction) > 45) return null;
  if (Math.abs(direction) <= 15) return "センター";
  const pull = batterSide === "左" ? direction > 15 : direction < -15;
  return pull ? "引っ張り" : "逆方向";
}

export function movementDirection(pitch: ScoutingPitch) {
  const hb = measuredNumber(pitch.hb);
  if (hb === null) return null;
  const toward = hb * (pitch.batterSide === "左" ? -1 : 1);
  if (Math.abs(toward) < 10) return "ほぼ真っすぐ";
  return toward > 0 ? "打者へ入る" : "打者から逃げる";
}

export function movementMagnitude(pitch: ScoutingPitch) {
  const hb = measuredNumber(pitch.hb);
  if (hb === null) return null;
  const value = Math.abs(hb);
  if (value < 10) return "10cm未満";
  if (value < 20) return "10～20cm";
  if (value < 30) return "20～30cm";
  return "30cm以上";
}

function zoneCell(pitch: ScoutingPitch, batterSide: string) {
  if (!hasLocation(pitch)) return null;
  const x = Number(pitch.plateX), z = Number(pitch.plateZ);
  const screenColumn = x < -.085 ? 0 : x > .085 ? 2 : 1;
  const column = batterSide === "左" ? 2 - screenColumn : screenColumn;
  const row = z > .85 ? 0 : z < .65 ? 2 : 1;
  return { index: row * 3 + column, horizontal: ["外角", "中央", "内角"][column], vertical: ["高め", "中段", "低め"][row] };
}

/** Keep aggregation batter-relative, but render each row in physical catcher-view order. */
export function catcherViewZoneOrder<T extends { index: number }>(zones: T[], batterSide: string) {
  return [...zones].sort((a, b) => {
    const aRow = Math.floor(a.index / 3), bRow = Math.floor(b.index / 3);
    if (aRow !== bRow) return aRow - bRow;
    const aColumn = a.index % 3, bColumn = b.index % 3;
    const aCatcherColumn = batterSide === "右" ? 2 - aColumn : aColumn;
    const bCatcherColumn = batterSide === "右" ? 2 - bColumn : bColumn;
    return aCatcherColumn - bCatcherColumn;
  });
}

function summarizeSplit(rows: ScoutingPitch[], thresholds: StrongContactThreshold[], zone: ZoneBounds, leagueRows: ScoutingPitch[]) {
  const playerMetrics = calculateProfileMetrics(rows, thresholds, zone);
  const leagueMetrics = calculateProfileMetrics(leagueRows, thresholds, zone);
  return { pitches: rows.length, metrics: compareProfileMetrics(playerMetrics, leagueMetrics), rating: combinedRating(compareProfileMetrics(playerMetrics, leagueMetrics)) };
}

function spraySplit(rows: ScoutingPitch[], pitcherThrows: string, thresholds: StrongContactThreshold[]) {
  const batted = rows.filter((pitch) => pitch.pitcherThrows === pitcherThrows && isValidBattedBall(pitch));
  const directions = batted.map((pitch) => sprayDirection(pitch, String(pitch.batterSide))).filter(Boolean);
  const shapes = batted.map(hitShape);
  const share = (values: string[], name: string) => values.length ? values.filter((value) => value === name).length / values.length : null;
  const metrics = calculateProfileMetrics(batted, thresholds);
  return {
    pitcherThrows,
    n: batted.length,
    pullRate: share(directions as string[], "引っ張り"),
    centerRate: share(directions as string[], "センター"),
    oppositeRate: share(directions as string[], "逆方向"),
    groundRate: share(shapes, "ゴロ"),
    lineRate: share(shapes, "ライナー"),
    flyRate: share(shapes, "フライ"),
    popupRate: share(shapes, "ポップフライ"),
    avgExitVelocity: metrics.avgExitVelocity.value,
    hardHitRate: metrics.hardHit.value,
    points: batted.flatMap((pitch) => {
      const direction = measuredNumber(pitch.sprayAngle) ?? measuredNumber(pitch.direction);
      if (direction === null || Math.abs(direction) > 45 || typeof pitch.distance !== "number" || !Number.isFinite(pitch.distance) || pitch.distance < 0) return [];
      return [{ direction, distance: pitch.distance, exitVelocity: Number(pitch.exitVelocity), shape: hitShape(pitch) }];
    }),
  };
}

function buildTags(metrics: ProfileMetrics, pitches: ScoutingPitch[], spray: ReturnType<typeof spraySplit>[]) {
  const candidates: Array<{ label: string; score: number; reason: string }> = [];
  const add = (label: string, score: number, reason: string) => candidates.push({ label, score: Math.abs(score), reason });
  if (metrics.swing.delta !== null && metrics.swing.delta !== undefined && metrics.swing.confidence !== "判定しない" && Math.abs(metrics.swing.delta) >= .05) add(metrics.swing.delta > 0 ? "積極型" : "選球型", metrics.swing.delta, `Swing% ${(metrics.swing.value! * 100).toFixed(1)}%／リーグ平均 ${(metrics.swing.leagueAverage! * 100).toFixed(1)}%／差 ${(metrics.swing.delta * 100).toFixed(1)}pt／n=${metrics.swing.denominator}`);
  if (metrics.contact.delta !== null && metrics.contact.delta !== undefined && metrics.contact.confidence !== "判定しない" && Math.abs(metrics.contact.delta) >= .05) add(metrics.contact.delta > 0 ? "コンタクト型" : "空振りが多い", metrics.contact.delta, `Contact% ${(metrics.contact.value! * 100).toFixed(1)}%／リーグ平均 ${(metrics.contact.leagueAverage! * 100).toFixed(1)}%／差 ${(metrics.contact.delta * 100).toFixed(1)}pt／n=${metrics.contact.denominator}`);
  if (metrics.hardHit.delta !== null && metrics.hardHit.delta !== undefined && metrics.hardHit.confidence !== "判定しない" && metrics.hardHit.delta >= .07) add("強打型", metrics.hardHit.delta, `強い打球率 ${(metrics.hardHit.value! * 100).toFixed(1)}%／リーグ平均 ${(metrics.hardHit.leagueAverage! * 100).toFixed(1)}%／差 +${(metrics.hardHit.delta * 100).toFixed(1)}pt／n=${metrics.hardHit.denominator}`);
  const shapes = pitches.filter(isValidBattedBall).map(hitShape);
  if (shapes.length >= 10) {
    const ground = shapes.filter((value) => value === "ゴロ").length / shapes.length;
    const air = shapes.filter((value) => value === "フライ" || value === "ポップフライ").length / shapes.length;
    if (ground >= .5) add("ゴロ型", ground - .5, `ゴロ率 ${(ground * 100).toFixed(1)}%／有効打球n=${shapes.length}`);
    else if (air >= .45) add("フライ型", air - .45, `フライ・ポップフライ率 ${(air * 100).toFixed(1)}%／有効打球n=${shapes.length}`);
  }
  const allDirections = spray.flatMap((row) => row.points.map((point) => sprayDirection({ ...point, sprayAngle: point.direction }, String(pitches[0]?.batterSide)))).filter(Boolean);
  if (allDirections.length >= 10) {
    const pull = allDirections.filter((value) => value === "引っ張り").length / allDirections.length;
    const opposite = allDirections.filter((value) => value === "逆方向").length / allDirections.length;
    if (pull >= .45) add("引っ張り型", pull - .45, `引っ張り ${(pull * 100).toFixed(1)}%／方向判定n=${allDirections.length}`);
    if (opposite >= .35) add("逆方向型", opposite - .35, `逆方向 ${(opposite * 100).toFixed(1)}%／方向判定n=${allDirections.length}`);
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, 4);
}

function velocityBand(pitch: ScoutingPitch) {
  const velocity = measuredNumber(pitch.velocity);
  if (velocity === null) return null;
  if (velocity < 135) return "135km/h未満";
  if (velocity < 140) return "135～139km/h";
  if (velocity < 145) return "140～144km/h";
  if (velocity < 150) return "145～149km/h";
  return "150km/h以上";
}

function verticalClass(pitch: ScoutingPitch, quartiles: Map<string, { q25: number; q75: number }>) {
  const ivb = measuredNumber(pitch.ivb);
  const key = `${seasonKey(pitch)}|${pitchGroup(pitch.pitchType)}`;
  const bounds = quartiles.get(key);
  if (ivb === null || !bounds) return null;
  if (ivb >= bounds.q75) return "上位25%";
  if (ivb <= bounds.q25) return "下位25%";
  return "中央50%";
}

function verticalLabel(group: string, classification: string) {
  if (group === "直球系") return classification === "上位25%" ? "高IVB" : classification === "下位25%" ? "低IVB" : "標準IVB";
  return classification === "上位25%" ? "落下量が小さい" : classification === "下位25%" ? "落下量が大きい" : "標準";
}

function buildQuartiles(pitches: ScoutingPitch[]) {
  const values = new Map<string, number[]>();
  pitches.forEach((pitch) => {
    const ivb = measuredNumber(pitch.ivb);
    if (ivb === null) return;
    const key = `${seasonKey(pitch)}|${pitchGroup(pitch.pitchType)}`;
    const rows = values.get(key) ?? [];
    rows.push(ivb);
    values.set(key, rows);
  });
  return new Map([...values.entries()].map(([key, rows]) => [key, { q25: quantile(rows, .25)!, q75: quantile(rows, .75)! }]));
}

export type DetailFilters = {
  pitcherThrows?: string;
  batterSide?: string;
  pitchGroup?: string;
  pitchType?: string;
  velocityMin?: number | null;
  velocityMax?: number | null;
  movementDirection?: string;
  movementBand?: string;
  movementMin?: number | null;
  verticalClass?: string;
  horizontal?: string;
  vertical?: string;
  zone?: string;
  count?: string;
  situation?: string;
  hitType?: string;
};

export function filterBatterProfilePitches(pitches: ScoutingPitch[], filters: DetailFilters, leaguePitches: ScoutingPitch[] = pitches) {
  const quartiles = buildQuartiles(leaguePitches);
  return pitches.filter((pitch) => {
    const cell = zoneCell(pitch, String(pitch.batterSide));
    const velocity = measuredNumber(pitch.velocity);
    const hb = measuredNumber(pitch.hb);
    return (!filters.pitcherThrows || pitch.pitcherThrows === filters.pitcherThrows)
      && (!filters.batterSide || pitch.batterSide === filters.batterSide)
      && (!filters.pitchGroup || (filters.pitchGroup === "変化球系"
        ? ["横変化系", "縦変化系", "落ち球系", "チェンジ系"].includes(pitchGroup(pitch.pitchType))
        : pitchGroup(pitch.pitchType) === filters.pitchGroup))
      && (!filters.pitchType || pitch.pitchType === filters.pitchType)
      && (filters.velocityMin === null || filters.velocityMin === undefined || velocity !== null && velocity >= filters.velocityMin)
      && (filters.velocityMax === null || filters.velocityMax === undefined || velocity !== null && velocity <= filters.velocityMax)
      && (!filters.movementDirection || movementDirection(pitch) === filters.movementDirection)
      && (!filters.movementBand || movementMagnitude(pitch) === filters.movementBand)
      && (filters.movementMin === null || filters.movementMin === undefined || hb !== null && Math.abs(hb) >= filters.movementMin)
      && (!filters.verticalClass || verticalClass(pitch, quartiles) === filters.verticalClass)
      && (!filters.horizontal || cell?.horizontal === filters.horizontal)
      && (!filters.vertical || cell?.vertical === filters.vertical)
      && (!filters.zone || (filters.zone === "ゾーン内" ? isInZone(pitch) : hasLocation(pitch) && !isInZone(pitch)))
      && (!filters.count || `${pitch.balls}-${pitch.strikes}` === filters.count)
      && (!filters.situation || (filters.situation === "初球" ? pitch._isPaFirstPitch : filters.situation === "2ストライク後" ? Number(pitch.strikes) === 2 : Number(pitch.strikes) === 2 && hasLocation(pitch) && !isInZone(pitch)))
      && (!filters.hitType || hitShape(pitch) === filters.hitType);
  });
}

export function buildBatterProfile(playerPitches: ScoutingPitch[], leaguePitches: ScoutingPitch[], zone: ZoneBounds = DEFAULT_ZONE, thresholdLeaguePitches: ScoutingPitch[] = leaguePitches) {
  const thresholds = buildStrongContactThresholds(thresholdLeaguePitches);
  const batterSide = String(playerPitches.find((pitch) => pitch.batterSide)?.batterSide ?? "右");
  const playerMetrics = calculateProfileMetrics(playerPitches, thresholds, zone);
  const comparableLeague = leaguePitches.filter((pitch) => pitch.batterSide === batterSide);
  const metrics = compareProfileMetrics(playerMetrics, calculateProfileMetrics(comparableLeague, thresholds, zone));
  const pitchGroups = PITCH_GROUP_ORDER.map((group) => {
    const playerRows = playerPitches.filter((pitch) => pitchGroup(pitch.pitchType) === group);
    const leagueRows = comparableLeague.filter((pitch) => pitchGroup(pitch.pitchType) === group);
    const summary = summarizeSplit(playerRows, thresholds, zone, leagueRows);
    const componentTypes = [...new Set(playerRows.map((pitch) => String(pitch.pitchType ?? "その他")))];
    return { group, usageRate: playerPitches.length ? playerRows.length / playerPitches.length : null, componentTypes, ...summary };
  }).filter((row) => row.pitches > 0);

  const zones = Array.from({ length: 9 }, (_, index) => {
    const playerRows = playerPitches.filter((pitch) => zoneCell(pitch, batterSide)?.index === index);
    const leagueRows = comparableLeague.filter((pitch) => zoneCell(pitch, batterSide)?.index === index);
    const summary = summarizeSplit(playerRows, thresholds, zone, leagueRows);
    return { index, horizontal: ["外角", "中央", "内角"][index % 3], vertical: ["高め", "中段", "低め"][Math.floor(index / 3)], ...summary };
  });

  const spray = [spraySplit(playerPitches, "右", thresholds), spraySplit(playerPitches, "左", thresholds)];
  const movement = ["打者へ入る", "ほぼ真っすぐ", "打者から逃げる"].map((direction) => {
    const playerRows = playerPitches.filter((pitch) => movementDirection(pitch) === direction);
    const leagueRows = comparableLeague.filter((pitch) => movementDirection(pitch) === direction);
    return { direction, commonMagnitude: mostCommon(playerRows.map(movementMagnitude).filter(Boolean)), ...summarizeSplit(playerRows, thresholds, zone, leagueRows) };
  });

  // The vertical buckets are defined by the whole league distribution for the
  // selected season and pitch group. Batter handedness remains part of the
  // comparison rows, but must not move the quartile boundaries themselves.
  const quartiles = buildQuartiles(leaguePitches);
  const vertical = pitchGroups.flatMap(({ group }) => ["上位25%", "中央50%", "下位25%"].map((classification) => {
    const playerRows = playerPitches.filter((pitch) => pitchGroup(pitch.pitchType) === group && verticalClass(pitch, quartiles) === classification);
    const leagueRows = comparableLeague.filter((pitch) => pitchGroup(pitch.pitchType) === group && verticalClass(pitch, quartiles) === classification);
    return { group, classification, label: verticalLabel(group, classification), ...summarizeSplit(playerRows, thresholds, zone, leagueRows) };
  })).filter((row) => row.pitches > 0);

  const velocityBands = ["135km/h未満", "135～139km/h", "140～144km/h", "145～149km/h", "150km/h以上"].map((band) => {
    const playerRows = playerPitches.filter((pitch) => pitchGroup(pitch.pitchType) === "直球系" && velocityBand(pitch) === band);
    const leagueRows = comparableLeague.filter((pitch) => pitchGroup(pitch.pitchType) === "直球系" && velocityBand(pitch) === band);
    return { band, ...summarizeSplit(playerRows, thresholds, zone, leagueRows) };
  });

  const tags = buildTags(metrics, playerPitches, spray);
  const summaryCandidates: Array<{ score: number; text: string }> = [];
  const addMetricSummary = (label: string, key: keyof ProfileMetrics, goodHigh = true) => {
    const value = metrics[key];
    if (value.confidence === "判定しない" || value.delta === null || value.delta === undefined || Math.abs(value.delta) < .05) return;
    const direction = value.delta > 0 ? "高い" : "低い";
    const interpretation = goodHigh ? "" : "（低いほど見極めが良い）";
    summaryCandidates.push({ score: Math.abs(value.delta), text: `${label}はリーグ平均より${Math.abs(value.delta * 100).toFixed(1)}ポイント${direction}${interpretation}。` });
  };
  addMetricSummary("初球Swing%", "firstPitchSwing");
  addMetricSummary("Swing%", "swing");
  addMetricSummary("Chase%", "chase", false);
  addMetricSummary("Contact%", "contact");
  addMetricSummary("強い打球率", "hardHit");
  const fast = velocityBands.filter((row) => ["145～149km/h", "150km/h以上"].includes(row.band)).sort((a, b) => b.pitches - a.pitches)[0];
  const fastDelta = fast?.metrics.contact.delta;
  if (fast && fast.metrics.contact.confidence !== "判定しない" && typeof fastDelta === "number" && Math.abs(fastDelta) >= .05) summaryCandidates.push({ score: Math.abs(fastDelta), text: `${fast.band}の直球系ではContact%がリーグ平均より${Math.abs(fastDelta * 100).toFixed(1)}ポイント${fastDelta > 0 ? "高い" : "低い"}。` });
  const strongestGroup = pitchGroups.filter((row) => row.rating !== "平均的" && row.rating !== "データ不足" && row.rating !== "特徴混在").sort((a, b) => b.pitches - a.pitches)[0];
  if (strongestGroup) summaryCandidates.push({ score: .06, text: `${strongestGroup.group}は見極め・コンタクト・打球品質の総合で「${strongestGroup.rating}」。` });

  return {
    definitionVersion: BATTER_PROFILE_DEFINITION_VERSION,
    sourceScoutingDefinitionVersion: SCOUTING_DEFINITION_VERSION,
    batterSide,
    counts: {
      games: new Set(playerPitches.map((pitch) => pitch.gameId).filter(Boolean)).size,
      pitches: playerPitches.length,
      plateAppearances: new Set(playerPitches.map((pitch) => pitch._paKey).filter(Boolean)).size,
      validBattedBalls: playerPitches.filter(isValidBattedBall).length,
      vsRightPitches: playerPitches.filter((pitch) => pitch.pitcherThrows === "右").length,
      vsLeftPitches: playerPitches.filter((pitch) => pitch.pitcherThrows === "左").length,
    },
    thresholds,
    metrics,
    tags,
    summaries: summaryCandidates.sort((a, b) => b.score - a.score).slice(0, 5).map((row) => row.text),
    pitchGroups,
    zones,
    spray,
    movement,
    vertical,
    velocityBands,
    comparison: `同一シーズン・${batterSide}打者のリーグ平均`,
  };
}
