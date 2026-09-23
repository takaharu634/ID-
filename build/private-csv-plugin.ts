import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Plugin } from 'vite';

/** Server-only virtual module: no raw CSV is copied to publicly served assets. */
export function privateCsv(): Plugin {
  let root = process.cwd();
  const id = '\0private:initial-csv';
  return {
    name: 'private-csv',
    configResolved(config) { root = config.root; },
    resolveId(source) { if (source === 'private:initial-csv') return id; if (source === 'private:season-csv') return '\0private:season-csv'; },
    async load(source) {
      if (source === '\0private:season-csv') {
        const result: Record<string, string[]> = {};
        for (const season of ['2025-fall', '2026-spring', '2026-fall']) {
          const files = season === '2026-fall'
            ? (await readdir(resolve(root, 'data/trackman/2026-fall'))).filter(f => f.endsWith('.csv')).sort().map(f => resolve(root, 'data/trackman/2026-fall', f))
            : [resolve(root, `data/raw/season-${season}.csv`)];
          result[season] = [];
          for (const file of files) { this.addWatchFile(file); result[season].push(gzipSync(await readFile(file), { level: 9 }).toString('base64')); }
        }
        return `export default ${JSON.stringify(result)};`;
      }
      if (source !== id) return;
      const file = resolve(root, 'data/raw/initial-data.csv');
      this.addWatchFile(file);
      return `export default ${JSON.stringify(gzipSync(await readFile(file), { level: 9 }).toString('base64'))};`;
    },
  };
}
