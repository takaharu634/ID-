/** Called only after the API's existing administrator check. Original bytes are preserved. */
export function bundledCsvResponse(gzipBase64: string) {
  const compressed = Uint8Array.from(atob(gzipBase64), char => char.charCodeAt(0));
  const body = new Response(compressed).body!.pipeThrough(new DecompressionStream('gzip'));
  return new Response(body, { headers: {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': 'attachment; filename="tohto-trackman-current.csv"',
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
  } });
}
