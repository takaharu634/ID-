"use client";
import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { type SeasonKey } from '../../lib/dataset-types';
import { loadStaticDataset, resetDatasetCache } from '../../lib/dataset-loader';
import { seasonInfo } from '../../lib/seasons.mjs';
import { useSeasonCatalog, refreshSeasonCatalog } from '../../lib/season-catalog';
import { importAction as action, notifyDatasetUpdated } from '../../lib/import-actions';
import { ImportQueueSession, jobRequest, listImportJobs, type ImportJob } from '../../lib/import-queue';
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
  const controller=useRef<AbortController|null>(null), session=useRef<ImportQueueSession|null>(null);
  const [jobs,setJobs]=useState<ImportJob[]>([]),[currentJob,setCurrentJob]=useState<ImportJob|null>(null);
  const refreshJobs=async()=>setJobs(await listImportJobs());
  const updateJob=(job:ImportJob)=>{setCurrentJob(job);setJobs(values=>['completed','cancelled'].includes(job.status)&&!job.cleanupPending?values.filter(value=>value.id!==job.id):[job,...values.filter(value=>value.id!==job.id)]);setPending(job.status==='ready'?job.seasons.filter(value=>value.status==='prepared'&&value.prepared).map(value=>value.prepared as Prepared):[]);};
  useEffect(()=>{listImportJobs().then(setJobs).catch(e=>setError(e.message));},[]);
  function runWorker<T>(payload:unknown,signal:AbortSignal):Promise<T> {
    signal.throwIfAborted();worker.current?.terminate();
    const job=new Worker(new URL('./import-worker.ts',import.meta.url),{type:'module'});worker.current=job;
    return new Promise<T>((resolve,reject)=>{
      const stop=()=>{job.terminate();worker.current=null;signal.removeEventListener('abort',abort);};
      const abort=()=>{stop();reject(new DOMException('取り込みを一時停止しました。','AbortError'));};
      signal.addEventListener('abort',abort,{once:true});
      job.onmessage=event=>{stop();if(event.data.error)reject(new Error(event.data.error));else resolve(event.data);};
      job.onerror=()=>{stop();reject(new Error('計算を中断しました。保存済み原本から再開できます。大きな CSV は試合ごとに分けることもできます。'));};
      job.postMessage(payload);
    });
  }
  async function refresh(target = season) {
    const generation = ++refreshGeneration.current;
    resetDatasetCache();
    await refreshSeasonCatalog();
    const [dataset,response] = await Promise.all([loadStaticDataset<{metadata:Meta}>(seasonInfo(target).path),fetch(`/api/imports?season=${target}`,{cache:'no-store'})]);
    const result = await response.json(); if (!response.ok) throw new Error(result.error);
    if (generation !== refreshGeneration.current) return;
    setMeta(dataset.metadata);setImports(result.imports);setHistoryCursor(result.nextCursor);
  }
  useEffect(()=>{Promise.resolve().then(()=>{setMeta(null);return refresh(season);}).catch(e=>setError(e.message));},[season]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(()=>()=>{controller.current?.abort();worker.current?.terminate();},[]);
  async function refreshPublished(target: SeasonKey) {
    notifyDatasetUpdated();
    setSeason(target);
    try { await refresh(target); }
    catch { setError('データの保存・反映は完了しました。管理画面の再取得に失敗したため、通信を確認して再読み込みしてください。'); }
  }
  async function processQueue(queue:ImportQueueSession,signal:AbortSignal,approvedId?:string) {
    const renew=setInterval(()=>{queue.call('renew',{},signal).catch(()=>controller.current?.abort());},5*60*1000);
    try {
      if(queue.job.status==='uploading') {
        if(queue.job.files.every(file=>file.chunks.every(Boolean)))await queue.call('ready',{},signal);
        else await queue.upload(files,signal,setMessage);
      }
      const sequence=[...queue.job.seasons].sort((a,b)=>Number(b.season===queue.job.publishing?.season)-Number(a.season===queue.job.publishing?.season));
      for(const entry of sequence) {
        signal.throwIfAborted();
        let item=queue.job.seasons.find(value=>value.season===entry.season)!;
        if(item.status==='prepared') {await queue.call('reconcile',{season:item.season},signal);item=queue.job.seasons.find(value=>value.season===entry.season)!;}
        if(['committed','unchanged'].includes(item.status))continue;
        if(item.status==='pending') {
          setMessage(`${seasonInfo(item.season).label}を検証しています。原本の保存は完了しています。`);
          const sourceFiles=queue.job.files.map((file,index)=>({...file,index})).filter(file=>file.season===item.season).map(file=>({index:file.index,name:file.name,sha256:file.sha256}));
          const result=await runWorker<{result:Prepared[]}>({type:'prepare',jobId:queue.job.id,files:sourceFiles},signal);
          const value=result.result[0];if(!value||value.season!==item.season||result.result.length!==1)throw new Error('検証したシーズンが原本の記録と一致しません。');
          await queue.call('prepared',{season:item.season,stageId:value.id,unchanged:value.unchanged===true},signal);
          item=queue.job.seasons.find(value=>value.season===entry.season)!;
        }
        if(item.status==='prepared'&&item.prepared) {
          const acknowledged=item.prepared.id===approvedId;
          if(item.prepared.report.warnings.length&&!acknowledged)continue;
          const result=await queue.publish(item.season,acknowledged,signal,setMessage);
          if(result.revalidate)throw new Error('検証中に別の更新が入りました。保存済み原本から再開して、最新の結果を確認してください。');
        }
      }
      if(queue.job.seasons.every(value=>['committed','unchanged'].includes(value.status))) {
        await queue.call('finish',{},signal);setMessage('取り込みが完了しました。入力原本と更新履歴を保存しています。');
      } else setMessage('確認が必要なシーズンがあります。検証結果を確認して反映してください。');
    } finally {clearInterval(renew);}
  }
  async function execute(start:()=>Promise<ImportQueueSession>,approvedId?:string) {
    setBusy(true);setError('');setMessage('取り込み記録を取得しています。');
    const abort=new AbortController();controller.current=abort;
    let queue:ImportQueueSession|undefined;
    try {queue=await start();session.current=queue;await processQueue(queue,abort.signal,approvedId);}
    catch(e) {if(abort.signal.aborted)setMessage('取り込みを一時停止しました。保存した地点から再開できます。');else{setError(e instanceof Error?e.message:'取り込みに失敗しました。');setMessage('');}}
    finally {
      worker.current?.terminate();worker.current=null;
      if(queue&&!['completed','cancelled'].includes(queue.job.status)) {try{await queue.pause();}catch{setError(previous=>`${previous} 使用権の解除を確認できませんでした。結果を再取得し、最大 15 分後に再開してください。`.trim());}}
      const committed=queue?.job.seasons.filter(value=>value.status==='committed').at(-1);
      if(committed)await refreshPublished(committed.season as SeasonKey);
      session.current=null;controller.current=null;setBusy(false);
      refreshJobs().catch(()=>{});
    }
  }
  async function commit(value:Prepared) {
    if(!currentJob||!value.id)return;
    await resume(currentJob,value.id);
  }
  async function resume(job:ImportJob,approvedId?:string) {
    if(['completed','cancelled'].includes(job.status)) {setBusy(true);try{updateJob((await jobRequest({action:'cleanup',id:job.id})).job);setMessage('再開用原本の整理が完了しました。');}catch(e){setError(e instanceof Error?e.message:'原本を整理できませんでした。');}finally{setBusy(false);}return;}
    await execute(async()=>new ImportQueueSession(await jobRequest({action:'claim',id:job.id}),updateJob),approvedId);
  }
  async function submit(event:FormEvent) {
    event.preventDefault();if(!files.length||busy)return;
    if(files.length>128||files.some(file=>file.size===0)||files.reduce((sum,file)=>sum+file.size,0)>512*1024*1024) {setError('1 回につき 128 ファイル、合計 512 MiB までの CSV を選択してください。大きい原本は試合ごとに分けて追加できます。');return;}
    await execute(async()=>{
      setMessage('CSV のシーズンを確認しています。');
      const inspected=await runWorker<{files:{name:string;size:number;season:string;sha256:string}[]}>({type:'inspect',files},controller.current!.signal);
      return new ImportQueueSession(await jobRequest({action:'create',files:inspected.files},controller.current!.signal),updateJob);
    });
  }
  async function cancelJob(job:ImportJob) {
    if(!window.confirm('この未完了の取り込みと再開用の原本を削除しますか？すでに反映したシーズンと保存履歴は維持します。'))return;
    setBusy(true);setError('');let queue:ImportQueueSession|undefined;
    try {queue=new ImportQueueSession(await jobRequest({action:'claim',id:job.id}),updateJob);await queue.call('cancel');setPending([]);setMessage('未完了の取り込みを中止しました。');}
    catch(e){setError(e instanceof Error?e.message:'中止できませんでした。');if(queue)await queue.pause().catch(()=>{});}
    finally {setBusy(false);refreshJobs().catch(()=>{});}
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
    <div className="admin-grid"><form className="upload-card" onSubmit={submit}><h2>新しいデータを追加</h2><p>問題のないCSVは自動反映。異常の可能性がある値は確認後に反映します。</p><label className="drop-zone"><input type="file" multiple accept=".csv,text/csv" disabled={busy} onChange={e=>{setFiles([...(e.target.files??[])]);setPrepared(null);}}/><span className="upload-icon">↑</span><strong>{files.length?`${files.length}ファイル選択中`:'TrackMan CSVを選択'}</strong><small>UTF-8・試合別CSV、複数ファイルに対応</small></label><button className="primary-button" disabled={busy || !files.length}>{busy?'処理中…':'検証して反映'}</button>{busy&&controller.current&&<button type="button" className="secondary-button" onClick={()=>controller.current?.abort()}>一時停止</button>}<p>原本の保存後は、同じ管理者アカウントで別の端末からも再開できます。画面を閉じると計算は一時停止します。</p>
    {prepared && <section className="import-report"><h3>{seasonInfo(prepared.season).label}の検証結果</h3><dl><div><dt>新規</dt><dd>{prepared.report.addedRows.toLocaleString()}球</dd></div><div><dt>重複</dt><dd>{prepared.report.duplicates.toLocaleString()}球</dd></div><div><dt>統合後</dt><dd>{prepared.report.totalRows.toLocaleString()}球</dd></div></dl><p>同一試合から日付を補完：{prepared.report.recoveredDates}球。球種補正：{prepared.report.pitchCorrections ?? '—'}球。</p>{prepared.report.warnings.length>0 && <ul>{prepared.report.warnings.map(w=><li key={w.message}>{w.message}（{w.count}件）</li>)}</ul>}{Boolean(prepared.report.existingWarnings?.length) && <details><summary>以前から含まれる測定欠損など</summary><ul>{prepared.report.existingWarnings?.map(w=><li key={w.message}>{w.message}（{w.count}件）</li>)}</ul></details>}{prepared.id && <button type="button" className="primary-button" disabled={busy} onClick={()=>commit(prepared)}>内容を確認して反映</button>}</section>}
    </form><div className="current-data-card"><h2>現在の表示データ</h2><label>シーズン<select aria-label="管理シーズン" disabled={busy} value={season} onChange={e=>setSeason(e.target.value as SeasonKey)}>{Object.entries(SEASONS).map(([key,v])=><option key={key} value={key}>{v.label}</option>)}</select></label>{meta?<><strong>{meta.season}</strong><dl><div><dt>投球</dt><dd>{meta.pitches.toLocaleString()}</dd></div><div><dt>試合</dt><dd>{meta.games}</dd></div><div><dt>大学</dt><dd>{meta.teams}</dd></div></dl><a className="secondary-button download-link" href={`/api/dataset?season=${season}&format=csv`}>現在のCSVを保存</a><p><Link href="/">分析画面を開く</Link></p></>:<p>読み込み中…</p>}</div></div>
    <section className="import-history"><h2>未完了の取り込み</h2><p>シーズンごとに保存した地点から再開します。画面を閉じた直後は、使用権が解除されるまで最大 15 分かかります。</p>{!jobs.length&&<p>未完了の取り込みはありません。</p>}{jobs.map(job=><div key={job.id}><strong>{job.files.map(file=>file.name).join('、')}</strong><span>{job.cleanupPending?'再開用原本の整理待ち':job.status==='uploading'?'原本の保存途中。同じ CSV を選択して再開':`${job.seasons.filter(value=>['committed','unchanged'].includes(value.status)).length}/${job.seasons.length} シーズン完了`}</span><small>{new Date(job.updatedAt).toLocaleString('ja-JP')}</small><button className="secondary-button" disabled={busy} onClick={()=>resume(job)}>{job.cleanupPending?'原本の整理を再試行':'再開・検証結果を確認'}</button><button className="secondary-button" disabled={busy||Boolean(job.cleanupPending)} onClick={()=>cancelJob(job)}>中止</button></div>)}</section>
    <p><Link href="/admin/storage">保存容量を確認</Link> · <Link href="/admin/recovery">外部バックアップから復旧</Link></p>
    <DrivePushPanel/>
    <section className="import-history"><h2>バックアップ・復元</h2><p>更新前と更新後を保存します。復元しても新しい版は削除されません。</p>{imports.filter(r=>r.season===season).map(row=><div key={row.id}><span className={row.isActive?'active-file':''}>{row.isActive?'反映中':'保存済'}</span><strong>{row.fileName}</strong><small>{new Date(row.uploadedAt).toLocaleString('ja-JP')} · {row.pitchCount.toLocaleString()}球</small><a href={`/api/dataset?season=${row.season}&format=csv&version=${row.id}`}>CSV保存</a>{row.sourceFormat && <a href={`/api/dataset?season=${row.season}&format=${row.sourceFormat}&version=${row.id}`}>入力原本</a>}<button type="button" className="secondary-button" disabled={busy || row.isActive} onClick={()=>restore(row)}>この版へ戻す</button></div>)}{!imports.some(r=>r.season===season)&&<p>更新履歴はまだありません。初回更新時に同梱データも保存します。</p>}{historyCursor && <button className="secondary-button" disabled={busy} onClick={async()=>{try {const r=await fetch(`/api/imports?season=${season}&cursor=${encodeURIComponent(historyCursor)}`,{cache:'no-store'});const page=await r.json();if(!r.ok)throw new Error(page.error);setImports(rows=>[...new Map([...rows,...page.imports].map(r=>[r.id,r])).values()]);setHistoryCursor(page.nextCursor);}catch(e){setError(e instanceof Error?e.message:'履歴を取得できません。');}}}>以前の保存版</button>}</section>
    <details className="method-card"><summary>取り込みルール</summary><ul><li>同じ投球ID・同じ内容は1球に統合。同じIDで内容が違う場合は停止します。</li><li>選手名は所属大学と登録済みの対応表で統一。未登録選手は推測で漢字へ変換しません。</li><li>手入力球種を優先し、不明値を自動判定で補完。真っすぐ系の球速基準と登録済みの投手別ルールを適用します。</li><li>日付・必須列・測定値・保存内容を検証。新しい年度・春秋のシーズンは日付から自動登録します。</li><li>検証結果の有効期限は1時間。別の更新が入った場合は再検証します。</li></ul></details>
    </section></main></div>;
}
