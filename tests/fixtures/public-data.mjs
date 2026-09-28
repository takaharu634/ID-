import { PITCH_QUALITY_VERSION } from '../../lib/pitch-quality.mjs';
import { seasonLabel } from '../../lib/seasons.mjs';
export function publicSummary(season = '2035-spring') {
  return { schemaVersion: 7, metadata: { season: seasonLabel(season), pitchQuality: { version: PITCH_QUALITY_VERSION }, pitches: 0, games: 0, teams: 0, pitchers: 0, batters: 0, catchers: 0, battedBalls: 0 }, league: {}, highlights: {}, teams: [], games: [], players: [], batters: [], pitchers: [], catchers: [], pitchTypes: [], pitches: [] };
}
export function publicSpin(season = '2035-spring') { return [{ pitcherId: `${season}:pitcher`, pitchType: 'fastball', velocity: 145 }]; }
