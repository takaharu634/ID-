import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyBackupToken, backupExportGuard } from '../../server/backup-auth.mjs';
import { backupExportResponse, restorableKey } from '../../server/backup-service.mjs';

const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'audit-key', alg: 'RS256', use: 'sig' };
const now = Date.now(), second = Math.floor(now / 1000);
const env = { BACKUP_OIDC_ENABLED: 'true', BACKUP_GITHUB_REPOSITORY_ID: '1380720373', BACKUP_GITHUB_OWNER_ID: '319011362', BACKUP_GITHUB_BRANCH: 'main', BACKUP_OIDC_AUDIENCE: 'https://example.test/api/backup/export', BACKUP_OIDC_SUBJECT: 'repo:takaharu634@319011362/ID-touto-@1380720373:ref:refs/heads/main' };
const claims = { iss: 'https://token.actions.githubusercontent.com', aud: env.BACKUP_OIDC_AUDIENCE, sub: env.BACKUP_OIDC_SUBJECT, repository_id: '1380720373', repository_owner_id: '319011362', repository: 'takaharu634/ID-touto-', repository_visibility: 'private', ref: 'refs/heads/main', ref_type: 'branch', workflow_ref: 'takaharu634/ID-touto-/.github/workflows/backup-datasets.yml@refs/heads/main', event_name: 'schedule', runner_environment: 'github-hosted', exp: second + 300, iat: second, nbf: second, run_id: 'audit-run' };
const encode = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
async function token(values = {}, header = {}) {
  const signed = encode({ alg: 'RS256', kid: 'audit-key', ...header }) + '.' + encode({ ...claims, ...values });
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(signed));
  return signed + '.' + Buffer.from(signature).toString('base64url');
}
const options = { now, jwks: [jwk] };

test('OIDC pins every authority field independently and rejects replay lifetime changes', async () => {
  assert.equal((await verifyBackupToken(await token(), env, options)).repositoryId, env.BACKUP_GITHUB_REPOSITORY_ID);
  const mutations = { iss: 'https://attacker.test', aud: ['https://example.test/api/backup/export'], sub: 'repo:takaharu634/ID-touto-:ref:refs/heads/main', repository_id: '1380720374', repository_owner_id: '319011363', repository: 'takaharu634/renamed', repository_visibility: 'public', ref: 'refs/pull/7/merge', ref_type: 'tag', workflow_ref: 'takaharu634/ID-touto-/.github/workflows/other.yml@refs/heads/main', event_name: 'pull_request', runner_environment: 'self-hosted', exp: second, iat: second - 901, nbf: second + 31 };
  for (const [field, value] of Object.entries(mutations)) await assert.rejects(() => token({ [field]: value }).then(t => verifyBackupToken(t, env, options)), undefined, field);
  await assert.rejects(() => token({ exp: second + 901 }).then(t => verifyBackupToken(t, env, options)));
  await assert.rejects(() => token({}, { alg: 'HS256' }).then(t => verifyBackupToken(t, env, options)));
  await assert.rejects(() => token({}, { crit: ['jku'], jku: 'https://attacker.test' }).then(t => verifyBackupToken(t, env, options)));
  await assert.rejects(() => token().then(t => verifyBackupToken(t, { ...env, BACKUP_OIDC_ENABLED: 'false' }, options)));
});

test('unknown signing key cannot use cached trust or a fetched attacker key', async () => {
  const signed = await token();
  let fetched = 0;
  const fetcher = async url => { fetched++; assert.equal(url, 'https://token.actions.githubusercontent.com/.well-known/jwks'); return Response.json({ keys: [jwk] }); };
  await verifyBackupToken(signed, env, { now, fetcher });
  assert.equal(fetched, 1);
  await verifyBackupToken(signed, env, { now, fetcher: async () => assert.fail('known kid should use fresh cache') });
  await assert.rejects(() => token({}, { kid: 'rotated-but-not-published' }).then(t => verifyBackupToken(t, env, { now, fetcher })));
  assert.equal(fetched, 2);
  await assert.rejects(() => verifyBackupToken(signed, env, { now: now + 300001, fetcher: async () => new Response(null, { status: 503 }) }));
  const forged = signed.slice(0, signed.lastIndexOf('.') + 1) + Buffer.alloc(256).toString('base64url');
  assert.equal((await backupExportGuard(new Request('https://example.test', { headers: { authorization: 'Bearer ' + forged } }), env, options)).status, 401);
});

test('export rejects config namespace, nonallowlisted tables and writes before touching storage', async () => {
  const noTouch = () => assert.fail('storage must not be reached');
  const bindings = { BUCKET: { get: noTouch, put: noTouch, list: noTouch }, DB: { prepare: noTouch } };
  const guard = async () => null;
  for (const query of ['mode=object&key=trackman/config&etag=a', 'mode=object&key=datasets/../secret&etag=a', 'mode=database&table=trackman_push_channels', 'mode=database&table=constructor', 'mode=database&table=__proto__']) {
    assert.equal((await backupExportResponse(new Request('https://example.test/?' + query), bindings, guard)).status, 400, query);
  }
  assert.equal((await backupExportResponse(new Request('https://example.test', { method: 'POST' }), bindings, guard)).status, 405);
  for (const key of ['datasets/v2/2026-spring/head.json', 'datasets/v2/staged/00000000-0000-0000-0000-000000000000.json', 'datasets/v3/verification/00000000-0000-0000-0000-000000000000.json', 'import-jobs/test/source.csv', 'datasets/v3/2026-spring/blocks/../secret']) assert.equal(restorableKey(key), false, key);
});
