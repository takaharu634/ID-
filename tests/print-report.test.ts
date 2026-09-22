import test from 'node:test';
import assert from 'node:assert/strict';
import { collectPrintIssues } from '../app/print-document.ts';

test('five ready pitchers pass as five continuous pages', () => {
  assert.deepEqual(collectPrintIssues(Array.from({length:5}, (_,i) => ({page:i+1,empty:false,overflow:false,chartsReady:true}))), []);
});
test('empty, oversized, undrawn and discontinuous pages identify the failing page', () => {
  assert.deepEqual(collectPrintIssues([
    {page:1,empty:true,overflow:false,chartsReady:true},
    {page:2,empty:false,overflow:true,chartsReady:true},
    {page:4,empty:false,overflow:false,chartsReady:false},
  ]), ['1ページ：内容がありません','2ページ：用紙内に収まっていません','3ページ目：ページ番号が不連続','4ページ：チャートの描画が未完了']);
  assert.deepEqual(collectPrintIssues([]), ['印刷対象がありません']);
});
