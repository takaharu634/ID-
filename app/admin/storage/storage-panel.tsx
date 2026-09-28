'use client';
import { useEffect, useRef, useState } from 'react';

type Group = { bytes: number; objects: number };
type Groups = Record<'heads' | 'snapshots' | 'staged' | 'other', Group>;
type InventoryPage = { pageBytes: number; pageObjects: number; groups: Groups; nextCursor: string | null; isLastPage: boolean };
const emptyGroups = (): Groups => ({ heads: { bytes: 0, objects: 0 }, snapshots: { bytes: 0, objects: 0 }, staged: { bytes: 0, objects: 0 }, other: { bytes: 0, objects: 0 } });
const labels = { heads: '公開版の管理情報', snapshots: '保存履歴・元データ', staged: '反映前の検証データ', other: 'その他' };
const size = (bytes: number) => `${(bytes / 1024 / 1024).toLocaleString('ja-JP', { maximumFractionDigits: 2 })} MiB`;

export default function StoragePanel() {
  const [groups, setGroups] = useState<Groups>(emptyGroups);
  const [cursor, setCursor] = useState<string | null>(null);
  const [pages, setPages] = useState(0);
  const [complete, setComplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const seen = useRef(new Set<string>());
  useEffect(() => () => controller.current?.abort(), []);

  async function load(reset: boolean) {
    if (controller.current) return;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError('');
    try {
      const next = reset ? null : cursor;
      const response = await fetch(`/api/storage-health?limit=200${next ? `&cursor=${encodeURIComponent(next)}` : ''}`, { cache: 'no-store', signal: abort.signal, credentials: 'same-origin' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '容量を読み取れませんでした。');
      const page = data as InventoryPage;
      if (!reset && page.nextCursor && seen.current.has(page.nextCursor)) throw new Error('取得位置が重複しました。最初から確認してください。');
      if (reset) seen.current.clear();
      if (page.nextCursor) seen.current.add(page.nextCursor);
      setGroups(previous => {
        const total = reset ? emptyGroups() : previous;
        return Object.fromEntries(Object.keys(labels).map(k => {
          const key = k as keyof Groups;
          return [key, { bytes: total[key].bytes + page.groups[key].bytes, objects: total[key].objects + page.groups[key].objects }];
        })) as Groups;
      });
      setPages(previous => reset ? 1 : previous + 1);
      setCursor(page.nextCursor); setComplete(page.isLastPage);
    } catch (cause) {
      if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : '容量を確認できませんでした。');
    } finally {
      controller.current = null;
      if (!abort.signal.aborted) setBusy(false);
    }
  }

  const bytes = Object.values(groups).reduce((sum, value) => sum + value.bytes, 0);
  const objects = Object.values(groups).reduce((sum, value) => sum + value.objects, 0);
  return <section>
    <p>データ保存領域を200件ずつ確認します。自動巡回、削除、契約変更は行いません。</p>
    <button className="primary-button" disabled={busy} onClick={() => void load(true)}>{pages ? '最初から確認' : '容量を確認'}</button>
    {pages > 0 && !complete && <button className="secondary-button" disabled={busy} onClick={() => void load(false)}>次の200件を確認</button>}
    <div aria-live="polite">
      {busy && <p>確認中</p>}
      {error && <p role="alert">{error}</p>}
      {pages > 0 && <>
        <h2>{complete ? '対象領域の確認完了' : '確認済み部分の容量'}</h2>
        <p>{size(bytes)} / {objects.toLocaleString('ja-JP')}件 / {pages}ページ</p>
        <table style={{ width: '100%', textAlign: 'left' }}><caption>保存データの内訳</caption>
          <thead><tr><th scope="col">区分</th><th scope="col">容量</th><th scope="col">件数</th></tr></thead>
          <tbody>{Object.entries(labels).map(([key, label]) => <tr key={key}><th scope="row">{label}</th><td>{size(groups[key as keyof Groups].bytes)}</td><td>{groups[key as keyof Groups].objects.toLocaleString('ja-JP')}</td></tr>)}</tbody>
        </table>
      </>}
    </div>
    <p>対象はR2の datasets/ 内です。D1、別領域、契約上限、請求額は含みません。読み取り中の更新によって集計値が変わる場合があります。</p>
  </section>;
}
