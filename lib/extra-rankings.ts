import type { Row } from "./dataset-types";
import { sprayDirection } from "./batter-profile.ts";

// Ranking rows derived on display from the selected season's normalized pitches.
// Stored datasets, aggregates and import rules are never rewritten here.

const ZONE = { left: -0.254, right: 0.254, bottom: 0.45, top: 1.05 };
const SWING_RESULTS = new Set(["空振り", "インプレー", "ファウル", "ファウルフライ"]);
const HIT_BASES: Record<string, number> = { 単打: 1, 二塁打: 2, 三塁打: 3, 本塁打: 4 };
export const BATTED_BALL_TYPES = ["GroundBall", "LineDrive", "FlyBall", "Popup"] as const;

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const ratio = (numerator: number, denominator: number) => denominator > 0 ? numerator / denominator : null;
const meanOf = (sum: number, n: number) => n > 0 ? sum / n : null;

export const isZonePitch = (pitch: Row) => finite(pitch.plateX) && finite(pitch.plateZ)
  && pitch.plateX >= ZONE.left && pitch.plateX <= ZONE.right && pitch.plateZ >= ZONE.bottom && pitch.plateZ <= ZONE.top;
export const isLocatedPitch = (pitch: Row) => finite(pitch.plateX) && finite(pitch.plateZ);
export const isSwingPitch = (pitch: Row) => SWING_RESULTS.has(pitch.result);
export const isWalk = (pitch: Row) => pitch.korbb === "Walk" || pitch.korbb === "Waik";
// Same terminal-PA rule as the stored pitcher/batter PA totals.
export const isPlateAppearanceEnd = (pitch: Row) => pitch.korbb === "Strikeout" || isWalk(pitch) || pitch.result === "死球" || pitch.result === "インプレー";
// Bunts and untagged contact are excluded from batted-ball type shares.
export const battedBallType = (pitch: Row) => pitch.result === "インプレー" && (BATTED_BALL_TYPES as readonly string[]).includes(pitch.hitType) ? pitch.hitType as string : null;

export function circularMeanDegrees(values: number[]) {
  const valid = values.filter(Number.isFinite);
  if (!valid.length) return null;
  const sin = valid.reduce((sum, value) => sum + Math.sin(value * Math.PI / 180), 0);
  const cos = valid.reduce((sum, value) => sum + Math.cos(value * Math.PI / 180), 0);
  if (Math.hypot(sin, cos) < 1e-9) return null;
  return (Math.atan2(sin, cos) * 180 / Math.PI + 360) % 360;
}

type SpinMeasurement = { pitcherId?: string; normalizedPitchType?: string; spinEfficiency?: number | null };

/** Extension, perceived velocity and spin columns for the per-pitch-type boards. */
export function pitchTypeExtraRows(pitchTypes: Row[], pitches: Row[], spin: SpinMeasurement[] | null = null, season = ""): Row[] {
  const groups = new Map<string, Row>();
  const keyOf = (pitcherId: unknown, pitchType: unknown) => JSON.stringify([pitcherId, pitchType]);
  const groupFor = (key: string) => {
    let group = groups.get(key);
    if (!group) groups.set(key, group = { maxExtension: null, effSum: 0, effN: 0, gapSum: 0, gapN: 0, axes: [] as number[], efficiencySum: 0, efficiencyN: 0 });
    return group;
  };
  for (const pitch of pitches) {
    const group = groupFor(keyOf(pitch.pitcherId, pitch.pitchType));
    if (finite(pitch.extension) && (group.maxExtension === null || pitch.extension > group.maxExtension)) group.maxExtension = pitch.extension;
    if (finite(pitch.effectiveVelocity)) {
      group.effSum += pitch.effectiveVelocity; group.effN += 1;
      if (finite(pitch.velocity)) { group.gapSum += pitch.effectiveVelocity - pitch.velocity; group.gapN += 1; }
    }
    if (finite(pitch.spinAxis)) group.axes.push(pitch.spinAxis);
  }
  const prefix = season ? `${season}:` : "";
  for (const row of spin ?? []) {
    if (!finite(row.spinEfficiency) || !row.pitcherId) continue;
    const pitcherId = prefix && row.pitcherId.startsWith(prefix) ? row.pitcherId.slice(prefix.length) : row.pitcherId;
    const group = groupFor(keyOf(pitcherId, row.normalizedPitchType));
    group.efficiencySum += row.spinEfficiency; group.efficiencyN += 1;
  }
  return pitchTypes.map((row) => {
    const group = groups.get(keyOf(row.pitcherId, row.pitchType));
    return {
      ...row,
      maxExtension: group?.maxExtension ?? null,
      avgEffectiveVelocity: group ? meanOf(group.effSum, group.effN) : null,
      effectiveVelocityGain: group ? meanOf(group.gapSum, group.gapN) : null,
      avgSpinAxis: group ? circularMeanDegrees(group.axes) : null,
      avgSpinEfficiency: group && spin ? meanOf(group.efficiencySum, group.efficiencyN) : null,
      spinEfficiencySamples: group?.efficiencyN ?? 0,
    };
  });
}

type Counter = { pitches: number; located: number; zone: number; zoneSwings: number; outside: number; chases: number; pa: number; walks: number; strikeouts: number; batted: number; ground: number; line: number; fly: number; popup: number; directed: number; pull: number; center: number; opposite: number };
const emptyCounter = (): Counter => ({ pitches: 0, located: 0, zone: 0, zoneSwings: 0, outside: 0, chases: 0, pa: 0, walks: 0, strikeouts: 0, batted: 0, ground: 0, line: 0, fly: 0, popup: 0, directed: 0, pull: 0, center: 0, opposite: 0 });

function count(counter: Counter, pitch: Row) {
  counter.pitches += 1;
  if (isLocatedPitch(pitch)) {
    counter.located += 1;
    if (isZonePitch(pitch)) { counter.zone += 1; if (isSwingPitch(pitch)) counter.zoneSwings += 1; }
    else { counter.outside += 1; if (isSwingPitch(pitch)) counter.chases += 1; }
  }
  if (isPlateAppearanceEnd(pitch)) {
    counter.pa += 1;
    if (isWalk(pitch)) counter.walks += 1;
    if (pitch.korbb === "Strikeout") counter.strikeouts += 1;
  }
  const type = battedBallType(pitch);
  if (type) {
    counter.batted += 1;
    if (type === "GroundBall") counter.ground += 1;
    else if (type === "LineDrive") counter.line += 1;
    else if (type === "FlyBall") counter.fly += 1;
    else counter.popup += 1;
    const direction = sprayDirection(pitch, String(pitch.batterSide));
    if (direction) {
      counter.directed += 1;
      if (direction === "引っ張り") counter.pull += 1; else if (direction === "センター") counter.center += 1; else counter.opposite += 1;
    }
  }
}

function countBy(pitches: Row[], idKey: "pitcherId" | "batterId") {
  const counters = new Map<string, Counter>();
  for (const pitch of pitches) {
    const id = pitch[idKey];
    if (!id) continue;
    let counter = counters.get(id);
    if (!counter) counters.set(id, counter = emptyCounter());
    count(counter, pitch);
  }
  return counters;
}

function rates(counter: Counter | undefined) {
  const c = counter ?? emptyCounter();
  return {
    zoneRate: ratio(c.zone, c.located),
    zoneSwingRate: ratio(c.zoneSwings, c.zone),
    walkRate: ratio(c.walks, c.pa),
    strikeoutRate: ratio(c.strikeouts, c.pa),
    battedBalls: c.batted,
    groundBallRate: ratio(c.ground, c.batted),
    lineDriveRate: ratio(c.line, c.batted),
    flyBallRate: ratio(c.fly, c.batted),
    popupRate: ratio(c.popup, c.batted),
    directedBalls: c.directed,
    pullRate: ratio(c.pull, c.directed),
    centerRate: ratio(c.center, c.directed),
    oppositeRate: ratio(c.opposite, c.directed),
  };
}

/** Zone/discipline/batted-ball columns on the stored pitcher rows (PA, walks, chase and first-pitch strike stay stored). */
export function pitcherExtraRows(pitchers: Row[], pitches: Row[]): Row[] {
  const counters = countBy(pitches, "pitcherId");
  return pitchers.map((row) => {
    const extra = rates(counters.get(row.id));
    return { ...row, ...extra, battersFaced: row.pa, walkRate: ratio(Number(row.walks) || 0, Number(row.pa) || 0), strikeoutRate: ratio(Number(row.strikeouts) || 0, Number(row.pa) || 0) };
  });
}

/** Zone/discipline/batted-ball/direction columns on the stored batter rows. */
export function batterExtraRows(batters: Row[], pitches: Row[]): Row[] {
  const counters = countBy(pitches, "batterId");
  return batters.map((row) => {
    const extra = rates(counters.get(row.id));
    return { ...row, ...extra, walkRate: ratio(Number(row.walks) || 0, Number(row.pa) || 0), strikeoutRate: ratio(Number(row.strikeouts) || 0, Number(row.pa) || 0) };
  });
}

type SplitCounter = { pa: number; ab: number; hits: number; totalBases: number; homeRuns: number; walks: number; hbp: number; strikeouts: number; pitches: number };

/**
 * Left/right splits from completed PAs. AB excludes walks, HBP and the imported
 * "犠打・犠飛" result; OBP is not shown because that result mixes bunts and flies.
 */
export function platoonRows(players: Row[], pitches: Row[], role: "pitcher" | "batter"): Row[] {
  const idKey = role === "pitcher" ? "pitcherId" : "batterId";
  const sideKey = role === "pitcher" ? "batterSide" : "pitcherThrows";
  const playersById = new Map(players.map((player) => [player.id, player]));
  const groups = new Map<string, Row & SplitCounter>();
  for (const pitch of pitches) {
    const id = pitch[idKey];
    const side = pitch[sideKey];
    if (!id || (side !== "左" && side !== "右")) continue;
    const key = JSON.stringify([id, side]);
    let row = groups.get(key);
    if (!row) {
      const player = playersById.get(id);
      const name = player?.name || pitch[role];
      const kanji = player?.kanji || pitch[`${role}Kanji`];
      row = {
        [idKey]: id, [role]: name, [`${role}Kanji`]: kanji, kanji, romanName: player?.romanName, aliases: player?.aliases,
        team: player?.team || pitch[`${role}Team`], split: role === "pitcher" ? `対${side}打者` : `対${side}投手`, side,
        pa: 0, ab: 0, hits: 0, totalBases: 0, homeRuns: 0, walks: 0, hbp: 0, strikeouts: 0, pitches: 0,
      } as Row & SplitCounter;
      groups.set(key, row);
    }
    row.pitches += 1;
    if (!isPlateAppearanceEnd(pitch)) continue;
    row.pa += 1;
    if (isWalk(pitch)) { row.walks += 1; continue; }
    if (pitch.result === "死球") { row.hbp += 1; continue; }
    if (pitch.korbb === "Strikeout") row.strikeouts += 1;
    if (pitch.playResult === "犠打・犠飛" || pitch.playResult === "犠打" || pitch.playResult === "犠飛") continue;
    row.ab += 1;
    const bases = HIT_BASES[pitch.playResult] ?? 0;
    if (bases) { row.hits += 1; row.totalBases += bases; if (bases === 4) row.homeRuns += 1; }
  }
  return [...groups.values()].map((row) => ({
    ...row,
    battingAverage: ratio(row.hits, row.ab),
    sluggingPercentage: ratio(row.totalBases, row.ab),
    strikeoutRate: ratio(row.strikeouts, row.pa),
    walkRate: ratio(row.walks, row.pa),
  }));
}
