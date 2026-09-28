// GitHub OIDC grants only backup export, never writes or interactive admin access.
const ISSUER = 'https://token.actions.githubusercontent.com';
const JWKS = `${ISSUER}/.well-known/jwks`;
let keyCache;
const decode = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const parse = value => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(decode(value)));
const failure = () => new Error('Backup identity verification failed');
// Diagnostics contain only fixed codes. Never log a token, claim value, URL or key.
const diagnosticCodes = new Set(['CONFIG_OR_TOKEN', 'TOKEN_PARTS', 'TOKEN_PARSE', 'HEADER_POLICY', 'CONFIG_POLICY', 'CLAIM_POLICY', 'JWKS_FETCH', 'JWKS_STATUS', 'JWKS_SIZE', 'JWKS_PARSE', 'JWKS_SHAPE', 'JWKS_KID', 'SIGNATURE_IMPORT', 'SIGNATURE_DECODE', 'SIGNATURE_VERIFY', 'HEADER_MISSING', 'HEADER_SCHEME', 'UNCLASSIFIED',
  ...['ISSUER','AUDIENCE','SUBJECT','REPOSITORY_ID','OWNER_ID','REPOSITORY','VISIBILITY','REF','REF_TYPE','WORKFLOW_REF','EVENT','RUNNER','EXP_TYPE','IAT_TYPE','NBF_TYPE','EXPIRED','IAT_FUTURE','NBF_FUTURE','IAT_OLD','LIFETIME'].map(name => `CLAIM_${name}`)]);
function claimDiagnostic(claims, env, repoId, ownerId, repo, branch, seconds) {
  const checks = [
    ['ISSUER', claims.iss === ISSUER], ['AUDIENCE', claims.aud === env.BACKUP_OIDC_AUDIENCE], ['SUBJECT', claims.sub === env.BACKUP_OIDC_SUBJECT],
    ['REPOSITORY_ID', claims.repository_id === repoId], ['OWNER_ID', claims.repository_owner_id === ownerId], ['REPOSITORY', claims.repository === repo],
    ['VISIBILITY', claims.repository_visibility === 'private'], ['REF', claims.ref === `refs/heads/${branch}`], ['REF_TYPE', claims.ref_type === 'branch'],
    ['WORKFLOW_REF', claims.workflow_ref === `${repo}/.github/workflows/backup-datasets.yml@refs/heads/${branch}`],
    ['EVENT', ['schedule', 'workflow_dispatch', 'push'].includes(claims.event_name)], ['RUNNER', claims.runner_environment === 'github-hosted'],
    ['EXP_TYPE', Number.isSafeInteger(claims.exp)], ['IAT_TYPE', Number.isSafeInteger(claims.iat)], ['NBF_TYPE', Number.isSafeInteger(claims.nbf)],
    ['EXPIRED', !(claims.exp <= seconds)], ['IAT_FUTURE', !(claims.iat > seconds + 30)], ['NBF_FUTURE', !(claims.nbf > seconds + 30)],
    ['IAT_OLD', !(claims.iat < seconds - 900)], ['LIFETIME', !(claims.exp - claims.iat > 900)],
  ];
  const rejected = checks.find(([, accepted]) => !accepted);
  return rejected ? `CLAIM_${rejected[0]}` : 'CLAIM_POLICY';
}
export async function verifyBackupToken(token, env, { fetcher = fetch, now = Date.now(), jwks } = {}) {
  let diagnostic = 'CONFIG_OR_TOKEN';
  try {
  if (env.BACKUP_OIDC_ENABLED !== 'true' || typeof token !== 'string' || token.length > 16000) throw failure();
  diagnostic = 'TOKEN_PARTS';
  const parts = token.split('.'); if (parts.length !== 3) throw failure();
  diagnostic = 'TOKEN_PARSE';
  const header = parse(parts[0]), claims = parse(parts[1]);
  diagnostic = 'HEADER_POLICY';
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.kid.length > 256 || header.crit) throw failure();
  const repoId = env.BACKUP_GITHUB_REPOSITORY_ID, ownerId = env.BACKUP_GITHUB_OWNER_ID;
  const repo = 'takaharu634/ID-touto-', branch = env.BACKUP_GITHUB_BRANCH || 'main';
  diagnostic = 'CONFIG_POLICY';
  if (!/^\d+$/.test(repoId || '') || !/^\d+$/.test(ownerId || '') || branch !== 'main' || !env.BACKUP_OIDC_SUBJECT || !env.BACKUP_OIDC_AUDIENCE) throw failure();
  const seconds = Math.floor(now / 1000);
  diagnostic = 'CLAIM_POLICY';
  if (claims.iss !== ISSUER || claims.aud !== env.BACKUP_OIDC_AUDIENCE || claims.sub !== env.BACKUP_OIDC_SUBJECT ||
      claims.repository_id !== repoId || claims.repository_owner_id !== ownerId || claims.repository !== repo ||
      claims.repository_visibility !== 'private' || claims.ref !== `refs/heads/${branch}` || claims.ref_type !== 'branch' ||
      claims.workflow_ref !== `${repo}/.github/workflows/backup-datasets.yml@refs/heads/${branch}` ||
      !['schedule', 'workflow_dispatch', 'push'].includes(claims.event_name) || claims.runner_environment !== 'github-hosted' ||
      !Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.nbf) ||
      claims.exp <= seconds || claims.iat > seconds + 30 || claims.nbf > seconds + 30 || claims.iat < seconds - 900 || claims.exp - claims.iat > 900) {
    diagnostic = claimDiagnostic(claims, env, repoId, ownerId, repo, branch, seconds);
    throw failure();
  }
  let keys = jwks;
  if (!keys) {
    if (!keyCache || keyCache.until <= now || !keyCache.keys.some(key => key.kid === header.kid)) {
      diagnostic = 'JWKS_FETCH';
      const response = await fetcher(JWKS, { redirect: 'manual', signal: AbortSignal.timeout(10000) });
      diagnostic = 'JWKS_STATUS';
      if (!response.ok || Number(response.headers.get('content-length')) > 100000) throw failure();
      diagnostic = 'JWKS_SIZE';
      const text = await response.text(); if (text.length > 100000) throw failure();
      diagnostic = 'JWKS_PARSE';
      const value = JSON.parse(text);
      diagnostic = 'JWKS_SHAPE';
      if (!Array.isArray(value.keys) || value.keys.length > 20) throw failure();
      keyCache = { keys: value.keys, until: now + 300000 };
    }
    keys = keyCache.keys;
  }
  diagnostic = 'JWKS_KID';
  const jwk = keys.find(key => key.kid === header.kid && key.kty === 'RSA' && (!key.alg || key.alg === 'RS256') && (!key.use || key.use === 'sig'));
  if (!jwk) throw failure();
  diagnostic = 'SIGNATURE_IMPORT';
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  diagnostic = 'SIGNATURE_DECODE';
  const signature = decode(parts[2]);
  diagnostic = 'SIGNATURE_VERIFY';
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, new TextEncoder().encode(`${parts[0]}.${parts[1]}`))) throw failure();
  return { repositoryId: claims.repository_id, runId: claims.run_id };
  } catch {
    throw Object.assign(failure(), { backupDiagnostic: diagnostic });
  }
}
export async function backupExportGuard(request, env, options) {
  let diagnostic = 'HEADER_MISSING';
  try {
    const auth = request.headers.get('authorization') || '';
    if (auth) diagnostic = 'HEADER_SCHEME';
    if (!auth.startsWith('Bearer ')) throw failure();
    diagnostic = 'UNCLASSIFIED';
    await verifyBackupToken(auth.slice(7), env, options); return null;
  } catch (error) {
    const code = diagnosticCodes.has(error?.backupDiagnostic) ? error.backupDiagnostic : diagnostic;
    console.warn('[backup-auth]', diagnosticCodes.has(code) ? code : 'UNCLASSIFIED');
    return Response.json({ error: 'バックアップ専用の認証が必要です。' }, { status: 401, headers: { 'cache-control': 'no-store' } });
  }
}
