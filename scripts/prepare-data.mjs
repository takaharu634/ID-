import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { packDataset } from '../lib/dataset-transport.js';
import { restoreBundled, packBundled } from './bundled-data.mjs';

await restoreBundled();
await mkdir('public/data/compact', { recursive: true });
const seasons=(await readdir('public/data')).map(f=>/^season-([1-9]\d{3}-(?:spring|fall))\.json$/.exec(f)?.[1]).filter(Boolean).sort((a,b)=>Number(b.slice(0,4))-Number(a.slice(0,4)) || Number(b.endsWith('fall'))-Number(a.endsWith('fall')));
await writeFile('lib/generated/seasons.json',JSON.stringify(seasons)+'\n');
for (const season of seasons) {
  for (const kind of ['season', 'spin']) {
    const filename = `${kind}-${season}.json`;
    const source = await readFile(`public/data/${filename}`);
    const packed = JSON.stringify(packDataset(JSON.parse(source)));
    await writeFile(`public/data/compact/${filename}`, packed);
    console.log(`${filename}: ${source.length} → ${Buffer.byteLength(packed)} bytes; gzip ${gzipSync(source).length} → ${gzipSync(packed).length}`);
  }
}
await packBundled();
