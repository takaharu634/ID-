/** Complete bounded verification requests without losing uncommitted batches. */
export async function importAction(body: object, fetcher: typeof fetch = fetch, options: {signal?:AbortSignal;onProgress?:(checked:number,total:number)=>void} = {}) {
  let previous = '', stalled = 0;
  for (;;) {
    options.signal?.throwIfAborted();
    const response = await fetcher('/api/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: options.signal ? AbortSignal.any([options.signal,AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000) });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || '反映に失敗しました。');
    if (response.status !== 202 || !value.verifying) return value;
    options.onProgress?.(value.checked,value.total);
    const progress = `${value.checked}/${value.total}`;
    stalled = progress === previous ? stalled + 1 : 0;
    if (stalled >= 3) throw new Error('保存内容の照合が進みませんでした。通信を確認して、もう一度反映してください。');
    previous = progress;
  }
}

type Prepared = { id?: string; unchanged?: boolean; season: string; report: { warnings: unknown[] } };
export async function publishPrepared<T extends Prepared>(values: T[], commit: (value: T) => Promise<unknown>, onPending: (values: T[]) => void) {
  let pending = values.filter(value => !value.unchanged);
  const committed: T[] = [];
  onPending(pending);
  for (const value of pending) {
    if (value.report.warnings.length) continue;
    try { await commit(value); }
    catch (error) { return { pending, committed, error: error instanceof Error ? error.message : '反映に失敗しました。' }; }
    committed.push(value);
    pending = pending.filter(item => item !== value);
    onPending(pending);
  }
  return { pending, committed, error: '' };
}

export function notifyDatasetUpdated() {
  let channel: BroadcastChannel | undefined;
  try { channel = new BroadcastChannel('id-touto-data'); channel.postMessage('updated'); }
  catch { /* Other tabs also check the catalog when they regain focus. */ }
  finally { channel?.close(); }
}
