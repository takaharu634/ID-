import { buildDatasetFromCsv } from '../../lib/csv-analytics.js';
import { buildSpinDataset, SPIN_METHOD } from '../../lib/trackman-spin.mjs';
import { csvRows, detectSeason, encodeCsv, mergeImport, seasonLabel } from '../../lib/import-validation.mjs';
import { validateAutumnBatting } from '../../lib/autumn-batting-validation.mjs';

export function combineInputs(inputs) {
  const headers = new Set(), rows = [];
  for (const text of inputs) {
    const parsed = csvRows(text);
    detectSeason(parsed.rows);
    parsed.headers.forEach(h => headers.add(h)); rows.push(...parsed.rows);
  }
  return encodeCsv([...headers], rows);
}
export function buildPayload(base, input, generatedAt) {
  const merged = mergeImport(base.raw, input);

  if (!merged.report.addedRows) return { unchanged: true, report: merged.report };
  const data = buildDatasetFromCsv(merged.csv, { title: `東都大学野球 ${seasonLabel(merged.season)}リーグ戦`, season: seasonLabel(merged.season), sourceName: 'Drive追加通知', generatedAt, applyPlayerRules: true });
  if (data.pitches.length !== merged.rows.length || new Set(data.pitches.map(p => p.id)).size !== merged.rows.length) throw new Error('集計後の球数が一致しません。');
  const batting = validateAutumnBatting(data, merged.rows);
  const addedPlayers = new Set(data.pitches.filter(p => merged.addedIds.has(p.id)).flatMap(p => [p.pitcherId, p.batterId, p.catcherId]).filter(Boolean));
  const unknown = data.players.filter(p => !p.kanji && addedPlayers.has(p.id));
  if (unknown.length) { merged.report.notices ||= []; merged.report.notices.push({ message: `漢字表記未登録の選手 ${unknown.slice(0, 5).map(p => p.name).join('、')}`, count: unknown.length }); }
  if (merged.report.warnings.length) throw new Error(merged.report.warnings.map(w => `${w.message}（${w.count}件）`).join('。'));
  const spin = buildSpinDataset(data, merged.rows, merged.season);
  data.metadata.importRules = merged.report.ruleVersion;
  data.metadata.trackmanSync = { mode: 'drive-push', ...batting, spinMethod: SPIN_METHOD, spinPitches: spin.length, estimatedSpinPitches: spin.filter(p => p.gyroAngle !== null).length, lastDate: merged.rows.at(-1).Date };
  return { raw: merged.csv, input, summary: JSON.stringify(data), spin: JSON.stringify(spin), report: { ...merged.report, season: merged.season, pitchCorrections: data.pitches.filter(p => p.pitchTypeChanged).length } };
}

export const inputSeason = text => detectSeason(csvRows(text).rows).season;
export { objectSegments, BLOCK_CHARS } from '../../server/object-store.mjs';
