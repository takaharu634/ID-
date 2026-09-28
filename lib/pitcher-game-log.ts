import type { Row } from "./dataset-types";
import { summarizeByPitchType } from "./pitch-summary.ts";
import { batterGamePaNumbers } from "./batter-game-pa.ts";

const positiveInteger = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value > 0;
const dateKey = (value: unknown) => String(value ?? "").replaceAll("/", "-").split("-").map((part, index) => index ? part.padStart(2, "0") : part).join("-");

/** Uses the same normalized pitches and pitch-type summary as the player profile. */
export function buildPitcherGameLog(pitches: Row[], games: Row[], pitcherId: string, fullPitches: Row[] = pitches) {
  if (!pitcherId) return [];
  const paNumbers = batterGamePaNumbers(fullPitches);
  const gameById = new Map(games.map((game) => [game.id, game]));
  const groups = new Map<string, Row[]>();
  for (const pitch of pitches) {
    if (pitch.pitcherId !== pitcherId || !pitch.gameId) continue;
    const rows = groups.get(pitch.gameId) ?? [];
    rows.push(pitch);
    groups.set(pitch.gameId, rows);
  }
  return [...groups].map(([gameId, rows]) => {
    const game = gameById.get(gameId);
    const arsenal = summarizeByPitchType(rows, "pitcher");
    const speeds = rows.map((pitch) => pitch.velocity).filter((value) => typeof value === "number" && Number.isFinite(value) && value > 0);
    const maxVelocity = speeds.length ? Math.max(...speeds) : null;
    // Preserve all ties at the site's displayed precision (0.1 km/h).
    const fastest = maxVelocity === null ? [] : rows.filter((pitch) => typeof pitch.velocity === "number" && Number.isFinite(pitch.velocity) && Math.round(pitch.velocity * 10) === Math.round(maxVelocity * 10))
      .map((pitch): Row => ({ ...pitch, batterGamePa: paNumbers.get(pitch.id) ?? null })).sort((a, b) => (a.pitchNo ?? Infinity) - (b.pitchNo ?? Infinity));
    const team = rows[0].pitcherTeam;
    const opponent = game && game.homeTeam === team ? game.awayTeam : game && game.awayTeam === team ? game.homeTeam : rows.find((pitch) => pitch.batterTeam)?.batterTeam;
    return { gameId, date: dateKey(game?.date || rows.find((pitch) => pitch.date)?.date), opponent: opponent || "対戦校不明", pitches: rows.length, maxVelocity, arsenal, fastest };
  }).sort((a, b) => b.date.localeCompare(a.date) || a.gameId.localeCompare(b.gameId));
}

export function fastestPitchContext(pitch: Row) {
  const inning = positiveInteger(pitch.inning) ? `${pitch.inning}回${["表", "裏"].includes(pitch.half) ? pitch.half : ""}` : "回不明";
  const batter = pitch.batterKanji || pitch.batter || "打者不明";
  const pa = positiveInteger(pitch.batterGamePa) ? `この試合の第${pitch.batterGamePa}打席` : "";
  const pitchInPa = positiveInteger(pitch.pitchOfPA) ? `打席${pitch.pitchOfPA}球目` : "";
  const gamePitch = positiveInteger(pitch.pitchNo) ? `試合通算${pitch.pitchNo}球目` : "";
  const count = Number.isInteger(pitch.balls) && pitch.balls >= 0 && pitch.balls <= 3 && Number.isInteger(pitch.strikes) && pitch.strikes >= 0 && pitch.strikes <= 2 ? `${pitch.balls}–${pitch.strikes}` : "";
  return [inning, batter, pa, pitchInPa || gamePitch, count, pitch.pitchType, pitch.playResult || pitch.result].filter(Boolean).join(" · ");
}
