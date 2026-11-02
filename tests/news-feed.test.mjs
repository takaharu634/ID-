import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

test('NEWS renders the verified Toyo report with separate fact and analysis', async () => {
  const feed = JSON.parse(await readFile('public/data/news_feed.json', 'utf8'));
  const item = feed.find(row => row.id === 'toyo-aoyama-first-game-batting-2026-09-21');
  assert.ok(item);
  assert.equal(item.publishedAt, '2026-09-21');
  assert.equal(item.sourceUrl, 'https://sports-toyo.com/news/detail/id/32990');
  assert.equal(item.playerKanji, 'チーム全体');
  assert.equal(item.playerId, undefined);
  assert.equal(feed.filter(row => row.sourceUrl === item.sourceUrl).length, 1);
  const directory = await mkdtemp(path.resolve('.sites-runtime/news-render-'));
  try {
    const contents = await readFile('app/savant-app.tsx', 'utf8');
    const result = await build({
      stdin: { contents: contents + '\nexport { NewsView };', resolveDir: path.resolve('app'), loader: 'tsx' },
      bundle: true, write: false, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', logLevel: 'silent',
      loader: { '.css': 'empty' },
    });
    const entry = path.join(directory, 'news.mjs');
    await writeFile(entry, result.outputFiles[0].text);
    const { NewsView } = await import(pathToFileURL(entry).href);
    const teams = [...new Set(feed.map(row => row.team))].map(name => ({ name }));
    const html = renderToStaticMarkup(createElement(NewsView, { items: feed, data: { teams }, navigate() {} }));
    assert.ok(html.includes(item.headline));
    assert.ok(html.includes(item.fact));
    assert.ok(html.includes(item.savant));
    assert.ok(html.includes(`href="${item.sourceUrl}"`));
    assert.match(html, /<h3>事実<\/h3>/);
    assert.match(html, /<h3>ID東都で見る<\/h3>/);
    assert.equal((html.match(/class="news-card"/g) || []).length, feed.length);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('latest NEWS links the verified Aoyama player master and remains unique', async () => {
  const feed = JSON.parse(await readFile('public/data/news_feed.json', 'utf8'));
  const item = feed.find(row => row.id === 'aoyama-morisawa-first-official-homer-2026-09-22');
  assert.ok(item);
  assert.equal(item.publishedAt, '2026-09-22');
  assert.equal(item.playerKanji, '森澤 拓海');
  assert.equal(item.playerId, 'id:1000325040|青山学院大学');
  assert.equal(item.sourceUrl, 'https://aoyamasports.conohawing.com/?p=12520');
  assert.equal(feed.filter(row => row.sourceUrl === item.sourceUrl).length, 1);
});

test('latest NEWS links the autumn MVP to the verified Asia player master', async () => {
  const feed = JSON.parse(await readFile('public/data/news_feed.json', 'utf8'));
  const item = feed.find(row => row.id === 'asia-yamasato-autumn-mvp-2026-10-24');
  assert.ok(item);
  assert.equal(item.publishedAt, '2026-10-24');
  assert.equal(item.playerKanji, '山里 宝');
  assert.equal(item.playerId, 'id:1000544882|亜細亜大学');
  assert.equal(item.sourceUrl, 'https://www.daily.co.jp/baseball/2026/10/24/0020961183.shtml');
  assert.equal(item.thumbnailUrl, undefined);
  assert.equal(feed.filter(row => row.sourceUrl === item.sourceUrl).length, 1);
});
