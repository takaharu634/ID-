/* eslint-disable @typescript-eslint/no-explicit-any */
export type BarrelPitch = Record<string, any>;
export type BarrelMetric = "swings" | "bip";

const X_EDGES = [-0.55, -0.254, -0.0847, 0.0847, 0.254, 0.55];
const Z_EDGES = [0.18, 0.45, 0.65, 0.85, 1.05, 1.32];

export function hasKanjiName(value: unknown) {
  return /[一-龯々〆ヵヶ]/u.test(String(value ?? ""));
}

export function canonicalPlayerKey(team: unknown, kanji: unknown, playerId?: unknown) {
  if (!hasKanjiName(kanji)) return playerId ? `${String(team ?? '').trim()}|id:${String(playerId)}` : "";
  return `${String(team ?? "").trim()}|${String(kanji).replace(/[\s　]+/gu, "")}`;
}

export function isBarrelEquivalent(pitch: BarrelPitch) {
  const speed = Number(pitch.exitVelocity);
  const angle = Number(pitch.launchAngle);
  if (!Number.isFinite(speed) || !Number.isFinite(angle)) return false;
  return speed >= 145 && angle >= 10 && angle <= 35;
}

export function isSwingPitch(pitch: BarrelPitch) {
  return ["空振り", "インプレー", "ファウル", "ファウルフライ"].includes(pitch.result);
}

export function isBipPitch(pitch: BarrelPitch) {
  return pitch.result === "インプレー";
}

function zoneIndex(pitch: BarrelPitch) {
  const x = pitch.plateX;
  const z = pitch.plateZ;
  if (typeof x !== 'number' || typeof z !== 'number') return null;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  const col = X_EDGES.findIndex((edge, index) => index < X_EDGES.length - 1 && x >= edge && x < X_EDGES[index + 1]);
  const fromBottom = Z_EDGES.findIndex((edge, index) => index < Z_EDGES.length - 1 && z >= edge && z < Z_EDGES[index + 1]);
  if (col < 0 || fromBottom < 0) return null;
  return { col, row: 4 - fromBottom };
}

export function summarizeBarrelZones(pitches: BarrelPitch[], metric: BarrelMetric) {
  const cells = Array.from({ length: 25 }, (_, index) => ({ row: Math.floor(index / 5), col: index % 5, numerator: 0, denominator: 0 }));
  for (const pitch of pitches) {
    const zone = zoneIndex(pitch);
    if (!zone) continue;
    const qualifies = metric === "swings" ? isSwingPitch(pitch) : isBipPitch(pitch);
    if (!qualifies) continue;
    const cell = cells[zone.row * 5 + zone.col];
    cell.denominator += 1;
    if (isBarrelEquivalent(pitch)) cell.numerator += 1;
  }
  return cells.map((cell) => ({ ...cell, rate: cell.denominator ? cell.numerator / cell.denominator : null }));
}
