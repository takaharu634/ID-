import { readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { annotateRunnerStates } from "../lib/runner-state.js";

const files = process.argv.slice(2);
if (!files.length) throw new Error("JSONファイルを1件以上指定してください。");

for (const filename of files) {
  const target = resolve(filename);
  const dataset = JSON.parse(await readFile(target, "utf8"));
  if (!Array.isArray(dataset.pitches)) throw new Error(`${filename}: pitches配列がありません。`);
  dataset.schemaVersion = 7;
  dataset.metadata = {
    ...dataset.metadata,
    runnerState: {
      version: "tohto-runner-state-v1",
      source: "inferred",
      note: "TrackMan標準CSVに塁占有列がないため、打席結果・得点・アウトから各投球前の走者状況を推定。",
    },
  };
  dataset.pitches = annotateRunnerStates(dataset.pitches);
  const temporary = `${target}.runner-state.tmp`;
  await writeFile(temporary, JSON.stringify(dataset));
  await rename(temporary, target);
  const known = dataset.pitches.filter((pitch) => pitch.runnerStateCode !== "unknown").length;
  console.log(`${filename}: ${known}/${dataset.pitches.length}球を走者状況付きで更新`);
}
