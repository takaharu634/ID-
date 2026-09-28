// Read-only R2 inventory. No delete, put, migration, timer or external network calls.
export function validSeason(value) {
  return typeof value === 'string' && /^[1-9]\d{3}-(spring|fall)$/.test(value);
}
const safeNumber = (value, min = 0) => Number.isSafeInteger(value) && value >= min;
const category = key => /\/head\.json$/.test(key) ? 'heads'
  : /\/versions\//.test(key) ? 'snapshots'
    : /\/staged\//.test(key) ? 'staged' : 'other';

/** A page is not the total bucket size. Truncated pages always expose a cursor. */
export async function storagePage(bucket, { cursor = null, limit = 200 } = {}) {
  if (!safeNumber(limit, 1) || limit > 1000) throw new Error('Inventory limit must be 1-1000');
  if (cursor !== null && (typeof cursor !== 'string' || !cursor || cursor.length > 8192)) throw new Error('Invalid inventory cursor');
  const page = await bucket.list({ prefix: 'datasets/', limit, ...(cursor ? { cursor } : {}) });
  if (!Array.isArray(page.objects) || page.objects.length > limit || typeof page.truncated !== 'boolean') throw new Error('Invalid storage inventory');
  if (page.truncated && (typeof page.cursor !== 'string' || !page.cursor || page.cursor === cursor)) throw new Error('Storage pagination did not advance');
  const groups = { heads: { bytes: 0, objects: 0 }, snapshots: { bytes: 0, objects: 0 }, staged: { bytes: 0, objects: 0 }, other: { bytes: 0, objects: 0 } };
  let bytes = 0;
  for (const object of page.objects) {
    if (typeof object.key !== 'string' || !object.key.startsWith('datasets/') || !safeNumber(object.size)) throw new Error('Invalid object metadata');
    bytes += object.size;
    if (!safeNumber(bytes)) throw new Error('Inventory size overflow');
    const group = groups[category(object.key)]; group.bytes += object.size; group.objects++;
  }
  return { scope: 'page', prefix: 'datasets/', measuredAt: new Date().toISOString(),
    pageBytes: bytes, pageObjects: page.objects.length, groups,
    nextCursor: page.truncated ? page.cursor : null, isLastPage: !page.truncated,
    atomicSnapshot: false, includesDatabase: false, includesOtherPrefixes: false };
}

/** Estimates, not actual limits or billing. All usage assumptions must be supplied. */
export function capacityProjection({ observedBytes, observedSeasons, years, seasonsPerYear = 2, copies = 3, reservePercent = 20, budgetBytes = null }) {
  if (!safeNumber(observedBytes) || !safeNumber(observedSeasons, 1) || !safeNumber(years, 1) || !safeNumber(seasonsPerYear, 1) || !safeNumber(copies, 1) || !safeNumber(reservePercent)) throw new Error('Invalid capacity assumptions');
  if (budgetBytes !== null && !safeNumber(budgetBytes, 1)) throw new Error('Invalid budget');
  const estimate = Math.ceil(observedBytes / observedSeasons * years * seasonsPerYear * copies * (1 + reservePercent / 100));
  if (!safeNumber(estimate)) throw new Error('Capacity projection overflow');
  return { estimatedBytes: estimate, budgetBytes, withinBudget: budgetBytes === null ? null : estimate <= budgetBytes,
    assumptions: { observedBytes, observedSeasons, years, seasonsPerYear, copies, reservePercent },
    includesRequestCharges: false, isMeasuredCapacity: false };
}

/** Fails closed: a build is not deployment-ready if the public source is unknown. */
export function releaseCheck(input) {
  const reasons = [], sha = s => typeof s === 'string' && /^[a-f0-9]{40}$/.test(s);
  if (!sha(input.observedPublishedCommit)) reasons.push('PUBLISHED_SOURCE_UNKNOWN');
  if (!sha(input.basedOnPublishedCommit) || input.basedOnPublishedCommit !== input.observedPublishedCommit) reasons.push('PUBLISHED_BASE_MISMATCH');
  if (!sha(input.sourceCommit) || input.sourceCommit !== input.builtCommit || input.sourceCommit !== input.testedCommit) reasons.push('SOURCE_BUILD_TEST_MISMATCH');
  if (input.testsPassed !== true) reasons.push('TESTS_NOT_PASSED');
  if (input.restoreDrillPassed !== true) reasons.push('RESTORE_NOT_VERIFIED');
  if (!safeNumber(input.schemaVersion, 1) || !safeNumber(input.deployedSchemaVersion, 1) || input.schemaVersion < input.deployedSchemaVersion) reasons.push('SCHEMA_DOWNGRADE_OR_UNKNOWN');
  return { ready: reasons.length === 0, reasons };
}

/** Request handler with injected bindings/guard for tests; production passes the existing guard. */
export async function storageHealthResponse(request, storage, adminApiGuard) {
  const denied = adminApiGuard(request, storage.ADMIN_EMAILS);
  if (denied) return denied;
  const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  if (!storage.BUCKET) return Response.json({ error: '保存領域が利用できません。' }, { status: 503, headers });
  const params = new URL(request.url).searchParams;
  const cursor = params.get('cursor'), rawLimit = params.get('limit');
  if ((cursor !== null && (!cursor || cursor.length > 8192)) || (rawLimit !== null && !/^[1-9]\d{0,3}$/.test(rawLimit))) {
    return Response.json({ error: '読み取り条件が不正です。' }, { status: 400, headers });
  }
  const limit = rawLimit === null ? 200 : Number(rawLimit);
  if (limit > 1000) return Response.json({ error: '1回の取得は1,000件以下です。' }, { status: 400, headers });
  try { return Response.json(await storagePage(storage.BUCKET, { cursor, limit }), { headers }); }
  catch { return Response.json({ error: '容量の確認に失敗しました。データは変更していません。' }, { status: 503, headers }); }
}
