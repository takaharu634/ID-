// Legacy dataset rows share dynamic columns across pitches, players and metadata.
// Keep this boundary compatible while typed analytics validate their own inputs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;
export type Dataset = {
  metadata: Row;
  league: Row;
  teams: Row[];
  games: Row[];
  players: Row[];
  batters: Row[];
  pitchers: Row[];
  catchers: Row[];
  pitchTypes: Row[];
  pitches: Row[];
  highlights: Row;
};
export type SeasonKey = "2026-fall" | "2026-spring" | "2025-fall";
export const SEASONS: Record<SeasonKey, { label: string; year: string; term: string; path: string }> = {
  "2026-fall": { label: "2026年 秋季リーグ", year: "2026", term: "秋季", path: "/data/season-2026-fall.json" },
  "2026-spring": { label: "2026年 春季リーグ", year: "2026", term: "春季", path: "/data/season-2026-spring.json" },
  "2025-fall": { label: "2025年 秋季リーグ", year: "2025", term: "秋季", path: "/data/season-2025-fall.json" },
};
