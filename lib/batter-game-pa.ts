import type { Row } from './dataset-types';

const positive = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value > 0;
const cache = new WeakMap<Row[], Map<string, number>>();

/** Count each batter's PAs within a game, using the complete, unfiltered game data. */
export function batterGamePaNumbers(pitches: Row[]): Map<string, number> {
  const cached = cache.get(pitches);
  if (cached) return cached;
  const batters = new Map<string, Map<string, { firstPitch: number; ids: Set<string> }>>();
  const unavailable = new Set<string>();
  for (const pitch of pitches) {
    if (!pitch.gameId || !pitch.batterId) continue;
    const batterKey = JSON.stringify([pitch.gameId, pitch.batterId]);
    if (!pitch.id || !positive(pitch.inning) || !['表', '裏'].includes(pitch.half) || !positive(pitch.paOfInning) || !positive(pitch.pitchNo)) {
      unavailable.add(batterKey);
      continue;
    }
    const appearances = batters.get(batterKey) ?? new Map();
    // Pitcher changes do not start a new PA. Batting around does.
    const paKey = JSON.stringify([pitch.inning, pitch.half, pitch.paOfInning]);
    const appearance = appearances.get(paKey) ?? { firstPitch: pitch.pitchNo, ids: new Set<string>() };
    appearance.firstPitch = Math.min(appearance.firstPitch, pitch.pitchNo);
    appearance.ids.add(pitch.id);
    appearances.set(paKey, appearance);
    batters.set(batterKey, appearances);
  }
  const result = new Map<string, number>();
  for (const [batterKey, appearances] of batters) {
    if (unavailable.has(batterKey)) continue;
    [...appearances.values()].sort((a, b) => a.firstPitch - b.firstPitch).forEach((pa, index) => {
      for (const id of pa.ids) result.set(id, index + 1);
    });
  }
  cache.set(pitches, result);
  return result;
}
