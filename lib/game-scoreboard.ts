import type { Row } from './dataset-types';

export function gameScoreboard(game: Row, pitches: Row[]) {
  const seen = new Set<string>();
  const rows = pitches.filter(p => {
    if (p.gameId !== game.id) return false;
    if (!p.id) return true;
    if (seen.has(p.id)) return false;
    seen.add(p.id); return true;
  });
  const last = Math.max(9, ...rows.map(p => Number.isInteger(p.inning) && p.inning > 0 ? p.inning : 0));
  return { innings: Array.from({ length: last }, (_, i) => i + 1), teams: [game.awayTeam, game.homeTeam].map(team => {
    const batting = rows.filter(p => p.batterTeam === team);
    const walks = batting.filter(p => p.korbb === 'Walk').length;
    const hbp = batting.filter(p => p.result === '死球').length;
    return {
      team,
      innings: Array.from({ length: last }, (_, i) => {
        const inning = batting.filter(p => p.inning === i + 1);
        return inning.length && inning.every(p => typeof p.runsScored === 'number' && Number.isFinite(p.runsScored)) ? inning.reduce((n, p) => n + p.runsScored, 0) : null;
      }),
      runs: team === game.awayTeam ? game.awayRuns : game.homeRuns,
      hits: batting.filter(p => ['単打', '二塁打', '三塁打', '本塁打'].includes(p.playResult)).length,
      walks, hbp, freePasses: walks + hbp,
      reachedOnError: batting.filter(p => p.playResult === '失策').length,
      // TrackMan PlayResult does not record all fielding errors.
      errors: null,
    };
  }) };
}
