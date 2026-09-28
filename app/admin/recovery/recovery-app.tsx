'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { importAction, notifyDatasetUpdated } from '../../../lib/import-actions';
type ObjectRef={key:string;headers:{'x-content-sha256':string;'x-content-bytes':string}};
type Version={season:string;id:string;fileName:string;createdAt:string;pitchCount:number};
type Plan={objects:ObjectRef[];versions:Version[]};
const safeKey=(key:string)=>/^datasets\/v[23]\//.test(key)&&!key.split('/').some(p=>['','.','..'].includes(p))&&!/[\\\x00-\x1f]/.test(key);
export default function RecoveryApp(){
  const [plan,setPlan]=useState<Plan|null>(null),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[selected,setSelected]=useState('');
  const files=useRef(new Map<string,File>()),cancel=useRef(false);
  async function select(source:FileList|null){
    setError('');setMessage('');setPlan(null);setSaved(false);setSelected('');
    try {
      const list=[...(source||[])], map=new Map(list.map(f=>[f.webkitRelativePath.split('/').slice(1).join('/'),f]));
      const config=map.get('restore-plan.json'); if(!config||config.size>20*1024*1024)throw new Error('CLIで検証・抽出した復旧フォルダーを選択してください。');
      const value=JSON.parse(await config.text()) as Plan;
      if(!Array.isArray(value.objects)||!Array.isArray(value.versions)||!value.versions.length)throw new Error('復元できる保存版がありません。');
      const seen=new Set<string>();
      for(const ref of value.objects){const file=map.get(ref.key);if(!safeKey(ref.key)||seen.has(ref.key)||!file||!/^[a-f0-9]{64}$/.test(ref.headers?.['x-content-sha256'])||String(file.size)!==ref.headers?.['x-content-bytes'])throw new Error('復旧ファイルまたは照合情報が一致しません。');seen.add(ref.key);}
      for(const version of value.versions)if(!/^[1-9]\d{3}-(spring|fall)$/.test(version.season)||!/^[a-f0-9-]{36}$/.test(version.id)||typeof version.fileName!=='string'||typeof version.createdAt!=='string'||!Number.isFinite(Date.parse(version.createdAt))||!Number.isSafeInteger(version.pitchCount)||version.pitchCount<0)throw new Error('保存版の識別子が不正です。');
      files.current=map;setPlan(value);setSelected(`${value.versions[0].season}/${value.versions[0].id}`);
    }catch(e){setError(e instanceof Error?e.message:'復旧フォルダーを読み込めません。');}
  }
  async function upload(){
    if(!plan||busy)return;setBusy(true);setError('');cancel.current=false;
    try{let index=0;for(const ref of plan.objects){if(cancel.current){setMessage('中断しました。保存済みの不足分は保持しています。同じフォルダーで再開できます。');return;}
      const response=await fetch(`/api/backup/restore?key=${encodeURIComponent(ref.key)}`,{method:'PUT',headers:{...ref.headers,'content-type':'application/octet-stream'},body:files.current.get(ref.key),signal:AbortSignal.timeout(60000)});
      const value=await response.json();if(!response.ok)throw new Error(value.error||'復旧に失敗しました。');index++;setMessage(`不足分の復旧 ${index.toLocaleString()} / ${plan.objects.length.toLocaleString()}`);
    }setSaved(true);setMessage('不足分を復旧しました。公開する保存版を選択してください。');}
    catch(e){setError(e instanceof Error?e.message:'復旧に失敗しました。');}finally{setBusy(false);}
  }
  async function activate(){
    const version=plan?.versions.find(v=>`${v.season}/${v.id}`===selected);if(!version||!saved||busy)return;
    if(!window.confirm(`${version.season}を「${version.fileName}」の保存版に切り替えますか？`))return;
    setBusy(true);setError('');setMessage('復旧した保存版を照合しています。');
    try{const response=await fetch(`/api/import-storage?key=${encodeURIComponent(`datasets/v2/${version.season}/head.json`)}`,{cache:'no-store',signal:AbortSignal.timeout(60000)});
      if(!response.ok&&response.status!==404)throw new Error('現在の公開版を確認できません。');
      const head=response.status===404?null:await response.json();
      await importAction({action:'restore',season:version.season,id:version.id,expectedActive:head?.active||null});
      notifyDatasetUpdated();setMessage(`${version.season}を復元しました。公開画面にも反映されます。`);
    }catch(e){setError(e instanceof Error?e.message:'切替に失敗しました。');}finally{setBusy(false);}
  }
  return <div className="site-shell"><header className="admin-simple-header"><Link className="admin-brand-link" href="/">ID東都</Link><Link href="/admin">CSV管理へ戻る</Link></header><main className="page-wrap"><section className="page-section"><header className="page-heading"><p>管理者限定</p><h1>外部バックアップの復旧</h1><span>GitHubから取得し、復旧ツールで検証・抽出したフォルダーを選択します。</span></header>
    <p>不足分を保存してから公開する版を選びます。保存済みの内容が異なる場合は停止します。</p>
    {error&&<p role="alert" className="upload-status error">{error}</p>}{message&&<p role="status" className="upload-status">{message}</p>}
    <section className="upload-card"><h2>1. 復旧ファイルを選択</h2><label className="drop-zone"><input type="file" multiple disabled={busy} ref={node=>{node?.setAttribute('webkitdirectory','');}} onChange={event=>{void select(event.target.files);}}/><strong>検証済みのフォルダーを選択</strong></label>
      {plan&&<><p>{plan.objects.length.toLocaleString()}ファイル・{plan.versions.length}保存版</p><button className="primary-button" disabled={busy} onClick={()=>{void upload();}}>不足分を復旧</button>{busy&&<button className="secondary-button" onClick={()=>{cancel.current=true;}}>次のファイルで中断</button>}</>}
    </section>
    {plan&&<section className="current-data-card"><h2>2. 公開する保存版を選択</h2><label>保存版<select value={selected} disabled={busy||!saved} onChange={event=>setSelected(event.target.value)}>{plan.versions.map(v=><option key={`${v.season}/${v.id}`} value={`${v.season}/${v.id}`}>{v.season} · {v.fileName} · {v.pitchCount.toLocaleString()}球 · {v.createdAt}</option>)}</select></label><button className="primary-button" disabled={busy||!saved||!selected} onClick={()=>{void activate();}}>照合してこの版を公開</button></section>}
    <details className="method-card"><summary>バックアップの取得・検証手順</summary><p>GitHub Actions の「ID Tohto daily data backup」から成功した実行の artifact をダウンロードして展開します。ソースを取得したPCで次のコマンドを実行し、出力フォルダーをここで選択してください。</p><pre>node tools/backup/restore.mjs extract バックアップのフォルダー 新しい出力フォルダー</pre><p>D1の履歴復旧SQLは同じ出力先に作成します。Driveの認証情報はバックアップに含めていません。</p></details>
  </section></main></div>;
}
