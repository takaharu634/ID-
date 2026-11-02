import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = new URL('../', import.meta.url).pathname;
let app, scratch, info, explanations, data;
before(async () => {
  scratch = await mkdtemp(resolve(root, '.metric-render-'));
  const contents = await readFile(resolve(root, 'app/savant-app.tsx'), 'utf8');
  const result = await build({
    stdin: { contents: contents + '\nexport { MetricDialogContent, MetricLabel, buildLeagueBenchmarks, resolveLeagueMetricBenchmarks, METRIC_INFO, getMetricInfo };', resolveDir: resolve(root, 'app'), loader: 'tsx' },
    bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' }, logLevel: 'silent',
  });
  const entry = resolve(scratch, 'app.mjs');
  await writeFile(entry, result.outputFiles[0].text);
  app = await import(pathToFileURL(entry).href);
  info = app.METRIC_INFO;
  explanations = await readFile(resolve(root, 'lib/metric-explanations.ts'), 'utf8');
  data = JSON.parse(await readFile(resolve(root, 'public/data/season-2026-fall.json'), 'utf8'));
});
after(async () => { if (scratch) await rm(scratch, { recursive: true, force: true }); });
const render = (key, benchmarks = []) => renderToStaticMarkup(createElement(app.MetricDialogContent, { info: info[key], benchmarks, titleId: 'metric-title', onClose() {} }));

test('every metric uses one detailed explanation without removed sections', () => {
  for (const [key, value] of Object.entries(info)) {
    assert.match(explanations, new RegExp(`\\b${key}:`), `${key}: missing editorial explanation`);
    const html = render(key);
    assert.ok(html.includes(value.title), key);
    assert.ok(html.includes('<h3>解説</h3>'), key);
    assert.doesNotMatch(html, /何を表すか|数値の見方|東都版での計算|手動版での計算|計算方法|実際の成績との比べ方|<h3>注意点<\/h3>/, key);
    const body = html.split('metric-dialog-content')[1].split('metric-dialog-done')[0];
    assert.equal((body.match(/<p>/g) ?? []).length, 2, key);
  }
});

test('clickable metric labels no longer render a circled information icon', () => {
  for (const key of Object.keys(info)) {
    const html = renderToStaticMarkup(createElement(app.MetricLabel, { label: info[key].title, metricKey: key }));
    assert.match(html, /<button/);
    assert.match(html, /aria-haspopup="dialog"/);
    assert.doesNotMatch(html, /<b(?:\s|>)|ⓘ|>i</);
  }
  assert.equal(app.getMetricInfo('homeRuns', '被本塁打'), info.homeRunsAllowed, 'semantic labels must distinguish pitcher and batter results');
  assert.match(render('whiffRate'), /投手と打者で評価する方向が反対/);
});

test('active batting index places the existing four benchmark levels next to its heading', () => {
  const benchmarks = app.buildLeagueBenchmarks(data);
  const score = benchmarks.batting.wrcPlus;
  assert.equal(score.average, 100);
  const html = render('wrcPlus', [{ role: '打者', value: score }]);
  const header = html.split('</header>')[0];
  for (const label of ['指標解説', '打者', 'リーグ平均', '優秀ライン', '非常に優秀', '注意ライン']) assert.ok(header.includes(label), label);
  assert.equal((header.match(/<dt>/g) ?? []).length, 4);
});

test('lower-is-better metrics reverse the benchmark comparison signs', () => {
  const benchmarks = app.buildLeagueBenchmarks(data);
  const html = render('avgExitVelocityAllowed', [{ role: '投手', value: benchmarks.pitching.avgExitVelocityAllowed }]);
  assert.match(html, /優秀ライン<\/dt><dd>≤/);
  assert.match(html, /非常に優秀<\/dt><dd>≤/);
  assert.match(html, /注意ライン<\/dt><dd>≥/);
});

test('additional batting, pitching, catching and umpiring metrics use actual league data', () => {
  const values = app.buildLeagueBenchmarks(data);
  for (const key of ['iso', 'walkHbpRate', 'avgExchange', 'consistencyRate', 'avgPopTime', 'avgLaunchAngle', 'homeRunsAllowed']) {
    const resolved = values.resolve(key);
    assert.ok(resolved.length > 0, key);
    for (const { value } of resolved) assert.ok(Number.isFinite(value.average), key);
  }
  const launchAngle = values.resolve('avgLaunchAngle')[0].value;
  assert.equal(launchAngle.excellent, null, 'a larger angle is not universally better');
  assert.doesNotMatch(render('avgLaunchAngle', values.resolve('avgLaunchAngle')), /優秀ライン|非常に優秀|注意ライン/);
  assert.deepEqual(values.resolve('velocityStatus'), [], 'text statuses must not become numeric averages');
  const noData = { ...data, pitchers: [], batters: [], catchers: [], pitches: [] };
  assert.deepEqual(app.buildLeagueBenchmarks(noData).resolve('iso'), []);
});

test('mobile benchmark styles do not force horizontal scrolling', async () => {
  const css = await readFile(resolve(root, 'app/globals.css'), 'utf8');
  assert.doesNotMatch(css, /\.metric-dialog-benchmarks section\s*\{\s*min-width:520px/);
  assert.doesNotMatch(css, /\.metric-term > b/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});
