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
    stdin: { contents: contents + '\nexport { Header, MenuOverlay, Footer, StatsView, readRoute, HomeView, LeaderboardsView, PlayerView, SprayChart, RollingChart, boardConfig, batterPitchTypeRows, PercentilePanel, deriveBatterSummary, derivePitcherSummary, BattedBallAnalysis, LaunchAngleDistribution, MetricTrendChart, ContinuousZoneHeatmap, PrintableBatterSpray, DeltaViewPanel, DeltaMetricCard, SELECTED_RANKINGS, GlossaryView, BatterApproachCard };', resolveDir: resolve(root, 'app'), loader: 'tsx' },
    bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' }, logLevel: 'silent',
  });
  const entry = resolve(scratch, 'app.mjs');
  await writeFile(entry, result.outputFiles[0].text);
  app = await import(pathToFileURL(entry).href);
  const barrel = await build({ entryPoints: [resolve(root, 'app/barrel-zone.tsx')], bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' }, logLevel: 'silent' });
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

for (const board of ['batting_profile', 'batting_ev', 'batting_hr', 'batting_percentile', 'batting_pitch_types', 'batting_value']) {
  test(`actual React table renders autumn batting records: ${board}`, () => {
    const markup = render('LeaderboardsView', { data, board, navigate });
    const body = markup.match(/<tbody>(.*?)<\/tbody>/s)?.[1];
    assert.ok(body && (body.match(/<tr /g) ?? body.match(/<tr>/g))?.length > 0, 'empty batting table');
    const header = markup.match(/<thead>(.*?)<\/thead>/s)?.[1];
    assert.doesNotMatch(header, /有効打球数|収録打席|>打席</);
    assert.ok(app.boardConfig(data, board).columns.every(column => !["pa", "bbe"].includes(column.key)));
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
  const card = markup.match(/<article class="feature-card">(?:(?!<\/article>)[\s\S])*最高打球速度(?:(?!<\/article>)[\s\S])*<\/article>/)?.[0] ?? '';
  assert.ok(card, 'measured exit velocity card remains visible');
  assert.ok(card.includes(highlights.exitVelocity.maxExitVelocity.toLocaleString("ja-JP", { maximumFractionDigits: 1 })));
  assert.ok(markup.includes(highlights.exitVelocity.kanji));
  if (batterDisplayMinimum(data.batters) === 1) assert.match(markup, /20打席未満・参考/);
  assert.match(markup, /打撃生産指数/);
});

test('home prioritizes search and rankings without the old inventory totals', () => {
  const markup = render('HomeView', { data, navigate });
  const intro = markup.match(/<section class="home-intro"[^>]*>(.*?)<\/section>/s)?.[1] ?? '';
  assert.match(intro, /投球・打球を検索/);
  assert.match(intro, /ランキングを見る/);
  assert.match(intro, /選手・球種・コースから探す/);
  assert.match(intro, /home-entry primary/);
  assert.match(intro, /home-entry secondary/);
  assert.match(intro, /<h1/);
  assert.match(intro, /class="home-accessible-title"/);
  assert.doesNotMatch(intro, /東都のプレーを|データで見る。|一球の特徴から|選手の強みまで|home-intro-copy|class="eyebrow"/);
  assert.doesNotMatch(markup, /data-summary/);
  for (const key of ['pitches', 'games', 'pitchers', 'batters']) {
    assert.ok(!intro.includes(`<strong>${data.metadata[key].toLocaleString('ja-JP')}</strong>`), key);
  }
});

test('analysis headings use functional names instead of decorative catchphrases', async () => {
  const batter = data.batters[0];
  const markup = render('BatterApproachCard', { pitches: data.pitches.filter(p => p.batterId === batter.id), leaguePitches: data.pitches, batter, minimumSample: 5, zone: { left: -.254, right: .254, bottom: .45, top: 1.05 }, filters: {} });
  assert.ok(markup.includes(`${batter.kanji || batter.name} 打者アプローチ`));
  assert.doesNotMatch(markup, /を、振る条件から読む/);
  assert.match(markup, /初球Swing%/);
  const css = await readFile(resolve(root, 'app/globals.css'), 'utf8');
  assert.doesNotMatch(css, /\.home-intro::(?:before|after)/);
  assert.match(css, /\.home-entry-actions\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.home-entry-actions\s*\{\s*grid-template-columns: 1fr/);
});

test('retired estimates are absent from rankings, glossary and legacy deep links', () => {
  const retired = /推定成績|推定打率|推定長打率|推定加重出塁率|推定被加重出塁率|推定失点率|xwOBA|xERA|xSLG|xBA/;
  for (const board of ['batting_percentile', 'pitching_percentile', 'batting_expected', 'pitching_expected']) {
    const html = render('LeaderboardsView', { data, board, navigate });
    assert.doesNotMatch(html, retired, board);
    assert.ok(html.includes('<tbody><tr'), board);
    assert.ok(app.boardConfig(data, board).columns.every(column => !['xba', 'xslg', 'xwoba', 'xwobaAllowed', 'xera'].includes(column.key)));
  }
  assert.doesNotMatch(render('GlossaryView', {}), retired);
});

test('filtered batter production uses actual results, never retired expected values', () => {
  const pitches = [{ result: 'インプレー', playResult: '二塁打', exitVelocity: 160, launchAngle: 20, expectedHit: 0, expectedTb: 0, expectedWoba: 0 }];
  const first = app.deriveBatterSummary({ xba: .5 }, pitches, { woba: .3 });
  const second = app.deriveBatterSummary({}, pitches.map(row => ({ ...row, expectedHit: 1, expectedTb: 4, expectedWoba: 2 })), { woba: .3 });
  assert.equal(first.wrcPlus, second.wrcPlus);
  assert.equal(first.woba, 1.247);
  for (const key of ['xba', 'xslg', 'xwoba']) assert.equal(key in first, false);
});

test('pitcher and batter profiles do not revive estimates from legacy player objects', () => {
  const retired = /推定打率|推定長打率|推定加重出塁率|推定被加重出塁率|推定失点率|xwOBA|xERA|xSLG/;
  for (const role of ['pitching', 'batting']) {
    const player = data.players.find(row => row[role] && (role === 'pitching' || !row.pitching));
    assert.ok(player, role);
    const html = render('PlayerView', { season: '2026-fall', data, player, navigate, news: [] });
    assert.doesNotMatch(html, retired, role);
    assert.match(html, /リーグ内評価/);
  }
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
  // Season leaders change as new games arrive. Check rendered ordering against
  // the input records, rather than pinning a past season's leader and totals.
  const countLeader = [...data.pitchers].sort((a, b) => b.strikeouts - a.strikeouts)[0];
  const rateLeader = data.pitchers.filter(p => p.pitches >= 100).sort((a, b) => b.strikeouts / b.pa - a.strikeouts / a.pa)[0];
  const byType = new Map();
  for (const p of data.pitches.filter(p => p.korbb === 'Strikeout')) {
    const key = JSON.stringify([p.pitcherId, p.pitchType]);
    const group = byType.get(key) || { id: p.pitcherId, kanji: p.pitcherKanji, type: p.pitchType, count: 0 };
    group.count++; byType.set(key, group);
  }
  const typeLeader = [...byType.values()].sort((a, b) => b.count - a.count)[0];
  const typeTotal = data.pitches.filter(p => p.pitcherId === typeLeader.id && p.korbb === 'Strikeout').length;
  const expected = [
    [countLeader.kanji, countLeader.strikeouts, (100 * countLeader.strikeouts / countLeader.pa).toFixed(1) + '%'],
    [rateLeader.kanji, rateLeader.strikeouts, (100 * rateLeader.strikeouts / rateLeader.pa).toFixed(1) + '%'],
    [typeLeader.kanji, typeLeader.type, typeLeader.count, (100 * typeLeader.count / typeTotal).toFixed(1) + '%'],
  ];
  for (const [index, board] of boards.entries()) {
    const markup = render('LeaderboardsView', { data, board, navigate });
    const body = markup.match(/<tbody>(.*?)<\/tbody>/s)?.[1];
    const firstRow = body?.match(/<tr[^>]*>(.*?)<\/tr>/s)?.[1] ?? '';
    for (const value of expected[index]) assert.ok(firstRow.includes(String(value)), `leader row missing ${value}`);
    assert.match(markup, /三振を取った球種/);
    assert.match(markup, /球種別の回転数/);
    assert.doesNotMatch(markup, /投球総合スコア/);
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

test('pitcher profiles preserve recorded strikeouts and distinguish running events and HBP', () => {
  const rows = [
    {result:'空振り',korbb:'Strikeout',strikes:0,outsOnPlay:1},
    {result:'ファウル',korbb:'Strikeout',strikes:3,outsOnPlay:1},
    {result:'ボール',playResult:'盗塁',balls:0,strikes:1},
    {result:'ボール',playResult:'盗塁死',balls:1,strikes:1,outsOnPlay:1},
    {result:'死球',korbb:'Walk'},
    {result:'敬遠',korbb:'Walk',balls:3},
  ];
  const summary=app.derivePitcherSummary({},rows,{});
  assert.equal(summary.pa,4);assert.equal(summary.strikeouts,2);assert.equal(summary.walks,1);
  assert.equal(summary.innings,'1.0');assert.equal('xwobaAllowed' in summary,false);
  for (const name of ['井上 悠','飯塚 遥己']) {
    const p=spring.pitchers.find(p=>p.kanji===name);assert.ok(p,name);
    const actual=app.derivePitcherSummary(p,spring.pitches.filter(row=>row.pitcherId===p.id),spring.league);
    assert.equal(actual.strikeouts,p.strikeouts,name);
    const pitches=spring.pitches.filter(row=>row.pitcherId===p.id);
    const outs=pitches.reduce((n,row)=>n+(row.outsOnPlay??0)+(row.korbb==='Strikeout'&&!row.outsOnPlay?1:0),0);
    assert.equal(actual.innings,`${Math.floor(outs/3)}.${outs%3}`,name);
  }
});

test('batted-ball panels and trends use the same fair-ball sample; missing angles do not become zero', () => {
  const contact={gameId:'g',date:'2026-09-08',result:'インプレー',hitType:'LineDrive',exitVelocity:150,launchAngle:10,plateX:0,plateZ:.8};
  const rows=[contact,{...contact,result:'ファウル',exitVelocity:200},{...contact,hitType:'Bunt',exitVelocity:60},{...contact,exitVelocity:170,launchAngle:null}];
  const props={player:{name:'Test',batterSide:'右'},seasonLabel:'2026秋'};
  const panel=render('BattedBallAnalysis',{pitches:rows,...props});
  const expected=render('BattedBallAnalysis',{pitches:[contact],...props});
  assert.equal(panel.split('<div class="chart-grid">')[0],expected.split('<div class="chart-grid">')[0]);
  assert.equal(render('MetricTrendChart',{pitches:rows,role:'batter'}),render('MetricTrendChart',{pitches:[contact],role:'batter'}));
  assert.equal(render('ContinuousZoneHeatmap',{pitches:rows,metric:'ev'}),render('ContinuousZoneHeatmap',{pitches:[contact],metric:'ev'}));
  assert.equal(render('LaunchAngleDistribution',{pitches:[{launchAngle:null}]}),render('LaunchAngleDistribution',{pitches:[]}));
});

test('real historical spray print and chronological charts handle slash dates', async () => {
  const past=JSON.parse(await readFile(resolve(root,'public/data/season-2025-fall.json'),'utf8'));
  const player=past.players.find(p=>p.id==='id:1000274786|中央大学');
  const pitches=past.pitches.filter(p=>p.batterId===player.id);
  assert.match(render('PrintableBatterSpray',{pitches,player,seasonLabel:'2025秋'}),/2025-09-24〜2025-10-24/);
  const rows=[{gameId:'late',date:'2025-10-21',velocity:142},{gameId:'early',date:'2025/10/7',velocity:140}];
  for(const [name,props] of [['RollingChart',{mode:'pitcher'}],['MetricTrendChart',{role:'pitcher'}]]) {
    const markup=render(name,{pitches:rows,...props});
    assert.ok(markup.indexOf('10-07')<markup.indexOf('10-21'));
  }
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


test('selected ranking screens render actual metrics and keep PA/BBE sample fields out of columns', () => {
  for (const [board, spec] of Object.entries(app.SELECTED_RANKINGS)) {
    const config = app.boardConfig(data, board);
    const markup = render('LeaderboardsView', { data, board, navigate });
    assert.ok(markup.includes(spec.label), board);
    const body = markup.match(/<tbody>(.*?)<\/tbody>/s)?.[1];
    assert.ok(body?.includes('<tr'), board);
    assert.doesNotMatch(body, /NaN|Infinity|undefined/);
    assert.ok(config.columns.every(c => !['pa', 'bbe'].includes(c.key)), board);
    const headerWithHelp = markup.match(/<thead>(.*?)<\/thead>/s)?.[1];
    for (const column of config.columns.filter(c => !['name', 'team'].includes(c.key))) assert.ok(headerWithHelp?.includes(`aria-label="${column.label}の説明を開く"`), `${board}: ${column.label}`);

    assert.ok(config.rows.some(r => r[config.minKey] >= config.minDefault && Number.isFinite(r[config.defaultSort])), board);
    if (board.startsWith('umpiring_')) {
      const header = markup.match(/<thead>(.*?)<\/thead>/s)?.[1];
      assert.doesNotMatch(header, /球数|比較球|対戦打席/);
      assert.match(markup, /球審検索/);
      assert.doesNotMatch(body, /class="text-link"/);
    }
  }
});


test('glossary includes the added ranking explanations and clickable labels', () => {
  const markup = render('GlossaryView', {});
  for (const label of ['ISO', 'BABIP', '平均持ち替え時間', '判定の一貫性', '球質を考慮したEV差 km/h']) assert.ok(markup.includes(`aria-label="${label}の説明を開く"`), label);
});


test('retired pitch scores stay absent from navigation, profiles, league tables and saved score links', () => {
  const retired = /PITCHスコア|総合投球スコア|球質スコア|コーススコア|投球総合スコア/;
  const pitcher = data.players.find(player => player.pitching?.pitches >= 100);
  for (const [component, props] of [
    ['HomeView', { data, navigate }],
    ['MenuOverlay', { data, navigate, close() {} }],
    ['Footer', { navigate }],
    ['StatsView', { data, navigate }],
    ['PlayerView', { data, player: pitcher, navigate, news: [], season: '2026-fall' }],
    ['GlossaryView', {}],
  ]) assert.doesNotMatch(render(component, props), retired, component);
  for (const board of ['pitching_percentile', 'pitching_expected', 'pitching_arsenal']) {
    const html = render('LeaderboardsView', { data, board, navigate });
    assert.doesNotMatch(html, retired, board);
    assert.ok(html.includes('<tbody><tr'), board);
    const config = app.boardConfig(data, board);
    assert.ok(config.columns.every(column => !['pitchingPlus', 'stuffPlus', 'locationPlus'].includes(column.key)));
    assert.notEqual(config.defaultSort, 'stuffPlus');
  }
  const header = render('Header', { searchText: '', setSearchText() {}, suggestions: [], onPlayer() {}, navigate, onMenu() {}, muted: true, onMuted() {}, season: '2026-fall', onSeason() {} });
  assert.doesNotMatch(header, retired);
  assert.match(header, /ランキング/);
  const previous = globalThis.window;
  try {
    globalThis.window = { location: { search: '?表示=quality' } };
    assert.equal(app.readRoute().view, 'home');
    globalThis.window.location.search = '?表示=leaders&指標=pitching_percentile';
    assert.equal(app.readRoute().board, 'pitching_strikeouts');
  } finally {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  }
});
