import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createArchive } from './archive.mjs';
const env = process.env, root = resolve(env.BACKUP_OUTPUT || 'backup-current');
const origin = new URL(env.BACKUP_SITE_ORIGIN || 'https://tohto-baseball-savant.nbdn87qjxf.chatgpt.site');
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Invalid backup origin');
const endpoint = new URL('/api/backup/export', origin), audience = env.BACKUP_OIDC_AUDIENCE || endpoint.href;
// A fixed allowlist only. Never return the JWT, signature, jti, actor or arbitrary
// response text. Decoding is diagnostic and does not grant access.
const claimNames = ['iss','aud','sub','repository','repository_id','repository_owner_id','repository_visibility','ref','ref_type','workflow_ref','event_name','runner_environment','iat','nbf','exp'];
const visible = value => {
  if (typeof value === 'string') return value.slice(0,1600);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value) && value.length <= 5 && value.every(x => typeof x === 'string')) return value.map(x => x.slice(0,1600));
  return value === undefined ? '[missing]' : '[invalid type]';
};
async function backupAuthDiagnostic(token, response, now = Date.now()) {
  const result = { status:response.status, runnerTimeSeconds:Math.floor(now/1000), response:{json:false,hasError:false,errorType:null,appAuthDenied:false} };
  try {
    const parts=token.split('.');
    const header=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
    const claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
    result.header={alg:visible(header.alg),kid:visible(header.kid),hasCritical:header.crit!==undefined};
    result.claims=Object.fromEntries(claimNames.map(name=>[name,visible(claims[name])]));
  } catch { result.decodeFailed=true; }
  try {
    const value=await response.clone().json(); result.response.json=true;
    result.response.hasError=Boolean(value && typeof value==='object' && Object.hasOwn(value,'error'));
    result.response.errorType=result.response.hasError?typeof value.error:null;
    result.response.appAuthDenied=value?.error==='バックアップ専用の認証が必要です。';
  } catch { /* Body contents are deliberately never logged. */ }
  return result;
}

let token, expiry = 0, authDiagnosed = false;
async function identity() {
  if (token && expiry > Date.now() + 30000) return token;
  const url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL); url.searchParams.set('audience', audience);
  const response = await fetch(url, { headers:{ Authorization:`Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` }, signal:AbortSignal.timeout(20000), redirect:'error' });
  if (!response.ok) throw new Error('GitHub backup identity unavailable');
  const value = await response.json(); if (typeof value.value !== 'string') throw new Error('Missing GitHub OIDC token');
  token = value.value; expiry = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp * 1000;
  // Token itself and other identity claims must never be logged.
  return token;
}
async function api(params, binary = false) {
  const url = new URL(endpoint); for (const [key,value] of Object.entries(params)) url.searchParams.set(key,value);
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, { headers:{ Authorization:`Bearer ${await identity()}` }, signal:AbortSignal.timeout(60000), redirect:'error' });
    if (response.ok) return binary ? response.arrayBuffer() : response.json();
    if (response.status === 401 && !authDiagnosed) { authDiagnosed=true; console.log('Backup authentication diagnostic (selected non-secret claims only): '+JSON.stringify(await backupAuthDiagnostic(token,response))); }
    if (response.status === 401 && attempt < 2) { token = null; continue; }
    if (response.status >= 500 && attempt < 2) { await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); continue; }
    throw new Error(`Backup export failed (${response.status}, ${params.mode})`);
  }
}
let result;
for (let attempt = 0; attempt < 2; attempt++) {
  const path = join(root,`capture-${attempt+1}`);
  try { result = { path, ...await createArchive({ root:path, previousRoot:env.BACKUP_PREVIOUS, api, source:{ repository:env.GITHUB_REPOSITORY || null, commit:env.GITHUB_SHA || null, runId:env.GITHUB_RUN_ID || null } }) }; break; }
  catch(error) { if (attempt || !/changed during backup|\(412,/.test(error.message)) throw error; }
}
const threshold = (key, fallback) => { const n = Number(env[key] || fallback); if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${key} must be a positive byte count`); return n; };
let jobBytes=0,jobObjects=0,cursor=null; const usageCursors=new Set();
do { const page=await api({mode:'usage',scope:'import-jobs/',...(cursor?{cursor}:{})});
  if (page.scope!=='import-jobs/' || !Number.isSafeInteger(page.bytes) || page.bytes<0 || !Number.isSafeInteger(page.objects) || page.objects<0) throw new Error('Invalid import-job usage');
  jobBytes+=page.bytes; jobObjects+=page.objects; cursor=page.cursor;
  if (cursor) { if(usageCursors.has(cursor)) throw new Error('Usage pagination loop'); usageCursors.add(cursor); }
} while(cursor);
const warnings = [];
if (result.manifest.removedObjects>0) warnings.push(`前回のバックアップにあった${result.manifest.removedObjects}オブジェクトが見つかりません。意図した削除か確認してください。`);
if (result.stats.bytes + jobBytes > threshold('BACKUP_R2_WARN_BYTES', 1024*1024*1024)) warnings.push('公開保存データと取り込みジョブの合計が設定した容量警告値を超えました。');
if (result.stats.gzipBytes > threshold('BACKUP_ARTIFACT_WARN_BYTES', 200*1024*1024)) warnings.push('1回分のバックアップが設定した容量警告値を超えました。');
const report = { ...result.stats, importJobs:{bytes:jobBytes,objects:jobObjects,backedUp:false}, measuredPrefixes:['datasets/','import-jobs/'], databaseStorageMeasured:false, reusedObjects:result.manifest.reusedObjects, removedObjects:result.manifest.removedObjects, warnings, limitsAreOperatorBudgets:true };
await mkdir(root,{recursive:true}); await writeFile(join(root,'report.json'),JSON.stringify(report,null,2));
if (env.GITHUB_OUTPUT) { const { appendFile } = await import('node:fs/promises'); await appendFile(env.GITHUB_OUTPUT,`archive=${result.path}\nwarnings=${warnings.length}\n`); }
if (env.GITHUB_STEP_SUMMARY) { const { appendFile } = await import('node:fs/promises'); await appendFile(env.GITHUB_STEP_SUMMARY,`ID東都バックアップ検証成功\n\n- 保存オブジェクト: ${report.objects}\n- 保存データ: ${report.bytes} bytes\n- 取り込みジョブ（容量のみ監視）: ${jobBytes} bytes\n- gzip: ${report.gzipBytes} bytes\n- D1 行: ${report.databaseRows}\n- SHA-256 と参照整合性: PASS\n${warnings.map(w=>`- 警告: ${w}`).join('\n')}\n`); }
for (const warning of warnings) console.log(`::warning::${warning}`);
console.log(JSON.stringify(report));
