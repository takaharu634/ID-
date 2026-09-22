import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { packDataset } from '../lib/dataset-transport.js';

await mkdir('public/data/compact', { recursive: true });
for (const season of ['2026-fall', '2026-spring', '2025-fall']) {
  for (const kind of ['season', 'spin']) {
    const filename = `${kind}-${season}.json`;
    const source = await readFile(`public/data/${filename}`);
    const packed = JSON.stringify(packDataset(JSON.parse(source)));
    await writeFile(`public/data/compact/${filename}`, packed);
    console.log(`${filename}: ${source.length} → ${Buffer.byteLength(packed)} bytes; gzip ${gzipSync(source).length} → ${gzipSync(packed).length}`);
  }
}
