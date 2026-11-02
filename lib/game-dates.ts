type Row = Record<string, unknown>;
const isRow = (value: unknown): value is Row => Boolean(value && typeof value === 'object' && !Array.isArray(value));

export function gameDateKey(value: unknown): string {
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(String(value ?? '').trim());
  if (!match) return '';
  const normalized = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  const date = new Date(`${normalized}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === normalized ? normalized : '';
}

export function matchesDateRange(value: unknown, from = '', to = '') {
  if (!from && !to) return true;
  const date = gameDateKey(value);
  return Boolean(date && (!from || date >= from) && (!to || date <= to));
}

/** Normalize display dates without rewriting source snapshots or guessing a game date. */
export function normalizeGameDates<T>(input: T): T {
  if (!isRow(input) || !Array.isArray(input.pitches) || !Array.isArray(input.games)) return input;
  const sourcePitches = input.pitches, sourceGames = input.games;
  const candidates = new Map<unknown, Set<string>>();
  const add = (id: unknown, date: unknown) => {
    const key = gameDateKey(date);
    if (!id || !key) return;
    const values = candidates.get(id) ?? new Set<string>();
    values.add(key); candidates.set(id, values);
  };
  input.games.forEach(game => { if (isRow(game)) add(game.id, game.date); });
  input.pitches.forEach(pitch => { if (isRow(pitch)) add(pitch.gameId, pitch.date); });
  const normalized = (value: unknown, gameId: unknown) => {
    if (!isRow(value)) return value;
    const dates = candidates.get(gameId);
    const date = gameDateKey(value.date) || (dates?.size === 1 ? dates.values().next().value! : '');
    return date === value.date ? value : { ...value, date };
  };
  const pitches = input.pitches.map(pitch => normalized(pitch, isRow(pitch) ? pitch.gameId : null));
  const games = input.games.map(game => normalized(game, isRow(game) ? game.id : null));
  if (pitches.every((pitch, i) => pitch === sourcePitches[i]) && games.every((game, i) => game === sourceGames[i])) return input;
  return { ...input, pitches, games };
}
