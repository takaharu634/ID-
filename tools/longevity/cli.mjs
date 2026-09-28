#!/usr/bin/env node
import { pack, verify, restore } from './archive.mjs';
import { capacityProjection, releaseCheck } from '../../server/storage-health.mjs';
import { readFile } from 'node:fs/promises';

const usage = `ID東都 長期保存ツール (Node.js 22以上)
  node tools/longevity/cli.mjs pack SOURCE_DIRECTORY NEW_ARCHIVE_DIRECTORY
  node tools/longevity/cli.mjs verify ARCHIVE_DIRECTORY [TRUSTED_MANIFEST_SHA256]
  node tools/longevity/cli.mjs restore ARCHIVE_DIRECTORY NEW_DIRECTORY [TRUSTED_MANIFEST_SHA256]
  node tools/longevity/cli.mjs capacity ASSUMPTIONS.json
  node tools/longevity/cli.mjs release-check EVIDENCE.json

入力元は更新を止めたエクスポートを指定してください。
保存・復元は既存フォルダを上書きしません。公開・移行・課金変更は行いません。
manifest.sha256はアーカイブとは別の信頼できる場所にも保管してください。`;

try {
  const [command, ...args] = process.argv.slice(2);
  let result;
  if (command === 'pack' && args.length === 2) result = await pack(...args);
  else if (command === 'verify' && [1, 2].includes(args.length)) result = await verify(args[0], { expectedManifestHash: args[1] ?? null });
  else if (command === 'restore' && [2, 3].includes(args.length)) result = await restore(args[0], args[1], { expectedManifestHash: args[2] ?? null });
  else if (['capacity', 'release-check'].includes(command) && args.length === 1) {
    const input = JSON.parse(await readFile(args[0], 'utf8'));
    result = command === 'capacity' ? capacityProjection(input) : releaseCheck(input);
    if (command === 'release-check' && !result.ready) process.exitCode = 2;
  } else {
    console.log(usage);
    process.exitCode = command === '--help' || command === undefined ? 0 : 1;
  }
  if (result) console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`失敗: ${error instanceof Error ? error.message : 'Unknown error'}`);
  process.exitCode = 1;
}
