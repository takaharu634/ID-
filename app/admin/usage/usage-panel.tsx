'use client';
import { useEffect, useState } from 'react';
import { FEATURE_LABELS } from '../../../lib/feature-usage';

type Counts = { start: string; end: string; rows: { feature: string; views: number }[] };

export default function UsagePanel() {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/usage', { cache: 'no-store', signal: controller.signal })
      .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || '利用状況を取得できませんでした。'); return body as Counts; })
      .then(setCounts)
      .catch((cause) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '利用状況を取得できませんでした。'); });
    return () => controller.abort();
  }, []);
  const countsByFeature = new Map(counts?.rows.map(({ feature, views }) => [feature, views]));
  const ordered = Object.entries(FEATURE_LABELS).sort(([a], [b]) => (countsByFeature.get(b) ?? 0) - (countsByFeature.get(a) ?? 0));
  return <section>
    <p>過去28日間の閲覧数です。計測を始める前のアクセスは含みません。同じタブで同じ項目を開いても、１日１回だけ数えます。</p>
    <p>選手名、検索語、利用者の情報は記録しません。閲覧数の少なさだけで項目を削除せず、試合前など必要な時期の利用も確認してください。</p>
    {error && <p role="alert">{error}</p>}
    {!counts && !error && <p role="status">読み込み中…</p>}
    {counts && <><p>{counts.start}〜{counts.end}　記録あり：{counts.rows.length}項目</p>
      <div className="table-scroll"><table className="data-table"><thead><tr><th scope="col">項目</th><th scope="col">閲覧数</th></tr></thead>
        <tbody>{ordered.map(([feature, label]) => <tr key={feature}><th scope="row">{label}</th><td>{(countsByFeature.get(feature) ?? 0).toLocaleString('ja-JP')}</td></tr>)}</tbody>
      </table></div>
    </>}
  </section>;
}
