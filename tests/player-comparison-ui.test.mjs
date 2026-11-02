import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let scratch, app, table, data, old;
before(async () => {
  scratch = await mkdtemp(resolve('.batting-render-'));
  const source = await readFile('app/savant-app.tsx', 'utf8');
  const output = await build({ stdin: { contents: source + '\nexport { CompareView };', resolveDir: resolve('app'), loader: 'tsx' }, bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' }, logLevel: 'silent' });
  const entry = resolve(scratch, 'app.mjs'); await writeFile(entry, output.outputFiles[0].text); app = await import(pathToFileURL(entry));
  const out = await build({ entryPoints: ['app/pitch-component-comparison.tsx'], bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', logLevel: 'silent' });
  const tableEntry = resolve(scratch, 'table.mjs'); await writeFile(tableEntry, out.outputFiles[0].text); table = (await import(pathToFileURL(tableEntry))).default;
  data = JSON.parse(await readFile('public/data/season-2026-fall.json', 'utf8'));
  old = JSON.parse(await readFile('public/data/season-2025-fall.json', 'utf8'));
});
after(async () => { if (scratch) await rm(scratch, { recursive: true, force: true }); });

test('actual comparison screen renders three independently labelled season/pitcher selectors', () => {
  const html = renderToStaticMarkup(createElement(app.CompareView, { data, navigate() {} }));
  assert.equal((html.match(/class="pitch-compare-slot"/g) ?? []).length, 3);
  assert.equal((html.match(/<label>シーズン/g) ?? []).length, 3);
  for (const label of ['2026年 秋季リーグ', '2026年 春季リーグ', '2025年 秋季リーグ']) assert.ok(html.includes(label));
  assert.match(html, /DELTA VIEW/); assert.match(html, /球種/); assert.doesNotMatch(html, /NaN|Infinity/);
});

test('actual table renders distinct values for a shared ID across seasons, and missing pitch types as dashes', () => {
  const player = { id: 'p', kanji: '同じ投手', team: '大学' };
  const entries = [
    { key: 'fall', season: '2026-fall', playerId: 'p', player, pitchTypes: [{ pitchType: 'ストレート', avgVelocity: 150.1 }, { pitchType: 'フォーク', avgVelocity: 130.2 }] },
    { key: 'old', season: '2025-fall', playerId: 'p', player, pitchTypes: [{ pitchType: 'ストレート', avgVelocity: 140.3 }] },
  ];
  const props = { entries, pitchType: '', onPitchTypeChange() {}, onSelectPlayer() {} };
  const html = renderToStaticMarkup(createElement(table, props));
  assert.match(html, /<td>150\.1<\/td><td>140\.3<\/td>/);
  assert.match(html, /<td>130\.2<\/td><td>—<\/td>/);
  assert.match(html, /大学<\/span><span>2026年 秋季リーグ/);
  assert.match(html, /大学<\/span><span>2025年 秋季リーグ/);
  const filtered = renderToStaticMarkup(createElement(table, { ...props, pitchType: 'フォーク' }));
  assert.equal((filtered.match(/class="pitch-compare-section"/g) ?? []).length, 1);
  assert.doesNotMatch(filtered, /150\.1|140\.3/);
});

test('historical player absent from the current roster renders with their original name, team and numbers', () => {
  const pitcher = old.pitchers.find(player => /Nakanishi, Masaki/.test(player.name ?? ''));
  assert.ok(pitcher); assert.ok(!data.pitchers.some(player => player.id === pitcher.id));
  const arsenal = old.pitchTypes.filter(row => row.pitcherId === pitcher.id);
  const html = renderToStaticMarkup(createElement(table, { entries: [{ key: 'nakanishi-2025', season: '2025-fall', playerId: pitcher.id, player: pitcher, pitchTypes: arsenal }], pitchType: '', onPitchTypeChange() {}, onSelectPlayer() {} }));
  assert.match(html, /Nakanishi, Masaki/); assert.match(html, /青山学院大学/); assert.match(html, /2025年 秋季リーグ/);
  assert.ok(html.includes(arsenal[0].avgVelocity.toFixed(1)));
});
