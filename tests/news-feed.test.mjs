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
