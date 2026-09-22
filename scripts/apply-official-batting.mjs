import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { applyOfficialBatting2026Spring } from "../lib/official-batting-2026-spring.js";

const target = resolve(process.argv[2] ?? "public/data/initial-data.json");
const dataset = JSON.parse(await readFile(target, "utf8"));
const result = applyOfficialBatting2026Spring(dataset.batters, dataset.metadata?.season);
const byId = new Map(dataset.batters.map((row) => [row.id, row]));

for (const player of dataset.players ?? []) {
  if (player.batting && byId.has(player.id)) player.batting = byId.get(player.id);
}
for (const highlight of Object.values(dataset.highlights ?? {})) {
  if (highlight?.id && byId.has(highlight.id)) Object.assign(highlight, byId.get(highlight.id));
}
for (const team of dataset.teams ?? []) {
  team.homeRuns = dataset.batters
    .filter((row) => row.team === team.name)
    .reduce((sum, row) => sum + (row.homeRuns ?? 0), 0);
}

dataset.metadata.officialBatting = result;
dataset.metadata.battingRecordPolicy = result.matched
  ? "公式個人成績表の掲載選手は打席・打数・安打・長打・本塁打・三振などの公式記録を優先。打球・投球計測指標はTrackManを使用。"
  : "打撃成績はTrackManの打席終了結果から集計。";

await writeFile(target, JSON.stringify(dataset));
console.log(JSON.stringify({ target, ...result, model: dataset.metadata.model }));
