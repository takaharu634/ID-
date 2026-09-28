/** Missing measurements must never become a measured zero. */
export function measuredNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
export function meanOf(rows: Record<string, unknown>[], key: string): number | null {
  const values = rows.map(row => measuredNumber(row[key])).filter((v): v is number => v !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}
export function sdOf(rows: Record<string, unknown>[], key: string): number | null {
  const values = rows.map(row => measuredNumber(row[key])).filter((v): v is number => v !== null);
  if (values.length < 2) return null;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
}
