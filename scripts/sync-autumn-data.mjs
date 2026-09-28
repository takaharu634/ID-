import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSpinDataset, SPIN_METHOD } from '../lib/trackman-spin.mjs';
import { validateAutumnBatting } from '../lib/autumn-batting-validation.mjs';
import { buildDatasetFromCsv } from '../lib/csv-analytics.js';
import { AUTUMN_FOLDER_ID, normalizeBatch, folderChanges, mergeAutumnSources, sha256, listingFingerprint } from '../lib/trackman-folder-import.mjs';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function optionalJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

/** Validate the complete proposed autumn snapshot before touching any output.
 * The source manifest is the final write. Publishing is a separate atomic Site
 * version, so a failed local build never replaces the current public dataset. */
export async function syncAutumn(batch, { root = defaultRoot, checkOnly = false, rebuildDerived = false, build = buildDatasetFromCsv } = {}) {
  const files = normalizeBatch(batch);
  const privateDir = resolve(root, 'data/trackman/2026-fall');
  const previous = await optionalJson(resolve(privateDir, 'manifest.json'));
  const changes = folderChanges(files, previous?.files);
  const missing = (previous?.files ?? []).filter(p => !files.some(f => f.id === p.id)).map(p => p.id);
  if (checkOnly) return { changed: changes.length > 0, files: changes, retainedMissingIds: missing };
  if (!rebuildDerived && !changes.length && previous?.listingFingerprint && previous?.summary?.spinMethod === SPIN_METHOD) return { changed: false, ...previous.summary, retainedMissingIds: missing };

  const sources = [], nextFiles = [], pending = [];
  const retained = (previous?.files ?? []).filter(p => missing.includes(p.id));
  for (const f of [...files, ...retained].sort((a, b) => a.id.localeCompare(b.id))) {
    const old = previous?.files.find(p => p.id === f.id);
    const changed = changes.some(c => c.id === f.id);
    if (changed && !f.path) throw new Error(`${f.name}: 更新されたCSVのダウンロードが必要です。`);
    const bytes = await readFile(changed ? resolve(f.path) : resolve(privateDir, `${f.id}.csv`));
    const hash = sha256(bytes);
    if (bytes.length !== f.size || (!changed && hash !== old?.sha256)) throw new Error(`${f.name}: CSVのサイズまたは保存済みハッシュが一致しません。`);
    sources.push({ ...f, bytes });
    nextFiles.push({ id: f.id, name: f.name, modifiedTime: f.modifiedTime, size: f.size, sha256: hash });
    if (changed) pending.push([resolve(privateDir, `${f.id}.csv`), bytes]);
  }
  if (!sources.length) throw new Error('取り込める秋のCSVがありません。');
  const merged = mergeAutumnSources(sources);
  const oldDataset = await optionalJson(resolve(root, 'public/data/season-2026-fall.json'));
  const nextIds = new Set(merged.rows.map(p => p.PitchUID));
  if (oldDataset?.pitches.some(p => !nextIds.has(p.id))) throw new Error('登録済みの投球が減る変更のため、自動反映を停止しました。');
  const sourceFingerprint = sha256(JSON.stringify(nextFiles.map(f => [f.id, f.sha256])));
  const generatedAt = oldDataset?.metadata?.trackmanSync?.sourceFingerprint === sourceFingerprint
    ? oldDataset.metadata.generatedAt : new Date().toISOString();
  const dataset = build(merged.csv, { title: '東都大学野球 2026年秋季リーグ戦', season: '2026年秋季', sourceName: '2026秋リーグ TrackMan CSV', generatedAt, applyPlayerRules: true });
  if (dataset.pitches.length !== nextIds.size || dataset.games.length !== merged.games || dataset.pitches.some(p => p.year !== 2026 || p.season !== '秋')) throw new Error('集計後の件数またはシーズンが元CSVと一致しません。');
  const battingQuality = validateAutumnBatting(dataset, merged.rows);
  const spinRows = buildSpinDataset(dataset, merged.rows);
  const summary = { ...battingQuality, spinMethod: SPIN_METHOD, spinPitches: spinRows.length, estimatedSpinPitches: spinRows.filter(row => row.gyroAngle !== null).length, files: nextFiles.length, pitches: dataset.pitches.length, games: dataset.games.length, teams: dataset.teams.length, duplicates: merged.duplicates, firstDate: merged.rows[0].Date, lastDate: merged.rows.at(-1).Date };
  dataset.metadata.trackmanSync = { sourceFingerprint, ...summary, sourceUpdatedAt: nextFiles.map(f => f.modifiedTime).sort().at(-1), schedule: '日本時間 8:30・16:30・22:30', note: 'Driveの追加・更新CSVを定期確認して反映。元CSVは未検証（unverified）を含みます。' };

  const hosting = await optionalJson(resolve(root, '.openai/hosting.json'));
  if (hosting?.project_id === 'appgprj_6a70534ae1188191950a6caf8f850393') {
    const { annotateRunnerStates } = await import(pathToFileURL(resolve(defaultRoot, 'lib/runner-state.js')).href);
    dataset.schemaVersion = 7;
    dataset.pitches = annotateRunnerStates(dataset.pitches);
    dataset.metadata.runnerState = { version: 'tohto-runner-state-v1', source: 'inferred', note: 'TrackMan標準CSVに塁占有列がないため、打席結果・得点・アウトから各投球前の走者状況を推定。' };
  } else {
    pending.push([resolve(root, 'public/data/season-2026-fall.csv'), merged.csv]);
  }
  pending.push([resolve(root, 'public/data/spin-2026-fall.json'), JSON.stringify(spinRows)]);
  pending.push([resolve(root, 'public/data/season-2026-fall.json'), JSON.stringify(dataset)]);
  const status = { ...summary, season: '2026-fall', generatedAt, sourceFingerprint, listingFingerprint: listingFingerprint(files) };
  pending.push([resolve(root, 'lib/generated/autumn-data-status.json'), JSON.stringify(status, null, 2) + '\n']);
  pending.push([resolve(root, 'public/data/trackman-2026-fall-status.json'), JSON.stringify(status) + '\n']);
  pending.push([resolve(privateDir, 'manifest.json'), JSON.stringify({ version: 1, folderId: AUTUMN_FOLDER_ID, season: '2026-fall', sourceFingerprint, listingFingerprint: status.listingFingerprint, summary, files: nextFiles }, null, 2) + '\n']);
  for (const [path, bytes] of pending) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(`${path}.tmp`, bytes);
    await rename(`${path}.tmp`, path);
  }
  return { changed: true, ...summary, sourceFingerprint, retainedMissingIds: missing };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), checkOnly = args.includes('--check');
  const input = args.find(a => !a.startsWith('--'));
  if (!input) throw new Error('Usage: node scripts/sync-autumn-data.mjs [--check] <batch.json>');
  console.log(JSON.stringify(await syncAutumn(JSON.parse(await readFile(resolve(input), 'utf8')), { checkOnly, rebuildDerived: args.includes("--rebuild-derived") }), null, 2));
}
