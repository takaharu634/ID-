/** Always release timers/listeners, including on cancellation or an early rejection. */
export function waitForReady<T>(work: PromiseLike<T>, signal: AbortSignal, timeoutMs = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const stop = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
    const abort = () => { stop(); reject(new Error('準備を中止しました。')); };
    const timer = setTimeout(() => { stop(); reject(new Error('資料の読み込みに時間がかかっています。戻ってもう一度お試しください。')); }, timeoutMs);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    Promise.resolve(work).then(value => { stop(); resolve(value); }, error => { stop(); reject(error); });
  });
}
