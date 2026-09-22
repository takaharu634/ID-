import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const feedPath = path.join(root, "public/data/news_feed.json");
const inboxPath = process.argv[2] ? path.resolve(process.argv[2]) : path.join(root, "data/news_inbox.json");
const datasetPath = path.join(root, "public/data/initial-data.json");

const required = ["team", "publishedAt", "category", "headline", "fact", "savant", "sourceName", "sourceUrl"];
const teams = new Set(["中央大学", "青山学院大学", "國學院大學", "東洋大学", "亜細亜大学", "立正大学"]);
const categories = new Set(["速報", "インタビュー", "TRAINING WATCH", "本人SNS", "公式", "試合", "進路"]);
const normalize = (value) => String(value ?? "").normalize("NFKC").toLowerCase().replace(/[\s,，.．・'’\-ー_]/g, "");
const slug = (value) => normalize(value).replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]/g, "").slice(0, 36);

const [feed, incoming, dataset] = await Promise.all([
  fs.readFile(feedPath, "utf8").then(JSON.parse).catch(() => []),
  fs.readFile(inboxPath, "utf8").then(JSON.parse).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  }),
  fs.readFile(datasetPath, "utf8").then(JSON.parse),
]);
const items = Array.isArray(incoming) ? incoming : incoming.items;
if (!Array.isArray(items)) throw new Error("NEWS inboxは配列または { items: [] } 形式にしてください。");

const players = dataset.players ?? [];
const playerIndex = new Map();
for (const player of players) {
  for (const name of [player.kanji, player.name, player.romanName, ...(player.aliases ?? [])]) {
    if (name) playerIndex.set(`${player.team}|${normalize(name)}`, player);
  }
}
const sourceKey = (item) => `${normalize(item.sourceUrl)}|${item.team}|${normalize(item.playerKanji || item.playerRoman || "team")}`;
const existing = new Set(feed.flatMap((item) => [sourceKey(item), `${item.team}|${normalize(item.headline)}`]));
const accepted = [];
for (const raw of items) {
  const missing = required.filter((key) => !String(raw[key] ?? "").trim());
  if (missing.length) throw new Error(`${raw.headline ?? "見出しなし"}: 必須項目不足 ${missing.join(", ")}`);
  if (!/^https:\/\//.test(raw.sourceUrl)) throw new Error(`${raw.headline}: 出典URLはhttpsが必要です。`);
  if (!teams.has(raw.team)) throw new Error(`${raw.headline}: 対象外の大学です。`);
  if (!categories.has(raw.category)) throw new Error(`${raw.headline}: 未定義カテゴリです。`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw.publishedAt)) throw new Error(`${raw.headline}: 公開日はYYYY-MM-DD形式が必要です。`);
  if (existing.has(sourceKey(raw)) || existing.has(`${raw.team}|${normalize(raw.headline)}`)) continue;
  const requestedName = raw.playerKanji || raw.playerRoman || raw.player || "";
  const player = requestedName ? playerIndex.get(`${raw.team}|${normalize(requestedName)}`) : null;
  accepted.push({
    ...raw,
    id: raw.id || `${raw.publishedAt}-${slug(raw.team)}-${slug(raw.headline)}`,
    playerId: player?.id ?? raw.playerId,
    playerKanji: player?.kanji ?? raw.playerKanji ?? raw.player ?? "チーム全体",
    playerRoman: player?.romanName ?? player?.name ?? raw.playerRoman,
    isFeatured: Boolean(raw.isFeatured),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String).slice(0, 12) : [],
  });
  existing.add(sourceKey(raw));
  existing.add(`${raw.team}|${normalize(raw.headline)}`);
}

const output = [...feed, ...accepted].sort((a, b) => `${b.publishedAt}|${b.id}`.localeCompare(`${a.publishedAt}|${a.id}`));
await fs.writeFile(feedPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ status: "ok", added: accepted.length, total: output.length, preview: "/?表示=news" }));
