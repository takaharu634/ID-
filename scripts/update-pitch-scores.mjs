// Recalibrate only PITCH scores; preserve original measurements and batting data.
import { readFile, writeFile } from 'node:fs/promises';
import { applyPitchQuality } from '../lib/pitch-quality.mjs';
for (const file of ['initial-data.json', 'season-2025-fall.json', 'season-2026-spring.json', 'season-2026-fall.json']) {
  const path = `public/data/${file}`;
  const old = JSON.parse(await readFile(path, 'utf8'));
  const next = applyPitchQuality(old);
  if (next !== old) await writeFile(path, JSON.stringify(next));
  const values = next.pitchers.filter(p => p.pitches >= 100 && Number.isFinite(p.pitchingPlus)).map(p => p.pitchingPlus);
  console.log(`${file}: ${values.length} qualified, ${Math.min(...values)}–${Math.max(...values)}`);
}
