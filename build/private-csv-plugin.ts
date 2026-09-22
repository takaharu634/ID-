import { readFile } from 'node:fs/promises';
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
    resolveId(source) { if (source === 'private:initial-csv') return id; },
    async load(source) {
      if (source !== id) return;
      const file = resolve(root, 'data/raw/initial-data.csv');
      this.addWatchFile(file);
      return `export default ${JSON.stringify(gzipSync(await readFile(file), { level: 9 }).toString('base64'))};`;
    },
  };
}
