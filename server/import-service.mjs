import { buildDatasetFromRows } from '../lib/csv-analytics.js';
import { buildSpinDataset } from '../lib/trackman-spin.mjs';
import { csvRows, detectSeason, mergeParsedImport, seasonLabel } from '../lib/import-validation.mjs';
import { readHead, stageImport } from './import-store.mjs';
export async function prepareImport(bucket, input, fileName, baselineLoader, sources = []) {
  const incoming = csvRows(input), detected = detectSeason(incoming.rows), season = detected.season;
  const h = await readHead(bucket, season), baseline = await baselineLoader(season);
  const base = baseline.raw ? csvRows(baseline.raw) : { headers: [], rows: [] };
  const merged = mergeParsedImport(base, incoming, detected);
  if (!merged.report.addedRows) return { unchanged: true, season, report: merged.report };
  const dataset = buildDatasetFromRows(merged.rows, { title: `東都大学野球 ${seasonLabel(season)}リーグ戦`, season: seasonLabel(season), sourceName: fileName, generatedAt: new Date().toISOString(), applyPlayerRules: true });
  if (dataset.pitches.length !== merged.rows.length || new Set(dataset.pitches.map(p=>p.id)).size !== merged.rows.length) throw new Error('集計後の球数が一致しません。');
  const addedPlayers = new Set(dataset.pitches.filter(p=>merged.addedIds.has(p.id)).flatMap(p=>[p.pitcherId,p.batterId,p.catcherId]).filter(Boolean));
  const unknown = dataset.players.filter(p => !p.kanji && addedPlayers.has(p.id));
  if (unknown.length) { merged.report.notices ||= []; merged.report.notices.push({ message: `漢字表記未登録の選手 ${unknown.slice(0,5).map(p=>p.name).join('、')}`, count: unknown.length }); }
  const spin = JSON.stringify(buildSpinDataset(dataset, merged.rows, season));
  dataset.metadata.importRules = merged.report.ruleVersion;
  const report = { ...merged.report, pitchCorrections: dataset.pitches.filter(p=>p.pitchTypeChanged).length, season };
  let prior = null;
  if (!h.active && baseline.raw) {
    const old = JSON.parse(baseline.summary);
    const oldIds = new Set(old.pitches.map(p=>p.id)), rawRows = base.rows;
    if (oldIds.size !== new Set(rawRows.map(p=>p.PitchUID)).size || rawRows.some(p=>!oldIds.has(p.PitchUID))) throw new Error('既存CSVと表示データが一致しないため、更新を停止しました。');
    prior = { payload: { raw: baseline.raw, summary: baseline.summary, spin: baseline.spin || JSON.stringify(buildSpinDataset(old, rawRows, season)) }, meta: { fileName: '更新前のデータ', pitchCount: old.pitches.length, gameCount: old.games.length, report: { warnings: [] } } };
  }
  const snapshot = await stageImport(bucket, season, { raw: merged.csv, input, summary: dataset, spin, report: JSON.stringify(report), ...(sources.length>1?{sources:JSON.stringify({format:'tohto-original-inputs-v1',files:sources})}:{}) }, { fileName, pitchCount: dataset.pitches.length, gameCount: dataset.games.length, report, baseEtag: h.etag }, prior);
  return { id: snapshot.id, season, report, metadata: dataset.metadata };
}
