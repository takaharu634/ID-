import type { Row } from '../lib/dataset-types';

export const comparePlayerNames = (a: Row, b: Row) =>
  String(a.team || '大学不明').localeCompare(String(b.team || '大学不明'), 'ja') ||
  String(a.kanji || a.name).localeCompare(String(b.kanji || b.name), 'ja') ||
  String(a.id ?? a.key).localeCompare(String(b.id ?? b.key));

export function PlayerOptions({ players, valueKey = 'id' }: { players: Row[]; valueKey?: string }) {
  const sorted = [...players].sort(comparePlayerNames);
  const teams = [...new Set(sorted.map(row => row.team || '大学不明'))];
  return <>{teams.map(team => <optgroup key={team} label={team}>{sorted
    .filter(row => (row.team || '大学不明') === team)
    .map(row => <option key={row[valueKey]} value={row[valueKey]}>{row.kanji || row.name} / {row.romanName || row.name}（{row.team}）</option>)}</optgroup>)}</>;
}
