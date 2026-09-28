'use client';
import { useEffect, useState } from 'react';
type Source={id:string;label:string;recursive:boolean};
type Status = { sources:Source[]; configured: boolean; connected: boolean; enabled: boolean; active: boolean; expiresAt: number; lastSuccessAt: number | null; lastEventAt: number | null; error: string | null; result: { pitches?: number; games?: number; addedRows?: number } | null };
export default function DrivePushPanel() {
  const [sources,setSources]=useState<Source[]>([]), [folder,setFolder]=useState('');
  const [status, setStatus] = useState<Status | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function refresh() { const r = await fetch('/api/trackman/admin', { cache: 'no-store' }); const v = await r.json(); if (!r.ok) throw new Error(v.error); setStatus(v);setSources(v.sources || []); }
  useEffect(() => { refresh().catch(e => setError(e.message)); }, []);
  async function action(name: string) {
    setBusy(true); setError('');
    try { const r = await fetch('/api/trackman/admin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: name }) }); const v = await r.json(); if (!r.ok) throw new Error(v.error); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : '操作できません。'); } finally { setBusy(false); }
  }
  const date = (t: number) => new Date(t).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  return <section className="current-data-card" style={{ marginTop: '1.5rem' }}><h2>Driveから自動反映</h2>
    <p>対象フォルダへのCSV追加・更新通知を受けて反映します。年度と春秋はCSVの日付から判定します。</p>
    {error && <p role="alert" className="upload-status error">{error}</p>}
    {status ? <><strong>{status.active ? '通知を受信できます' : status.enabled ? '通知登録の確認が必要です' : status.connected ? '停止中' : 'Google側の接続待ち'}</strong>
      {status.expiresAt > 0 && <p>通知登録期限：{date(status.expiresAt)}</p>}
      {status.lastSuccessAt && <p>最終反映：{date(status.lastSuccessAt)}{status.result?.pitches ? ` ／ ${status.result.games}試合・${status.result.pitches.toLocaleString()}球` : ''}</p>}
      {status.error && <p role="alert" className="upload-status error">{status.error}</p>}
      <div className="hero-actions"><button className="secondary-button" disabled={busy} onClick={() => refresh().catch(e => setError(e.message))}>接続状態を確認</button>{status.enabled && <><button className="secondary-button" disabled={busy} onClick={() => action('retry')}>未反映データを再試行</button><button className="secondary-button" disabled={busy} onClick={() => action('pause')}>自動反映を停止</button></>}</div>
      <details><summary>対象フォルダ</summary><ul>{sources.map(s=><li key={s.id}>{s.label} · {s.id}</li>)}</ul><label>追加するDriveフォルダURL<input value={folder} onChange={e=>setFolder(e.target.value)} placeholder="https://drive.google.com/drive/folders/…"/></label><button className="secondary-button" disabled={busy||!folder} onClick={async()=>{setBusy(true);try{const id=folder.match(/folders\/([A-Za-z0-9_-]+)/)?.[1]||folder.trim();const r=await fetch('/api/trackman/admin',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'sources',sources:[...sources,{id,label:'TrackMan',recursive:true}]})});const data=await r.json();if(!r.ok)throw new Error(data.error);setFolder('');await refresh();}catch(e){setError(e instanceof Error?e.message:'保存できません。');}finally{setBusy(false);}}}>対象に追加</button><p>下位フォルダも対象です。新しい年度のフォルダをこの下に作成できます。既存ファイルを取り込む場合はGoogle側でsetupを実行してください。</p></details>
      <details style={{ marginTop: '1rem' }} open={!status.connected}><summary>初回のGoogle接続</summary>
        <ol><li><a href="https://script.google.com/home/start" target="_blank" rel="noreferrer">Google Apps Script</a>で新しいプロジェクトを作成します。</li>
          <li><a href="/api/trackman/admin?download=script">連携コードをダウンロード</a>し、内容をCode.gsに貼り付けます。コードには接続キーを含むため、他の人へ渡さないでください。</li>
          <li>プロジェクトの設定で「appsscript.json マニフェスト ファイルをエディタで表示する」を有効にし、<a href="/api/trackman/admin?download=manifest">設定ファイル</a>の内容で置き換えます。</li>
          <li>「デプロイ」→「新しいデプロイ」→「ウェブアプリ」。実行ユーザーは「自分」、アクセスできるユーザーは「全員」に設定します。受信した通知は接続キーで検証します。</li>
          <li>setupを1回実行し、Googleのアクセス許可を完了します。その後、この画面で接続状態を確認してください。</li></ol>
        <p>通知登録の期限延長だけはGoogle側で12時間ごとに行います。この処理でCSVを確認・集計することはありません。停止後の再開もsetupを実行してください。</p>
      </details></> : <p>接続状態を取得しています。</p>}
  </section>;
}
