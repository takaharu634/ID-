import type { Row } from "./dataset-types";

export function pitcherStrikeoutRows(pitchers: Row[]): Row[] {
  return pitchers.map((pitcher) => ({
    ...pitcher,
    battersFaced: pitcher.pa,
    strikeoutRate: Number.isFinite(pitcher.strikeouts) && pitcher.pa > 0 ? pitcher.strikeouts / pitcher.pa : null,
  }));
}

// Inputs are the deduplicated, normalized pitches from the dataset loader.
// Use the recorded PA result: pitch calls/counts alone cannot identify every K.
export function pitchStrikeoutRows(pitchers: Row[], pitches: Row[]): Row[] {
  const players = new Map(pitchers.map((row) => [row.id, row]));
  const groups = new Map<string, Row>();
  const totals = new Map<string, number>();
  for (const pitch of pitches) {
    if (!pitch.pitcherId) continue;
    const pitchType = pitch.pitchType || "不明";
    const key = JSON.stringify([pitch.pitcherId, pitchType]);
    let row = groups.get(key);
    if (!row) {
      const player = players.get(pitch.pitcherId);
      row = {
        pitcherId: pitch.pitcherId,
        pitcher: player?.name || pitch.pitcher,
        pitcherKanji: player?.kanji || pitch.pitcherKanji,
        romanName: player?.romanName,
        aliases: player?.aliases,
        team: player?.team || pitch.pitcherTeam,
        pitchType, pitches: 0, strikeouts: 0,
      };
      groups.set(key, row);
    }
    row.pitches += 1;
    if (pitch.korbb === "Strikeout") {
      row.strikeouts += 1;
      totals.set(pitch.pitcherId, (totals.get(pitch.pitcherId) ?? 0) + 1);
    }
  }
  return [...groups.values()].map((row) => ({
    ...row,
    pitchStrikeoutShare: totals.get(row.pitcherId) ? row.strikeouts / totals.get(row.pitcherId)! : null,
  }));
}
