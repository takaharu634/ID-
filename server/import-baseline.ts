import bundled from 'private:season-csv';
import { bundledCsvResponse } from './csv-download';
import { csvRows, encodeCsv, decodeUtf8 } from '../lib/import-validation.mjs';
export async function bundledSeasonCsv(season: string) {
  const sources = bundled[season];
  if (!sources) throw new Error('同梱シーズンがありません。');
  if (sources.length === 1) return decodeUtf8(await bundledCsvResponse(sources[0]).arrayBuffer());
  const rows: Record<string,string>[] = [], headers = new Set<string>();
  for (const gzip of sources) { const parsed = csvRows(await bundledCsvResponse(gzip).text()); for (const h of parsed.headers) headers.add(h); for (const row of parsed.rows) rows.push(row); }
  return encodeCsv([...headers], rows);
}
