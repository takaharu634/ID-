export const IMPORT_CHUNK_BYTES = 1024 * 1024;
export type QueueReport = { inputRows:number; addedRows:number; duplicates:number; totalRows:number; recoveredDates:number; pitchCorrections?:number; notices?:{message:string;count:number}[]; ruleVersion:string; existingWarnings?:{message:string;count:number}[]; warnings:{message:string;count:number}[] };
export type QueuePrepared = { id:string; season:string; report:QueueReport; expiresAt:number };
export type ImportJob = {
  id:string; revision:number; createdAt:string; updatedAt:string; status:'uploading'|'ready'|'cancelled'|'completed'; leaseUntil:number|null; cleanupPending?:boolean; publishing?:{stageId:string;season:string}|null;
  files:{name:string;size:number;season:string;sha256:string;chunks:({key:string;sha256:string;bytes:number}|null)[]}[];
  seasons:{season:string;status:'pending'|'prepared'|'committed'|'unchanged';prepared?:QueuePrepared|null}[];
};
type QueueResponse = { job:ImportJob; token?:string; revalidate?:boolean; verifying?:boolean; checked?:number; total?:number; error?:string; code?:string };
export async function jobRequest(body:object, signal?:AbortSignal, fetcher:typeof fetch=fetch):Promise<QueueResponse> {
  const response=await fetcher('/api/import-jobs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000)});
  const value=await response.json();
  if(!response.ok) throw Object.assign(new Error(value.error||'取り込み記録を更新できません。'),{code:value.code,status:response.status});
  return value;
}
export async function listImportJobs(fetcher:typeof fetch=fetch):Promise<ImportJob[]> {
  const jobs:ImportJob[]=[]; let cursor:string|null=null;
  do {
    const response:Response=await fetcher(`/api/import-jobs${cursor?`?cursor=${encodeURIComponent(cursor)}`:''}`,{cache:'no-store',signal:AbortSignal.timeout(60000)});
    const value:{jobs:ImportJob[];cursor:string|null;error?:string}=await response.json();if(!response.ok)throw new Error(value.error||'再開可能な取り込みを取得できません。');
    jobs.push(...value.jobs);cursor=value.cursor;
  }while(cursor);
  return jobs;
}
export class ImportQueueSession {
  job:ImportJob;
  private token:string;
  private fetcher:typeof fetch;
  private onChange:(job:ImportJob)=>void;
  private tail:Promise<unknown>=Promise.resolve();
  constructor(value:QueueResponse,onChange:(job:ImportJob)=>void,fetcher:typeof fetch=fetch) {
    if(!value.token)throw new Error('取り込みの使用権を取得できません。');
    this.job=value.job;this.token=value.token;this.fetcher=fetcher;this.onChange=onChange;
    onChange(this.job);
  }
  private serialize<T>(callback:()=>Promise<T>):Promise<T> {
    const next=this.tail.catch(()=>{}).then(callback);this.tail=next;return next;
  }
  call(action:string, fields:object={},signal?:AbortSignal):Promise<QueueResponse> {
    return this.serialize(async()=>{
      signal?.throwIfAborted();
      const value=await jobRequest({action,id:this.job.id,revision:this.job.revision,token:this.token,...fields},signal,this.fetcher);
      this.job=value.job;this.onChange(this.job);return value;
    });
  }
  async upload(files:File[],signal:AbortSignal,onProgress:(text:string)=>void) {
    if(files.length!==this.job.files.length || this.job.files.some((file,index)=>file.name!==files[index].name||file.size!==files[index].size))throw new Error('原本の保存を続けるには、最初と同じ CSV を同じ順番で選択してください。');
    for(let fileIndex=0;fileIndex<files.length;fileIndex++) {
      const file=files[fileIndex];
      const fileHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(value=>value.toString(16).padStart(2,'0')).join('');
      if(fileHash!==this.job.files[fileIndex].sha256)throw new Error('選択した CSV が保存途中の原本と異なります。新しい取り込みを作成してください。');
      for(let chunkIndex=0;chunkIndex<this.job.files[fileIndex].chunks.length;chunkIndex++) {
        signal.throwIfAborted();
        // Read and compare existing chunks too: a same-name/same-size replacement is not the original.
        const bytes=await file.slice(chunkIndex*IMPORT_CHUNK_BYTES,(chunkIndex+1)*IMPORT_CHUNK_BYTES).arrayBuffer();
        const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
        const old=this.job.files[fileIndex].chunks[chunkIndex];
        if(old) {if(old.sha256!==hash)throw new Error('選択した CSV が保存途中の原本と異なります。新しい取り込みを作成してください。');continue;}
        await this.serialize(async()=>{
          signal.throwIfAborted();
          const response=await this.fetcher(`/api/import-jobs?id=${this.job.id}&file=${fileIndex}&chunk=${chunkIndex}`,{method:'PUT',body:bytes,headers:{'content-type':'application/octet-stream','x-content-sha256':hash,'x-content-bytes':String(bytes.byteLength),'x-job-revision':String(this.job.revision),'x-job-token':this.token},signal:AbortSignal.any([signal,AbortSignal.timeout(60000)])});
          const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.error||'原本を保存できません。'),{code:value.code,status:response.status});
          this.job=value.job;this.onChange(this.job);
        });
        const saved=this.job.files.reduce((sum,f)=>sum+f.chunks.reduce((count,chunk)=>count+(chunk?.bytes||0),0),0),total=this.job.files.reduce((sum,f)=>sum+f.size,0);
        onProgress(`原本を保存しています。${Math.round(saved/total*100)}%`);
      }
    }
    await this.call('ready',{},signal);
    onProgress('原本の保存が完了しました。この管理者アカウントで別の端末からも再開できます。');
  }
  async publish(season:string,acknowledgeWarnings:boolean,signal:AbortSignal,onProgress:(text:string)=>void) {
    let previous='',stalled=0;
    for(;;) {
      const value=await this.call('publish',{season,acknowledgeWarnings},signal);
      if(!value.verifying)return value;
      const position=`${value.checked}/${value.total}`;
      onProgress(`保存内容を照合しています。${position}`);
      stalled=position===previous?stalled+1:0;if(stalled>=3)throw new Error('照合が進みません。通信を確認して再開してください。');
      previous=position;
    }
  }
  async pause() {
    // Deliberately independent of the user's aborted controller. Re-read a response-lost
    // revision, but the server still requires our exact live token before releasing it.
    return this.serialize(async()=>{
      const response=await this.fetcher(`/api/import-jobs?id=${this.job.id}`,{cache:'no-store',signal:AbortSignal.timeout(60000)});
      let value=await response.json();if(!response.ok)throw new Error(value.error||'一時停止を確認できません。');
      if(['completed','cancelled'].includes(value.job.status)) {this.job=value.job;this.onChange(this.job);return;}
      if(value.job.publishing)value=await jobRequest({action:'reconcile',id:this.job.id,revision:value.job.revision,token:this.token,season:value.job.publishing.season},undefined,this.fetcher);
      const paused=await jobRequest({action:'pause',id:this.job.id,revision:value.job.revision,token:this.token},undefined,this.fetcher);
      this.job=paused.job;this.onChange(this.job);
    });
  }
}
