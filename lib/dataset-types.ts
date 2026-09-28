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
export type SeasonKey = `${number}-${'spring'|'fall'}`;
