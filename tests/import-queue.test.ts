import test from 'node:test';
import assert from 'node:assert/strict';
import { ImportQueueSession, jobRequest, listImportJobs, type ImportJob } from '../lib/import-queue.ts';
import { importAction } from '../lib/import-actions.ts';
const job=(patch:Partial<ImportJob>={}):ImportJob=>({id:'job',revision:1,status:'ready',createdAt:'2026-01-01',updatedAt:'2026-01-01',leaseUntil:9999999999999,files:[],seasons:[],...patch});

test('pause uses a fresh revision and remains possible after the work controller was aborted',async()=>{
  const abort=new AbortController();abort.abort();const requests:{url:string;body:Record<string,unknown>|null;aborted:boolean}[]=[];
  const fetcher=(async(input,init)=>{requests.push({url:String(input),body:typeof init?.body==='string'?JSON.parse(init.body):null,aborted:Boolean(init?.signal?.aborted)});if(!init?.method)return Response.json({job:job({revision:5})});return Response.json({job:job({revision:6,leaseUntil:null})});}) as typeof fetch;
  const queue=new ImportQueueSession({job:job(),token:'owner'},()=>{},fetcher);
  await assert.rejects(queue.call('renew',{},abort.signal));await queue.pause();
  assert.equal(requests.length,2);assert.equal(requests[1].body?.revision,5);assert.equal(requests[1].body?.token,'owner');assert.equal(requests[1].aborted,false);assert.equal(queue.job.leaseUntil,null);
});
test('a 409 checkpoint response is never accepted as successful renewal or ownership',async()=>{
 const snapshots:ImportJob[]=[];const queue=new ImportQueueSession({job:job(),token:'old'},value=>snapshots.push(value),(async()=>Response.json({error:'使用期限',code:'lease',job:job({revision:99})},{status:409})) as typeof fetch);
 await assert.rejects(queue.call('renew'),e=>(e as {code:string}).code==='lease');assert.equal(queue.job.revision,1);assert.equal(snapshots.length,1);
});
test('pause cannot steal a newly acquired lease when recovering a lost response revision',async()=>{
 const fetcher=(async(_input,init)=>!init?.method?Response.json({job:job({revision:10})}):Response.json({error:'new owner',code:'lease'},{status:409})) as typeof fetch;
 const queue=new ImportQueueSession({job:job(),token:'old'},()=>{},fetcher);await assert.rejects(queue.pause(),/new owner/);assert.equal(queue.job.revision,1);
});
test('same-name and same-size source replacement is rejected before resuming upload',async()=>{
 const chunk={key:'source',sha256:'0'.repeat(64),bytes:1};const queue=new ImportQueueSession({job:job({status:'uploading',files:[{name:'game.csv',size:1,season:'2044-spring',sha256:'0'.repeat(64),chunks:[chunk]}]}),token:'owner'},()=>{},(async()=>{throw new Error('must not fetch');}) as typeof fetch);
 await assert.rejects(queue.upload([new File(['a'],'game.csv')],new AbortController().signal,()=>{}),/原本と異なります/);
});
test('job listing follows pagination and retains an unfinished job on a later page',async()=>{
 const requests:string[]=[];const result=await listImportJobs((async input=>{requests.push(String(input));return Response.json(requests.length===1?{jobs:[],cursor:'next/+ cursor'}:{jobs:[job()],cursor:null});}) as typeof fetch);
 assert.equal(result.length,1);assert.equal(requests[1],'/api/import-jobs?cursor=next%2F%2B%20cursor');
});
test('aborting bounded verification prevents a subsequent mutation and reports last checked batch',async()=>{
 const abort=new AbortController(),progress:number[]=[];let calls=0;
 await assert.rejects(importAction({action:'commit'},(async()=>{calls++;return Response.json({verifying:true,checked:80,total:160},{status:202});}) as typeof fetch,{signal:abort.signal,onProgress:checked=>{progress.push(checked);abort.abort();}}));
 assert.equal(calls,1);assert.deepEqual(progress,[80]);
});
test('create request fails on authentication error before a resumable save is promised',async()=>{
 await assert.rejects(jobRequest({action:'create'},undefined,(async()=>Response.json({error:'sign in'},{status:401})) as typeof fetch),/sign in/);
});
test('pause reconciles a response-lost publication before releasing its own lease',async()=>{
 const actions:string[]=[];
 const fetcher=(async(_input,init)=>{
  if(!init?.method)return Response.json({job:job({revision:3,publishing:{stageId:'stage',season:'2044-spring'}})});
  const body=JSON.parse(String(init.body));actions.push(body.action);
  if(body.action==='reconcile')return Response.json({job:job({revision:4,publishing:null,seasons:[{season:'2044-spring',status:'committed'}]})});
  assert.equal(body.revision,4);return Response.json({job:job({revision:5,leaseUntil:null})});
 }) as typeof fetch;
 const queue=new ImportQueueSession({job:job(),token:'owner'},()=>{},fetcher);await queue.pause();assert.deepEqual(actions,['reconcile','pause']);assert.equal(queue.job.leaseUntil,null);
});
