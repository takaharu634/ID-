// GitHub OIDC grants only backup export, never writes or interactive admin access.
const ISSUER = 'https://token.actions.githubusercontent.com';
const JWKS = `${ISSUER}/.well-known/jwks`;
let keyCache;
const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const parse = value => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decode(value)));
const failure = () => new Error('Backup identity verification failed');
export async function verifyBackupToken(token, env, { fetcher = fetch, now = Date.now(), jwks } = {}) {
  if (env.BACKUP_OIDC_ENABLED !== 'true' || typeof token !== 'string' || token.length > 16000) throw failure();
  const parts = token.split('.'); if (parts.length !== 3) throw failure();
  const header = parse(parts[0]), claims = parse(parts[1]);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length > 256 || header.crit) throw failure();
  const repoId = env.BACKUP_GITHUB_REPOSITORY_ID, ownerId = env.BACKUP_GITHUB_OWNER_ID;
  const repo = 'takaharu634/ID-touto-', branch = env.BACKUP_GITHUB_BRANCH || 'main';
  if (!/^\d+$/.test(repoId || '') || !/^\d+$/.test(ownerId || '') || branch !== 'main' || !env.BACKUP_OIDC_SUBJECT || !env.BACKUP_OIDC_AUDIENCE) throw failure();
  const seconds = Math.floor(now / 1000);
  if (claims.iss !== ISSUER || claims.aud !== env.BACKUP_OIDC_AUDIENCE || claims.sub !== env.BACKUP_OIDC_SUBJECT ||
      claims.repository_id !== repoId || claims.repository_owner_id !== ownerId || claims.repository !== repo ||
      claims.repository_visibility !== 'private' || claims.ref !== `refs/heads/${branch}` || claims.ref_type !== 'branch' ||
      claims.workflow_ref !== `${repo}/.github/workflows/backup-datasets.yml@refs/heads/${branch}` ||
      !['schedule', 'workflow_dispatch', 'push'].includes(claims.event_name) || claims.runner_environment !== 'github-hosted' ||
      !Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.nbf) ||
      claims.exp <= seconds || claims.iat > seconds + 30 || claims.nbf > seconds + 30 || claims.iat < seconds - 900 || claims.exp - claims.iat > 900) throw failure();
  let keys = jwks;
  if (!keys) {
    if (!keyCache || keyCache.until <= now || !keyCache.keys.some(key => key.kid === header.kid)) {
      const response = await fetcher(JWKS, { redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (!response.ok || Number(response.headers.get('content-length')) > 100000) throw failure();
      const text = await response.text(); if (text.length > 100000) throw failure();
      const value = JSON.parse(text); if (!Array.isArray(value.keys) || value.keys.length > 20) throw failure();
      keyCache = { keys: value.keys, until: now + 300000 };
    }
    keys = keyCache.keys;
  }
  const jwk = keys.find(key => key.kid === header.kid && key.kty === 'RSA' && (!key.alg || key.alg === 'RS256') && (!key.use || key.use === 'sig'));
  if (!jwk) throw failure();
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))) throw failure();
  return { repositoryId: claims.repository_id, runId: claims.run_id };
}
export async function backupExportGuard(request, env, options) {
  try {
    const auth = request.headers.get('authorization') || '';
    if (!auth.startsWith('Bearer ')) throw failure();
    await verifyBackupToken(auth.slice(7), env, options); return null;
  } catch { return Response.json({ error: 'バックアップ専用の認証が必要です。' }, { status: 401, headers: { 'cache-control': 'no-store' } }); }
}
