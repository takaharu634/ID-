import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { packDataset } from '../lib/dataset-transport.js';
import { restoreBundled, packBundled } from './bundled-data.mjs';
import { applyFramingAdjustment } from '../lib/framing-adjustment.mjs';

await restoreBundled();
for (const name of (await readdir('public/data')).filter(name => /^(?:initial-data|season-[1-9]\d{3}-(?:spring|fall))\.json$/.test(name))) {
  const path = `public/data/${name}`, source = JSON.parse(await readFile(path, 'utf8'));
  const adjusted = applyFramingAdjustment(source);
  if (adjusted !== source) await writeFile(path, JSON.stringify(adjusted));
}
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
const {syncTrajectorySpin}=await import('./sync-trajectory-spin.mjs');
await syncTrajectorySpin();
