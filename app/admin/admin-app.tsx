"use client";
import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { type SeasonKey } from '../../lib/dataset-types';
import { loadStaticDataset, resetDatasetCache } from '../../lib/dataset-loader';
import { seasonInfo } from '../../lib/seasons.mjs';
import { useSeasonCatalog, refreshSeasonCatalog } from '../../lib/season-catalog';
import { importAction as action, publishPrepared, notifyDatasetUpdated } from '../../lib/import-actions';
import DrivePushPanel from './drive-push-panel';

type Report = {inputRows:number;addedRows:number;duplicates:number;totalRows:number;recoveredDates:number;pitchCorrections?:number;notices?:{message:string;count:number}[];ruleVersion:string;existingWarnings?:{message:string;count:number}[];warnings:{message:string;count:number}[]};
type Prepared = {id?:string;unchanged?:boolean;season:SeasonKey;report:Report};
type ImportRow = {sourceFormat?:'sources'|'input';id:string;season:SeasonKey;fileName:string;uploadedAt:string;pitchCount:number;isActive:boolean;expectedActive:string};
type Meta = {season:string;pitches:number;games:number;teams:number;sourceName:string};
export default function AdminApp({displayName}:{displayName:string}) {
  const {seasons: SEASONS} = useSeasonCatalog();
  const [season,setSeason] = useState<SeasonKey>('2026-fall');
  const [meta,setMeta] = useState<Meta|null>(null), [imports,setImports] = useState<ImportRow[]>([]);
  const [files,setFiles] = useState<File[]>([]), [pending,setPending] = useState<Prepared[]>([]);
  const prepared=pending[0] || null;
  const setPrepared=(value:Prepared|null)=>setPending(value?[value]:[]);
  const [historyCursor,setHistoryCursor]=useState<string|null>(null);
  const [busy,setBusy] = useState(false), [message,setMessage] = useState(''), [error,setError] = useState('');
  const worker = useRef<Worker|null>(null), refreshGeneration = useRef(0);
  async function refresh(target = season) {
    const generation = ++refreshGeneration.current;
    resetDatasetCache();
    await refreshSeasonCatalog();
    const [dataset,response] = await Promise.all([loadStaticDataset<{metadata:Meta}>(seasonInfo(target).path),fetch(`/api/imports?season=${target}`,{cache:'no-store'})]);
    const result = await response.json(); if (!response.ok) throw new Error(result.error);
    if (generation !== refreshGeneration.current) return;
    setMeta(dataset.metadata);setImports(result.imports);setHistoryCursor(result.nextCursor);
  }
  useEffect(()=>{setMeta(null); refresh(season).catch(e=>setError(e.message));},[season]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>()=>worker.current?.terminate(),[]);
  async function refreshPublished(target: SeasonKey) {
    notifyDatasetUpdated();
    setSeason(target);
    try { await refresh(target); }
    catch { setError('データの保存・反映は完了しました。管理画面の再取得に失敗したため、通信を確認して再読み込みしてください。'); }
  }
  async function commit(value: Prepared, acknowledgeWarnings: boolean) {
    if (!value.id) return;
    setBusy(true);setError('');setMessage('保存内容を照合して反映しています。');
    try { const result=await action({action:'commit',id:value.id,acknowledgeWarnings});setMessage(result.message);setPending(items=>items.filter(x=>x.id!==value.id));await refreshPublished(value.season); }
    catch(e) {setError(e instanceof Error ? e.message : '反映に失敗しました。');setMessage('');}
    finally {setBusy(false);}
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!files.length || busy) return;
    setBusy(true);setError('');setPrepared(null);setMessage('シーズン・重複・異常値を検証し、復元用データを保存しています。画面を開いたままお待ちください。');
    try {
      worker.current?.terminate();
      const job = new Worker(new URL('./import-worker.ts',import.meta.url),{type:'module'});worker.current=job;
      const values = await new Promise<Prepared[]>((resolve,reject)=>{
        job.onmessage=e=>e.data.error?reject(new Error(e.data.error)):resolve(e.data.result);
        job.onerror=()=>reject(new Error('検証処理が中断しました。PCで再実行するか、CSVを試合ごとに分けてください。現在の公開データは維持しています。'));
        job.postMessage(files);
      });
      job.terminate();worker.current=null;
      const batch = await publishPrepared(values, value => action({action:'commit',id:value.id,acknowledgeWarnings:false}), setPending);
      const target = batch.committed.at(-1)?.season;
      if (target) await refreshPublished(target);
      if (batch.error) setError(batch.error);
      const saved = batch.committed.length ? `${batch.committed.length}シーズンを反映しました。` : '';
      setMessage(batch.pending.length ? `${saved}${batch.pending.length}シーズンが確認・反映待ちです。` : saved || '変更はありません。同じデータは追加していません。');
      setBusy(false);
    } catch(e) {worker.current?.terminate();worker.current=null;setError(e instanceof Error?e.message:'検証に失敗しました。');setMessage('');setBusy(false);}
  }
  async function restore(row:ImportRow) {
    if (!window.confirm(`${seasonInfo(row.season).label}を「${row.fileName}」${row.pitchCount.toLocaleString()}球の保存版へ戻しますか？現在の保存版も履歴に残ります。`)) return;
    setBusy(true);setError('');setMessage('保存版を照合して復元しています。');
    try {await action({action:'restore',season:row.season,id:row.id,expectedActive:row.expectedActive});setMessage('選択した保存版へ戻しました。');await refreshPublished(row.season);}
    catch(e) {setError(e instanceof Error?e.message:'復元に失敗しました。');setMessage('');}
    finally {setBusy(false);}
  }
  return <div className="site-shell"><header className="admin-simple-header"><Link className="admin-brand-link" href="/">ID東都</Link><div className="admin-account"><span>{displayName}</span><a href="/signout-with-chatgpt?return_to=%2F">サインアウト</a></div></header>
    <main className="page-wrap"><section className="page-section"><header className="page-heading"><p>管理者限定</p><h1>CSVデータ管理</h1><span>CSVを追加すると日付からシーズンを判定。検証・重複除去・名寄せ・球種補正・バックアップを行います。</span></header>
    {error && <p className="upload-status error" role="alert">{error}</p>}{message && <p className="upload-status" role="status">{message}</p>}
    <div className="admin-grid"><form className="upload-card" onSubmit={submit}><h2>新しいデータを追加</h2><p>問題のないCSVは自動反映。異常の可能性がある値は確認後に反映します。</p><label className="drop-zone"><input type="file" multiple accept=".csv,text/csv" disabled={busy} onChange={e=>{setFiles([...(e.target.files??[])]);setPrepared(null);}}/><span className="upload-icon">↑</span><strong>{files.length?`${files.length}ファイル選択中`:'TrackMan CSVを選択'}</strong><small>UTF-8・試合別CSV、複数ファイルに対応</small></label><button className="primary-button" disabled={busy || !files.length}>{busy?'処理中…':'検証して反映'}</button>
    {prepared && <section className="import-report"><h3>{seasonInfo(prepared.season).label}の検証結果</h3><dl><div><dt>新規</dt><dd>{prepared.report.addedRows.toLocaleString()}球</dd></div><div><dt>重複</dt><dd>{prepared.report.duplicates.toLocaleString()}球</dd></div><div><dt>統合後</dt><dd>{prepared.report.totalRows.toLocaleString()}球</dd></div></dl><p>同一試合から日付を補完：{prepared.report.recoveredDates}球。球種補正：{prepared.report.pitchCorrections ?? '—'}球。</p>{prepared.report.warnings.length>0 && <ul>{prepared.report.warnings.map(w=><li key={w.message}>{w.message}（{w.count}件）</li>)}</ul>}{Boolean(prepared.report.existingWarnings?.length) && <details><summary>以前から含まれる測定欠損など</summary><ul>{prepared.report.existingWarnings?.map(w=><li key={w.message}>{w.message}（{w.count}件）</li>)}</ul></details>}{prepared.id && <button type="button" className="primary-button" disabled={busy} onClick={()=>commit(prepared,true)}>内容を確認して反映</button>}</section>}
    </form><div className="current-data-card"><h2>現在の表示データ</h2><label>シーズン<select aria-label="管理シーズン" disabled={busy} value={season} onChange={e=>setSeason(e.target.value as SeasonKey)}>{Object.entries(SEASONS).map(([key,v])=><option key={key} value={key}>{v.label}</option>)}</select></label>{meta?<><strong>{meta.season}</strong><dl><div><dt>投球</dt><dd>{meta.pitches.toLocaleString()}</dd></div><div><dt>試合</dt><dd>{meta.games}</dd></div><div><dt>大学</dt><dd>{meta.teams}</dd></div></dl><a className="secondary-button download-link" href={`/api/dataset?season=${season}&format=csv`}>現在のCSVを保存</a><p><Link href="/">分析画面を開く</Link></p></>:<p>読み込み中…</p>}</div></div>
    <p><Link href="/admin/storage">保存容量を確認</Link></p>
    <DrivePushPanel/>
    <section className="import-history"><h2>バックアップ・復元</h2><p>更新前と更新後を保存します。復元しても新しい版は削除されません。</p>{imports.filter(r=>r.season===season).map(row=><div key={row.id}><span className={row.isActive?'active-file':''}>{row.isActive?'反映中':'保存済'}</span><strong>{row.fileName}</strong><small>{new Date(row.uploadedAt).toLocaleString('ja-JP')} · {row.pitchCount.toLocaleString()}球</small><a href={`/api/dataset?season=${row.season}&format=csv&version=${row.id}`}>CSV保存</a>{row.sourceFormat && <a href={`/api/dataset?season=${row.season}&format=${row.sourceFormat}&version=${row.id}`}>入力原本</a>}<button type="button" className="secondary-button" disabled={busy || row.isActive} onClick={()=>restore(row)}>この版へ戻す</button></div>)}{!imports.some(r=>r.season===season)&&<p>更新履歴はまだありません。初回更新時に同梱データも保存します。</p>}{historyCursor && <button className="secondary-button" disabled={busy} onClick={async()=>{try {const r=await fetch(`/api/imports?season=${season}&cursor=${encodeURIComponent(historyCursor)}`,{cache:'no-store'});const page=await r.json();if(!r.ok)throw new Error(page.error);setImports(rows=>[...new Map([...rows,...page.imports].map(r=>[r.id,r])).values()]);setHistoryCursor(page.nextCursor);}catch(e){setError(e instanceof Error?e.message:'履歴を取得できません。');}}}>以前の保存版</button>}</section>
    <details className="method-card"><summary>取り込みルール</summary><ul><li>同じ投球ID・同じ内容は1球に統合。同じIDで内容が違う場合は停止します。</li><li>選手名は所属大学と登録済みの対応表で統一。未登録選手は推測で漢字へ変換しません。</li><li>手入力球種を優先し、不明値を自動判定で補完。真っすぐ系の球速基準と登録済みの投手別ルールを適用します。</li><li>日付・必須列・測定値・保存内容を検証。新しい年度・春秋のシーズンは日付から自動登録します。</li><li>検証結果の有効期限は1時間。別の更新が入った場合は再検証します。</li></ul></details>
    </section></main></div>;
}
