import { maxValue } from './extrema.mjs';
import { summarizePitchExtrema } from './pitch-extrema.ts';
import type { Row } from "./dataset-types";

// Missing measurements do not contribute zero to an average.
function meanOf(rows: Row[], key: string) {
  const values = rows.map((row) => row[key]).filter((value) => value !== null && value !== undefined && value !== "").map(Number).filter(Number.isFinite);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function summarizeByPitchType(pitches: Row[], role: "pitcher" | "batter") {
  const groups = new Map<string, Row[]>();
  pitches.forEach((row) => { const rows = groups.get(row.pitchType) ?? []; rows.push(row); groups.set(row.pitchType, rows); });
  return [...groups.entries()].map(([pitchType, rows]) => {
    const swings = rows.filter((row) => ["空振り", "インプレー", "ファウル", "ファウルフライ"].includes(row.result)).length;
    const whiffs = rows.filter((row) => row.result === "空振り").length;
    const contacts = rows.filter((row) => Number.isFinite(row.exitVelocity));
    const hard = contacts.filter((row) => row.exitVelocity >= 152.9).length;
    const csw = rows.filter((row) => row.result === "空振り" || row.result === "見逃しストライク").length;
    const hits = rows.filter((row) => ["単打", "二塁打", "三塁打", "本塁打"].includes(row.playResult)).length;
    return { pitchType, pitches: rows.length, usageRate: pitches.length ? rows.length / pitches.length : null, avgVelocity: meanOf(rows, "velocity"), maxVelocity: maxValue(rows.map((row) => row.velocity).filter(Number.isFinite), 0) || null,
      avgSpin: meanOf(rows, "spin"), avgIvb: meanOf(rows, "ivb"), avgHb: meanOf(rows, "hb"), avgVaa: meanOf(rows, "vaa"), avgExtension: meanOf(rows, "extension"),
      ...summarizePitchExtrema(rows),
      whiffRate: swings ? whiffs / swings : null, swingingStrikeRate: rows.length ? whiffs / rows.length : null, cswRate: rows.length ? csw / rows.length : null, avgExitVelocity: meanOf(contacts, "exitVelocity"),
      hardHitRate: contacts.length ? hard / contacts.length : null, battingAverage: contacts.length ? hits / contacts.length : null,
      sampleNote: rows.length < (role === "pitcher" ? 20 : 12) ? "サンプル不足" : "" };
  }).sort((a, b) => b.pitches - a.pitches);
}
