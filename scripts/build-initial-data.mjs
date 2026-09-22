import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDatasetFromCsv } from "../lib/csv-analytics.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const siteRoot = resolve(scriptDir, "..");
const sourcePath = process.argv[2];
const modelDir = process.argv[3];
const season = process.argv[4] ?? "2026年春季";
const outputName = process.argv[5] ?? "initial-data.json";

if (!sourcePath) {
  throw new Error("Usage: node scripts/build-initial-data.mjs <csv> [model-output-directory]");
}

const csvText = await readFile(resolve(sourcePath), "utf8");
let modelPitchers = [];
let modelPitchTypes = [];

if (modelDir) {
  modelPitchers = JSON.parse(await readFile(resolve(modelDir, "pitcher_metrics.json"), "utf8"));
  modelPitchTypes = JSON.parse(await readFile(resolve(modelDir, "pitchtype_metrics.json"), "utf8"));
}

const dataset = buildDatasetFromCsv(csvText, {
  title: `東都大学野球 ${season}リーグ戦`,
  season,
  sourceName: sourcePath.split(/[\\/]/).pop(),
  generatedAt: new Date().toISOString(),
  modelPitchers,
  modelPitchTypes,
});

const outputPath = resolve(siteRoot, "public/data", outputName);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, JSON.stringify(dataset));

console.log(JSON.stringify({
  outputPath,
  bytes: Buffer.byteLength(JSON.stringify(dataset)),
  metadata: dataset.metadata,
  highlights: dataset.highlights,
}, null, 2));
