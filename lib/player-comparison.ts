import type { Dataset, Row, SeasonKey } from './dataset-types';
import { seasonFromLabel } from './seasons.mjs';

export type ComparisonSlot = { season: SeasonKey; playerId: string };
export type ComparisonEntry = ComparisonSlot & { key: string; player: Row; pitchTypes: Row[] };
export type ComparisonDatasets = Partial<Record<SeasonKey, Dataset>>;

export function comparisonKey(slot: ComparisonSlot) {
  return JSON.stringify([slot.season, slot.playerId]);
}

export function comparisonSlots(ids: string[], seasons: string[], available: SeasonKey[], current: SeasonKey): ComparisonSlot[] {
  return Array.from({ length: 3 }, (_, index) => ({
    season: available.includes(seasons[index] as SeasonKey) ? seasons[index] as SeasonKey : current,
    playerId: ids[index] ?? '',
  }));
}

// The same pitcher can appear in different seasons, but not twice in one season.
export function updateComparisonSlot(slots: ComparisonSlot[], index: number, selected: ComparisonSlot) {
  return slots.map((slot, position) => position === index ? selected :
    selected.playerId && comparisonKey(slot) === comparisonKey(selected) ? { ...slot, playerId: '' } : slot);
}

export function buildComparisonEntries(slots: ComparisonSlot[], datasets: ComparisonDatasets): ComparisonEntry[] {
  const seen = new Set<string>();
  return slots.flatMap(slot => {
    const data = datasets[slot.season], key = comparisonKey(slot);
    if (!data || seasonFromLabel(data.metadata.season) !== slot.season || !slot.playerId || seen.has(key)) return [];
    const player = data.pitchers.find(row => row.id === slot.playerId);
    if (!player) return [];
    seen.add(key);
    return [{ ...slot, key, player, pitchTypes: data.pitchTypes.filter(row => row.pitcherId === slot.playerId) }];
  });
}
