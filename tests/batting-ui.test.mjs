import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { batterDisplayMinimum, displayedBatters, batterDisplayHighlights, isMeasuredFairBall } from '../lib/batter-display.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// An existing installation of the same locked React/esbuild versions may be
// used for local rendering. This neither installs packages nor changes a repo.
const dependencyRoot = process.env.TOHTO_TEST_DEPENDENCY_ROOT || root;
const require = createRequire(resolve(dependencyRoot, 'package.json'));
const { build } = require('esbuild');
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
let app, data, spring, scratch, BarrelView;
const render = (name, props) => renderToStaticMarkup(createElement(app[name], props));
const navigate = () => {};

before(async () => {
  // Export existing components only in the test bundle; production is unchanged.
  scratch = await mkdtemp(resolve(dependencyRoot, '.batting-render-'));
  const contents = await readFile(resolve(root, 'app/savant-app.tsx'), 'utf8');
  const result = await build({
    stdin: { contents: contents + '\nexport { HomeView, LeaderboardsView, PlayerView, SprayChart, RollingChart, boardConfig, batterPitchTypeRows, PercentilePanel, deriveBatterSummary, DeltaViewPanel, DeltaMetricCard };', resolveDir: resolve(root, 'app'), loader: 'tsx' },
    bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', logLevel: 'silent',
  });
  const entry = resolve(scratch, 'app.mjs');
  await writeFile(entry, result.outputFiles[0].text);
  app = await import(pathToFileURL(entry).href);
  const barrel = await build({ entryPoints: [resolve(root, 'app/barrel-zone.tsx')], bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', logLevel: 'silent' });
  const barrelEntry = resolve(scratch, 'barrel.mjs'); await writeFile(barrelEntry, barrel.outputFiles[0].text);
  BarrelView = (await import(pathToFileURL(barrelEntry).href)).default;
  data = JSON.parse(await readFile(resolve(root, 'public/data/season-2026-fall.json'), 'utf8'));
  spring = JSON.parse(await readFile(resolve(root, 'public/data/season-2026-spring.json'), 'utf8'));
});
after(async () => { if (scratch) await rm(scratch, { recursive: true, force: true }); });

test('autumn minimum shows early-season hitters; spring keeps qualified defaults', () => {
  assert.equal(batterDisplayMinimum([{ pa: 15 }, { pa: 1 }]), 1);
  assert.equal(batterDisplayMinimum([{ pa: 20 }, { pa: 1 }]), 20);
  assert.equal(batterDisplayMinimum(spring.batters), 20);
  assert.ok(displayedBatters(data.batters).length > 0);
  assert.ok(displayedBatters(spring.batters).every(row => row.pa >= 20));
  assert.equal(app.boardConfig(spring, 'batting_ev').minDefault, 20);
});

for (const board of ['batting_profile', 'batting_ev', 'batting_expected', 'batting_hr', 'batting_percentile', 'batting_pitch_types', 'batting_value']) {
  test(`actual React table renders autumn batting records: ${board}`, () => {
    const markup = render('LeaderboardsView', { data, board, navigate });
    const body = markup.match(/<tbody>(.*?)<\/tbody>/s)?.[1];
    assert.ok(body && (body.match(/<tr /g) ?? body.match(/<tr>/g))?.length > 0, 'empty batting table');
    assert.match(markup, /有効打球数/);
    assert.match(markup, /20打席未満は参考値/);
    assert.ok(markup.includes(`value="${app.boardConfig(data, board).minDefault}"`));
    const config = app.boardConfig(data, board);
    const measured = config.rows.find(row => row[config.minKey] >= config.minDefault && row.bbe >= 5 && row.kanji);
    assert.ok(body.includes(measured.kanji), 'measured batter missing from UI');
    if (board === 'batting_ev') {
      assert.ok(body.includes(measured.avgExitVelocity.toLocaleString("ja-JP", { maximumFractionDigits: 1 })));
      assert.ok(body.includes(measured.maxExitVelocity.toLocaleString("ja-JP", { maximumFractionDigits: 1 })));
    }
  });
}

test('home batting and exit velocity highlights render actual players and numbers', () => {
  const markup = render('HomeView', { data, navigate });
  const highlights = batterDisplayHighlights(data.batters);
  assert.ok(Number.isFinite(highlights.exitVelocity.maxExitVelocity));
  const card = markup.split('<article class="feature-card">')[3].split('</article>')[0];
  assert.ok(card.includes(highlights.exitVelocity.maxExitVelocity.toLocaleString("ja-JP", { maximumFractionDigits: 1 })));
  assert.ok(markup.includes(highlights.exitVelocity.kanji));
  if (batterDisplayMinimum(data.batters) === 1) assert.match(markup, /20打席未満・参考/);
  assert.match(markup, /打撃生産指数/);
});

test('dedicated AVG and OPS rankings use existing values and the matching PA sample', () => {
  for (const [board, metric] of [['batting_average', 'battingAverage'], ['batting_ops', 'ops']]) {
    const config = app.boardConfig(spring, board);
    assert.equal(config.defaultSort, metric);
    assert.equal(config.defaultDirection, 'desc');
    const markup = render('LeaderboardsView', { data: spring, board, navigate });
    const body = markup.match(/<tbody>(.*?)<\/tbody>/s)?.[1];
    assert.ok(body?.includes('<tr'));
    const official = spring.batters.find(row => row.officialRecord && row.trackmanRecord.pa !== row.pa);
    assert.ok(official);
    const row = config.rows.find(row => row.id === official.id);
    assert.equal(row[metric], official[metric]);
    assert.equal(row.pa, board === 'batting_ops' ? official.trackmanRecord.pa : official.pa);
    if (board === 'batting_ops') {
      assert.match(markup, /OPSは収録データによる参考値/);
      assert.match(markup, /犠打・犠飛が区別されていない/);
    }
  }
});

test('strikeout rankings render the correct leaders and understandable navigation', () => {
  const boards = ['pitching_strikeouts', 'pitching_strikeout_rate', 'pitching_strikeout_pitches'];
  const expected = [/鈴木 泰成.*25.*21\.0%/, /髙木 大希.*13.*48\.1%/, /鈴木 泰成.*ストレート.*12.*48\.0%/];
  for (const [index, board] of boards.entries()) {
    const markup = render('LeaderboardsView', { data, board, navigate });
    const body = markup.match(/<tbody>(.*?)<\/tbody>/s)?.[1];
    assert.match(body?.match(/<tr[^>]*>(.*?)<\/tr>/s)?.[1] ?? '', expected[index]);
    assert.match(markup, /三振を取った球種/);
    assert.match(markup, /球種別の回転数/);
    assert.match(markup, /投球総合スコア/);
    assert.doesNotMatch(markup, /投球間隔|回転方向|パーセンタイル|打球プロファイル/);
  }
});

test('batter detail renders measured exit speed, sample counts and unavailable evaluation honestly', () => {
  const batter = data.batters.find(row => row.bbe >= 5 && data.players.find(p => p.id === row.id)?.roles.join() === '打者');
  // Exercise an early-season profile even after the live season passes 20 PA.
  const player = { ...data.players.find(row => row.id === batter.id), batting: { ...batter, pa: 15, percentiles: {} } };
  const markup = render('PlayerView', { season: '2026-fall', data, player, navigate, news: [] });
  assert.ok(markup.includes(player.kanji));
  assert.ok(markup.includes(batter.avgExitVelocity.toLocaleString("ja-JP", { maximumFractionDigits: 1 })));
  assert.ok(markup.includes(batter.maxExitVelocity.toLocaleString("ja-JP", { maximumFractionDigits: 1 })));
  assert.match(markup, /有効打球数/);
  assert.match(markup, /リーグ内評価に必要なデータがまだ揃っていません/);
  assert.doesNotMatch(markup, /percent-bar[^>]*width:50%/);
});

test('spray chart preserves measured direction and distance in real SVG markers', () => {
  const batter = data.batters.find(row => row.bbe >= 5);
  const pitches = data.pitches.filter(row => row.batterId === batter.id);
  const plottable = pitches.filter(row => row.result === 'インプレー' && Number.isFinite(row.sprayAngle ?? row.direction) && Math.abs(row.sprayAngle ?? row.direction) <= 45 && ((Number.isFinite(row.distance) && row.distance > 0) || row.playResult === '本塁打'));
  assert.ok(plottable.length >= 5);
  const markup = render('SprayChart', { pitches, allPoints: true });
  assert.equal((markup.match(/<title>/g) ?? []).length, plottable.length);
  assert.ok(markup.includes(`${plottable[0].distance}m`));
  assert.doesNotMatch(markup, /(?:cx|cy)="NaN"/);
});

test('pitch-type summaries and daily charts exclude fouls and bunts from valid contact averages', () => {
  const rows = app.batterPitchTypeRows(data);
  for (const group of rows.filter(row => row.bbe)) {
    const contacts = data.pitches.filter(row => row.batterId === group.batterId && row.pitchType === group.pitchType && isMeasuredFairBall(row));
    assert.equal(group.bbe, contacts.length);
    assert.equal(group.avgExitVelocity, contacts.reduce((sum, row) => sum + row.exitVelocity, 0) / contacts.length);
  }
  const contact = { result: 'インプレー', hitType: 'LineDrive', exitVelocity: 150, launchAngle: 0, date: '2026-09-08' };
  const markup = render('RollingChart', { mode: 'batter', pitches: [contact, { ...contact, result: 'ファウル', exitVelocity: 200 }, { ...contact, hitType: 'Bunt', exitVelocity: 60 }] });
  assert.match(markup, />150\.0</);
  assert.equal(isMeasuredFairBall({ ...contact, exitVelocity: null }), false);
  const filtered = app.deriveBatterSummary({ bbe: 50, percentiles: { avgExitVelocity: 90 } }, [contact], data.league);
  assert.equal(filtered.bbe, 1);
  assert.equal(filtered.avgExitVelocity, 150);
  assert.deepEqual(filtered.percentiles, {});
});

test('unavailable evaluation never becomes a neutral 50 percentile; a valid zero remains zero', () => {
  assert.match(render('PercentilePanel', { title: '評価', rows: [] }), /必要なデータ/);
  const markup = render('PercentilePanel', { title: '評価', rows: [{ label: '試験', value: 0 }] });
  assert.match(markup, /width:0%/);
  assert.doesNotMatch(markup, /width:50%/);
  assert.doesNotMatch(render('PercentilePanel', { title: '評価', rows: [{ label: '未計測', value: null }] }), /width:(?:0|50)%/);
});


test('season comparison exposes autumn and renders dynamic period labels', () => {
  const controls = render('DeltaViewPanel', { initialBefore: '2026-spring', initialAfter: '2026-fall' });
  assert.match(controls, /value="2026-fall" selected=""/);
  const card = render('DeltaMetricCard', { label: '球速', fall: 140, spring: 142, beforeLabel: '2026春', afterLabel: '2026秋' });
  assert.match(card, /2026春/); assert.match(card, /2026秋/); assert.match(card, /\+2\.0/);
  assert.doesNotMatch(card, /2025 秋/);
});


test('barrel view uses current autumn records immediately and lists every university', () => {
  const markup = renderToStaticMarkup(createElement(BarrelView, { initialSeason: '2026-fall', initialData: data }));
  for (const team of data.teams) assert.ok(markup.includes(team.name));
  assert.match(markup, /2026秋（左右比較）/);
  assert.match(markup, /barrel-zone-cell/);
  assert.doesNotMatch(markup, /シーズンデータを集計しています/);
});
