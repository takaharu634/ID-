import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const datasetPath = process.argv[2];
const spinPath = process.argv[3];

if (!datasetPath || !spinPath) {
  throw new Error("Usage: node scripts/normalize-spin-pitch-types.mjs <dataset-json> <spin-json>");
}

const [dataset, spinPitches] = await Promise.all([
  readFile(resolve(datasetPath), "utf8").then(JSON.parse),
  readFile(resolve(spinPath), "utf8").then(JSON.parse),
]);

const pitchTypeIds = {
  "ストレート": "fastball",
  "シンカー": "sinker",
  "カットボール": "cutter",
  "スライダー": "slider",
  "カーブ": "curveball",
  "チェンジアップ": "changeup",
  "フォーク": "splitter",
  "ナックル": "knuckleball",
};

function metricToken(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(1) : "—";
}

function underlyingPitcherId(value) {
  return String(value ?? "").replace(/^\d{4}-(?:spring|fall):/, "");
}

function pitchKey(pitch, pitcherId = pitch.pitcherId) {
  return [
    underlyingPitcherId(pitcherId),
    pitch.date,
    pitch.pitchNo ?? "—",
    metricToken(pitch.velocity),
  ].join("|");
}

const normalizedByPitch = new Map();
for (const pitch of dataset.pitches ?? []) {
  const key = pitchKey(pitch);
  const queue = normalizedByPitch.get(key) ?? [];
  queue.push(pitchTypeIds[pitch.normalizedPitchType ?? pitch.pitchType] ?? pitch.pitchType);
  normalizedByPitch.set(key, queue);
}

let matched = 0;
let changed = 0;
let unmatched = 0;
let unmatchedFastballSinker = 0;
const normalizedSpinPitches = spinPitches.map((pitch) => {
  const rawPitchType = pitch.rawPitchType ?? pitch.pitchType;
  const queue = normalizedByPitch.get(pitchKey(pitch));
  const normalizedPitchType = queue?.shift() ?? pitch.normalizedPitchType ?? pitch.pitchType;
  if (queue) matched += 1;
  else {
    unmatched += 1;
    if (["fastball", "sinker"].includes(rawPitchType)) unmatchedFastballSinker += 1;
  }
  if (rawPitchType !== normalizedPitchType) changed += 1;
  return { ...pitch, rawPitchType, normalizedPitchType, pitchType: normalizedPitchType };
});

if (unmatchedFastballSinker > 0) {
  throw new Error(`${unmatchedFastballSinker} Fastball/Sinker pitches could not be matched to the normalized dataset.`);
}

await writeFile(resolve(spinPath), JSON.stringify(normalizedSpinPitches));
console.log(JSON.stringify({ spinPath: resolve(spinPath), pitches: normalizedSpinPitches.length, matched, unmatched, changed }, null, 2));
