import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AUTUMN_FOLDER_ID, mergeAutumnSources, parseTrackman, normalizeBatch, listingFingerprint } from '../lib/trackman-folder-import.mjs';
import { validateAutumnBatting } from '../lib/autumn-batting-validation.mjs';
import { buildDatasetFromCsv } from '../lib/csv-analytics.js';
import { syncAutumn } from '../scripts/sync-autumn-data.mjs';

const header = 'Date,PitchUID,GameUID,PitchNo,Pitcher,Batter,PitchCall,RelSpeed,PitcherTeam,BatterTeam,HomeTeam,AwayTeam,Inning,Top/Bottom,Outs,Balls,Strikes,Notes';
const csv = (id = 'pitch-1', date = '2026-09-08', speed = '140') => `${header}\r\n${date},${id},game-1,1,"Pitcher, One","Batter, One",StrikeCalled,${speed},AOY_UNI,CHU_UNI,AOY_UNI,CHU_UNI,1,Top,0,0,0,"comma, and ""quote""\nnew line"\r\n`;
const source = text => ({ name: '20260908-game.csv', bytes: Buffer.from(text) });

test('quoted CSV survives parsing; duplicate pitches count once; conflicting pitches fail', () => {
  const result = mergeAutumnSources([source(csv()), source(csv())]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.duplicates, 1);
  assert.equal(parseTrackman(Buffer.from(result.csv)).rows[0].Notes, 'comma, and "quote"\nnew line');
  assert.throws(() => mergeAutumnSources([source(csv()), source(csv('pitch-1', '2026-09-08', '141'))]), /競合/);
  assert.throws(() => mergeAutumnSources([source(csv('pitch-2', '2026-04-08'))]), /2026秋/);
  assert.throws(() => parseTrackman(Buffer.from(csv().slice(0, -10))), /切れ|列数/);
  assert.throws(() => mergeAutumnSources([source(csv('pitch-2', '2026-09-09'))]), /ファイル名/);
});

test('repeat sync is byte-identical and a broken update leaves the last dataset intact', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tohto-autumn-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'incoming.csv');
  await writeFile(path, csv());
  const batch = { folderId: AUTUMN_FOLDER_ID, files: [{ id: 'source-1', name: '20260908-game.csv', modifiedTime: '2026-09-08T06:00:00Z', size: Buffer.byteLength(csv()), path }] };
  const first = await syncAutumn(batch, { root });
  assert.equal(first.pitches, 1);
  const datasetPath = join(root, 'public/data/season-2026-fall.json');
  const before = await readFile(datasetPath, 'utf8');
  assert.equal((await syncAutumn(batch, { root })).changed, false);
  assert.equal(await readFile(datasetPath, 'utf8'), before);
  const status = JSON.parse(await readFile(join(root, 'public/data/trackman-2026-fall-status.json'), 'utf8'));
  assert.equal(status.listingFingerprint, listingFingerprint(normalizeBatch(batch)));
  assert.equal(JSON.parse(before).pitches[0].result, '見逃しストライク');
  assert.equal(JSON.parse(before).pitches[0].velocity, 140);
  for (const text of [csv('pitch-2'), csv('pitch-1', '2026-04-08'), csv().slice(0, -10)]) {
    await writeFile(path, text);
    const broken = { ...batch, files: [{ ...batch.files[0], modifiedTime: '2026-09-09T06:00:00Z', size: Buffer.byteLength(text) }] };
    await assert.rejects(syncAutumn(broken, { root }));
    assert.equal(await readFile(datasetPath, 'utf8'), before);
  }
  const removed = await syncAutumn({ ...batch, files: [] }, { root });
  assert.equal(removed.changed, false);
  assert.deepEqual(removed.retainedMissingIds, ['source-1']);
  assert.equal(await readFile(datasetPath, 'utf8'), before);
});

test('published autumn input has unique pitches and matches the verified source inventory', async () => {
  const dataset = JSON.parse(await readFile(new URL('../public/data/season-2026-fall.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(await readFile(new URL('../data/trackman/2026-fall/manifest.json', import.meta.url), 'utf8'));
  const sources = await Promise.all(manifest.files.map(async f => ({ name: f.name, bytes: await readFile(new URL(`../data/trackman/2026-fall/${f.id}.csv`, import.meta.url)) })));
  const merged = mergeAutumnSources(sources);
  assert.equal(new Set(dataset.pitches.map(p => p.id)).size, dataset.pitches.length);
  assert.deepEqual(new Set(dataset.pitches.map(p => p.id)), new Set(merged.rows.map(r => r.PitchUID)));
  validateAutumnBatting(dataset, merged.rows);
  assert.equal(dataset.pitches.length, manifest.summary.pitches);
  assert.equal(dataset.games.length, manifest.summary.games);
  assert.ok(dataset.pitches.every(p => p.year === 2026 && p.season === '秋'));
  const corrected = dataset.pitches.find(p => p.id === 'd688e1b0-bdf8-11f1-8598-61febcdafd6c');
  assert.equal(corrected.exitVelocity, null);
  assert.equal(corrected.qabMeasurements.ev, null);
  assert.equal(corrected.playResult, 'アウト');
  assert.equal(dataset.batters.find(b => b.id === corrected.batterId).maxExitVelocity, 172);
});

test('confirmed Aizawa EV error stays excluded on CSV reimport without deleting the pitch or other high EVs', async () => {
  const bytes = await readFile(new URL('../data/trackman/2026-fall/1EonxwARwSaAAV3BLELOWmMLUwQ1XILFq.csv', import.meta.url));
  const raw = parseTrackman(bytes).rows.find(r => r.PitchUID === 'd688e1b0-bdf8-11f1-8598-61febcdafd6c');
  assert.equal(raw.ExitSpeed, '190.02336');
  const { buildDatasetFromRows } = await import('../lib/csv-analytics.js');
  const d = buildDatasetFromRows([raw, { ...raw, PitchUID: 'another-valid-high-EV', PitchNo: '61' }], { season: '2026年秋季' });
  assert.equal(d.pitches.length, 2);
  assert.equal(d.pitches[0].exitVelocity, null);
  assert.equal(d.pitches[0].qabMeasurements.ev, null);
  assert.equal(d.pitches[0].outsOnPlay, 2);
  assert.equal(d.pitches[1].exitVelocity, 190);
  assert.equal(d.batters[0].bbe, 1);
  const merged = mergeAutumnSources([{ name: '20261002-JinguStadium-1_unverified.csv', bytes }]);
  const reimported = buildDatasetFromCsv(merged.csv, { season: '2026年秋季' });
  validateAutumnBatting(reimported, merged.rows);
  assert.equal(reimported.pitches.find(p => p.id === raw.PitchUID).exitVelocity, null);
  assert.equal(raw.ExitSpeed, '190.02336');
});

test('folder sync preserves the agreed Nita and Fujimoto pitch classifications', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tohto-autumn-player-rules-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'incoming.csv');
  const columns = 'Date,PitchUID,GameUID,PitchNo,Pitcher,Batter,PitchCall,RelSpeed,PitcherTeam,BatterTeam,HomeTeam,AwayTeam,Inning,Top/Bottom,Outs,Balls,Strikes,TaggedPitchType';
  const text = `${columns}\n` + [
    '2026-09-18,nita-low,game-1,1,"Nita, Haruto",Batter,StrikeCalled,144.99,RIS_UNI,KOK_UNI,RIS_UNI,KOK_UNI,1,Top,0,0,0,Fastball',
    '2026-09-18,nita-high,game-1,2,"Nita, Haruto",Batter,StrikeCalled,145,RIS_UNI,KOK_UNI,RIS_UNI,KOK_UNI,1,Top,0,0,1,Fastball',
    '2026-09-18,fujimoto-ch,game-1,3,"Fujimoto, Shisei",Batter,StrikeCalled,120,KOK_UNI,RIS_UNI,RIS_UNI,KOK_UNI,1,Bottom,0,0,0,Curveball',
  ].join('\n') + '\n';
  await writeFile(path, text);
  await syncAutumn({ folderId: AUTUMN_FOLDER_ID, files: [{ id: 'source-1', name: '20260918-game.csv', modifiedTime: '2026-09-25T12:00:00Z', size: Buffer.byteLength(text), path }] }, { root });
  const dataset = JSON.parse(await readFile(join(root, 'public/data/season-2026-fall.json'), 'utf8'));
  assert.deepEqual(dataset.pitches.map(p => p.pitchType), ['シンカー', 'ストレート', 'チェンジアップ']);
});


test('missing batting rows or lost measured contact blocks writes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tohto-batting-gate-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'incoming.csv');
  const text = 'Date,PitchUID,GameUID,PitchNo,Pitcher,Batter,PitchCall,RelSpeed,PitcherTeam,BatterTeam,HomeTeam,AwayTeam,Inning,Top/Bottom,Outs,Balls,Strikes,ExitSpeed,Angle,Direction,Bearing,Distance,TaggedHitType,PlayResult\n2026-09-08,pitch-1,game-1,1,Pitcher,Batter,InPlay,140,AOY_UNI,CHU_UNI,AOY_UNI,CHU_UNI,1,Top,0,0,0,155,18,5,6,85,LineDrive,Single\n';
  await writeFile(path, text);
  const batch = { folderId: AUTUMN_FOLDER_ID, files: [{ id: 'source-1', name: '20260908-game.csv', modifiedTime: '2026-09-08T06:00:00Z', size: Buffer.byteLength(text), path }] };
  await syncAutumn(batch, { root });
  const datasetPath = join(root, 'public/data/season-2026-fall.json');
  const before = await readFile(datasetPath, 'utf8');
  const changed = { ...batch, files: [{ ...batch.files[0], modifiedTime: '2026-09-09T06:00:00Z' }] };
  for (const corrupt of [d => { d.batters = []; }, d => { d.batters[0].avgExitVelocity = null; }, d => { d.pitches[0].direction = null; }, d => { d.players[0].roles = []; }]) {
    await assert.rejects(syncAutumn(changed, { root, build: (...args) => { const d = buildDatasetFromCsv(...args); corrupt(d); return d; } }), /打者・打球/);
    assert.equal(await readFile(datasetPath, 'utf8'), before);
  }
});

test('new CSV refreshes batting and animation together; unchanged re-run preserves every output', async t => {
  const root = await mkdtemp(join(tmpdir(), 'tohto-complete-sync-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const firstPath = join(root, 'first.csv'), nextPath = join(root, 'second.csv');
  const columns = 'Date,PitchUID,GameUID,PitchNo,Pitcher,Batter,PitchCall,RelSpeed,PitcherTeam,BatterTeam,HomeTeam,AwayTeam,Inning,Top/Bottom,Outs,Balls,Strikes,ExitSpeed,Angle,Direction,Bearing,Distance,TaggedHitType,PlayResult,TaggedPitchType,SpinRate,SpinAxis,Tilt,InducedVertBreak,HorzBreak,vx0,vy0,vz0,ax0,ay0,az0,y0,Extension';
  const pitch = (id, no, ev) => `${columns}\n2026-09-08,${id},game-1,${no},Pitcher,Batter,InPlay,144,AOY_UNI,CHU_UNI,AOY_UNI,CHU_UNI,1,Top,0,0,0,${ev},18,5,6,85,LineDrive,Single,Fastball,2400,180,12:00,40,0,0,-40,0,0,8,-5,15.24,2\n`;
  const one = pitch('pitch-1', 1, 150), two = pitch('pitch-2', 2, 160);
  await writeFile(firstPath, one); await writeFile(nextPath, two);
  const file = (id, path, text) => ({ id, name: '20260908-game.csv', modifiedTime: '2026-09-08T06:00:00Z', size: Buffer.byteLength(text), path });
  const batch = { folderId: AUTUMN_FOLDER_ID, files: [file('source-1', firstPath, one)] };
  await syncAutumn(batch, { root });
  batch.files.push(file('source-2', nextPath, two));
  const result = await syncAutumn(batch, { root });
  assert.equal(result.pitches, 2); assert.equal(result.spinPitches, 2);
  const d = JSON.parse(await readFile(join(root, 'public/data/season-2026-fall.json'), 'utf8'));
  assert.equal(d.batters[0].bbe, 2); assert.equal(d.batters[0].avgExitVelocity, 155);
  const animation = JSON.parse(await readFile(join(root, 'public/data/spin-2026-fall.json'), 'utf8'));
  assert.deepEqual(animation.map(row => row.pitchId), ['pitch-1', 'pitch-2']);
  const outputs = ['public/data/season-2026-fall.json', 'public/data/spin-2026-fall.json', 'public/data/trackman-2026-fall-status.json', 'data/trackman/2026-fall/manifest.json'];
  const before = await Promise.all(outputs.map(path => readFile(join(root, path), 'utf8')));
  assert.equal((await syncAutumn(batch, { root })).changed, false);
  assert.deepEqual(await Promise.all(outputs.map(path => readFile(join(root, path), 'utf8'))), before);
});
